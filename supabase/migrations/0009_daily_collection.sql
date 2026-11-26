-- Milestone 8: daily-collection loans, the daily collection sheet, and import of balances from an Excel register.

alter type payment_frequency add value if not exists 'daily';
alter type interest_method add value if not exists 'fixed_installment';

alter table loan_terms add column skip_sundays boolean not null default false;
alter table loans add column external_ref text;
alter table loans add column source text not null default 'new' check (source in ('new', 'imported'));
create unique index loans_external_ref_idx on loans (financier_id, external_ref) where external_ref is not null;

-- create_loan now also stores whether Sundays are skipped (daily loans). Same signature and rules as before.
create or replace function create_loan(
  p_customer_id uuid, p_vehicle_id uuid, p_principal numeric,
  p_application_date date, p_approval_date date, p_disbursement_date date,
  p_terms jsonb, p_schedule jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_fin uuid := auth_financier_id(); v_loan uuid; v_terms uuid;
  v_n int; v_sum numeric; v_cnt int; v_first date; v_last date;
begin
  if not has_permission('loans.write') then raise exception 'permission denied: loans.write' using errcode = '42501'; end if;
  if p_disbursement_date is null then raise exception 'disbursement_date is required for a loan record'; end if;
  if not exists (select 1 from vehicles where id = p_vehicle_id and customer_id = p_customer_id and financier_id = v_fin) then
    raise exception 'vehicle does not belong to this customer';
  end if;

  select count(*), coalesce(sum(principal_due),0), min(due_date), max(due_date), count(distinct installment_no)
    into v_cnt, v_sum, v_first, v_last, v_n
  from jsonb_to_recordset(p_schedule) as t(installment_no int, due_date date, principal_due numeric, interest_due numeric, fees_due numeric);
  if v_cnt <> (p_terms->>'tenure_installments')::int or v_n <> v_cnt then raise exception 'schedule must have exactly tenure_installments distinct rows'; end if;
  if v_sum <> p_principal then raise exception 'schedule principal (%) must equal loan principal (%)', v_sum, p_principal; end if;
  if exists (select 1 from jsonb_to_recordset(p_schedule) as t(installment_no int, due_date date)
             where installment_no not between 1 and v_cnt) then raise exception 'installment_no must run 1..n'; end if;
  if exists (select 1 from (select installment_no, due_date, lag(due_date) over (order by installment_no) pd
                            from jsonb_to_recordset(p_schedule) as t(installment_no int, due_date date)) q
             where pd is not null and due_date <= pd) then raise exception 'due dates must be strictly increasing'; end if;

  insert into loans (financier_id, customer_id, vehicle_id, status, application_date, approval_date, disbursement_date, principal_amount)
  values (v_fin, p_customer_id, p_vehicle_id, 'active', p_application_date, p_approval_date, p_disbursement_date, p_principal)
  returning id into v_loan;

  insert into loan_terms (financier_id, loan_id, interest_rate_pa, interest_method, tenure_installments, frequency,
                          installment_amount, first_due_date, final_due_date, processing_fee, other_fees, notes, skip_sundays)
  values (v_fin, v_loan, (p_terms->>'interest_rate_pa')::numeric, (p_terms->>'interest_method')::interest_method,
          (p_terms->>'tenure_installments')::int, (p_terms->>'frequency')::payment_frequency,
          (p_terms->>'installment_amount')::numeric, v_first, v_last,
          coalesce((p_terms->>'processing_fee')::numeric, 0), coalesce((p_terms->>'other_fees')::numeric, 0), p_terms->>'notes',
          coalesce((p_terms->>'skip_sundays')::boolean, false))
  returning id into v_terms;

  insert into repayment_schedules (financier_id, loan_id, loan_terms_id, installment_no, due_date, principal_due, interest_due, fees_due)
  select v_fin, v_loan, v_terms, installment_no, due_date, principal_due, interest_due, coalesce(fees_due, 0)
  from jsonb_to_recordset(p_schedule) as t(installment_no int, due_date date, principal_due numeric, interest_due numeric, fees_due numeric);

  perform refresh_loan_status(v_loan);
  return v_loan;
end $$;

-- During a bulk import the (very many) generated schedule rows are not audited one by one; each imported loan gets its own audit entry instead.
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
begin
  if tg_table_name = 'repayment_schedules' and current_setting('app.bulk_import', true) = '1' then return null; end if;
  insert into audit_logs (financier_id, actor_id, action, table_name, record_id, old_data, new_data)
  values ((j->>'financier_id')::uuid, auth.uid(), tg_op, tg_table_name, (j->>'id')::uuid,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end $$;

-- ───────────── balance schedule for imported loans (mirrors generateBalanceSchedule in the app) ─────────────
create function generate_balance_schedule(p_balance numeric, p_installment numeric, p_first date, p_frequency payment_frequency, p_skip_sundays boolean)
returns table (installment_no int, due_date date, amount numeric) language plpgsql immutable set search_path = public as $$
declare n int; k int; d date;
begin
  if p_balance <= 0 or p_installment <= 0 then raise exception 'balance and installment must be positive'; end if;
  n := ceil(p_balance / p_installment)::int;
  if n > 3000 then raise exception 'too many instalments'; end if;
  d := p_first;
  for k in 1..n loop
    if p_frequency = 'daily' then
      if p_skip_sundays and extract(dow from d) = 0 then d := d + 1; end if;
      due_date := d; d := d + 1;
    elsif p_frequency = 'weekly' then due_date := p_first + 7 * (k - 1);
    elsif p_frequency = 'fortnightly' then due_date := p_first + 14 * (k - 1);
    else due_date := (p_first + make_interval(months => k - 1))::date;
    end if;
    installment_no := k;
    amount := case when k = n then p_balance - p_installment * (n - 1) else p_installment end;
    return next;
  end loop;
end $$;

-- Owner-only. Each row becomes a customer (reused when name + mobile match), a placeholder vehicle "PENDING-<loan ref>" to be completed later,
-- and a loan with the stated balance. One bad row never blocks the others; its error is reported back. Safe to re-run: loans whose reference
-- already exists are skipped.
create function import_legacy_loans(p_rows jsonb, p_balance_date date, p_first_due date, p_frequency payment_frequency, p_skip_sundays boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fin uuid := auth_financier_id(); r jsonb; v_line int; v_name text; v_mobile text; v_ref text; v_due numeric; v_bal numeric;
  v_cust uuid; v_veh uuid; v_loan uuid; v_terms uuid; v_n int; v_last date; v_reg text; v_base text; v_i int;
  v_created int := 0; v_skipped jsonb := '[]'::jsonb; v_failed jsonb := '[]'::jsonb;
begin
  if auth_role() is distinct from 'owner' then raise exception 'permission denied: only the owner can import' using errcode = '42501'; end if;
  if p_first_due <= p_balance_date then raise exception 'the first collection date must be after the balance date'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'at most 2000 rows per import'; end if;
  perform set_config('app.bulk_import', '1', true);

  for r in select * from jsonb_array_elements(p_rows) loop
    v_line := (r->>'line')::int; v_cust := null;
    begin
      v_name := trim(r->>'name'); v_mobile := r->>'mobile'; v_ref := trim(r->>'loan_ref');
      v_due := (r->>'daily_due')::numeric; v_bal := (r->>'balance')::numeric;
      if v_ref is null or v_ref = '' then raise exception 'loan number is missing'; end if;
      if exists (select 1 from loans where financier_id = v_fin and external_ref = v_ref) then
        v_skipped := v_skipped || jsonb_build_object('line', v_line, 'reason', 'already imported');
        continue;
      end if;
      select id into v_cust from customers where financier_id = v_fin and mobile = v_mobile and lower(full_name) = lower(v_name) limit 1;
      if v_cust is null then
        insert into customers (financier_id, full_name, mobile) values (v_fin, v_name, v_mobile) returning id into v_cust;
      end if;
      v_base := 'PENDING-' || left(regexp_replace(upper(v_ref), '[^A-Z0-9]', '', 'g'), 20);
      v_reg := v_base; v_i := 1;
      while exists (select 1 from vehicles where financier_id = v_fin and registration_number = v_reg) loop v_i := v_i + 1; v_reg := v_base || '-' || v_i; end loop;
      insert into vehicles (financier_id, customer_id, registration_number, category) values (v_fin, v_cust, v_reg, 'other') returning id into v_veh;
      insert into loans (financier_id, customer_id, vehicle_id, status, disbursement_date, principal_amount, external_ref, source)
      values (v_fin, v_cust, v_veh, 'active', p_balance_date, v_bal, v_ref, 'imported') returning id into v_loan;
      select count(*), max(g.due_date) into v_n, v_last from generate_balance_schedule(v_bal, v_due, p_first_due, p_frequency, p_skip_sundays) g;
      insert into loan_terms (financier_id, loan_id, interest_rate_pa, interest_method, tenure_installments, frequency, installment_amount, first_due_date, final_due_date, notes, skip_sundays)
      values (v_fin, v_loan, 0, 'fixed_installment', v_n, p_frequency, least(v_due, v_bal), p_first_due, v_last,
              'Imported: balance carried forward, interest already included', p_skip_sundays and p_frequency = 'daily') returning id into v_terms;
      insert into repayment_schedules (financier_id, loan_id, loan_terms_id, installment_no, due_date, principal_due, interest_due, fees_due)
      select v_fin, v_loan, v_terms, g.installment_no, g.due_date, g.amount, 0, 0 from generate_balance_schedule(v_bal, v_due, p_first_due, p_frequency, p_skip_sundays) g;
      perform refresh_loan_status(v_loan);
      insert into audit_logs (financier_id, actor_id, action, table_name, record_id, new_data)
      values (v_fin, auth.uid(), 'IMPORT', 'loans', v_loan, jsonb_build_object('external_ref', v_ref, 'balance', v_bal, 'installments', v_n));
      v_created := v_created + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('line', v_line, 'message', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'failed', v_failed);
end $$;

-- ───────────── the daily collection sheet ─────────────
-- One row per loan that has money due on (or before) p_date, or that took a payment on it. Balances are "as at the start of p_date",
-- so a printed sheet and the same sheet after the day's entries agree on the opening balance.
create function collection_sheet(p_date date) returns table (
  loan_id uuid, loan_no text, external_ref text, customer_id uuid, customer_name text, mobile text,
  installment_amount numeric, arrears numeric, opening_balance numeric, collected numeric, closing_balance numeric, remarks text
) language sql stable security invoker set search_path = public as $$
  with sched as (
    select s.loan_id, s.due_date, s.principal_due + s.interest_due + s.fees_due as due,
           coalesce((select sum(al.principal_amount + al.interest_amount + al.fees_amount)
                     from payment_allocations al join payments p on p.id = al.payment_id
                     where al.schedule_id = s.id and p.payment_date < p_date), 0) as paid_before
    from repayment_schedules s where s.is_active
  ), agg as (
    select loan_id, sum(due - paid_before) as opening,
           coalesce(sum(due - paid_before) filter (where due_date < p_date and due - paid_before > 0), 0) as arrears,
           coalesce(sum(due - paid_before) filter (where due_date <= p_date and due - paid_before > 0), 0) as due_now
    from sched group by loan_id
  ), pay as (
    select loan_id, sum(amount) as collected, string_agg(distinct nullif(trim(notes), ''), '; ') as remarks
    from payments where payment_date = p_date group by loan_id
  )
  select l.id, l.loan_no, l.external_ref, c.id, c.full_name, c.mobile, t.installment_amount, a.arrears, a.opening,
         coalesce(py.collected, 0), a.opening - coalesce(py.collected, 0), py.remarks
  from agg a
  join loans l on l.id = a.loan_id and l.disbursement_date <= p_date
  join customers c on c.id = l.customer_id
  join loan_terms t on t.loan_id = l.id and t.is_current
  left join pay py on py.loan_id = l.id
  where a.due_now > 0 or coalesce(py.collected, 0) <> 0
  order by c.full_name, l.loan_no
  limit 2000
$$;

-- ───────────── imported balances are not "money given": keep them out of disbursement figures ─────────────
create or replace function report_monthly(p_months int default 12) returns table (
  month date, disbursed_count bigint, disbursed_amount numeric, collected numeric, overdue_amount numeric
) language sql stable security invoker set search_path = public as $$
  with m as (
    select (date_trunc('month', today_ist()) - make_interval(months => n))::date as month
    from generate_series(0, greatest(least(p_months, 36), 1) - 1) n
  )
  select m.month,
    (select count(*) from loans l where l.source = 'new' and l.disbursement_date >= m.month and l.disbursement_date < (m.month + interval '1 month')::date),
    (select coalesce(sum(l.principal_amount), 0) from loans l where l.source = 'new' and l.disbursement_date >= m.month and l.disbursement_date < (m.month + interval '1 month')::date),
    (select coalesce(sum(p.amount), 0) from payments p where p.payment_date >= m.month and p.payment_date < (m.month + interval '1 month')::date),
    overdue_as_of(least((m.month + interval '1 month')::date, today_ist()))
  from m order by m.month
$$;

create or replace view v_dashboard_summary with (security_invoker = true) as
select
  (select count(*) from customers)                                          as total_customers,
  (select count(*) from loans where status in ('active','overdue'))         as active_loans,
  (select count(*) from loans where disbursement_date is not null and source = 'new') as loans_disbursed,
  (select coalesce(sum(principal_amount),0) from loans where disbursement_date is not null and source = 'new') as amount_disbursed,
  (select coalesce(sum(amount),0) from payments
     where date_trunc('month', payment_date) = date_trunc('month', today_ist())) as collections_this_month,
  (select coalesce(sum(principal_outstanding),0) from v_loan_outstanding where status in ('active','overdue')) as principal_outstanding,
  (select coalesce(sum(overdue_amount),0) from v_loan_outstanding where status in ('active','overdue'))        as overdue_amount,
  (select count(*) from v_schedule_status where status = 'paid')            as paid_installments,
  (select count(*) from v_schedule_status where total_outstanding > 0)      as unpaid_installments,
  (select count(*) from v_schedule_status where status = 'overdue')         as overdue_installments,
  (select count(*) from vehicles where insurance_expiry < today_ist())      as expired_insurance,
  (select count(*) from vehicles where insurance_expiry between today_ist() and today_ist() + 30) as insurance_expiring_30d,
  (select count(*) from documents where status in ('uploaded','pending_review')) as documents_to_verify,
  (select count(*) from v_loan_file_status where missing_count > 0)         as incomplete_loan_files,
  (select count(*) from follow_up_tasks where status = 'open' and due_date <= today_ist()) as follow_ups_due;

revoke execute on function generate_balance_schedule(numeric, numeric, date, payment_frequency, boolean) from public, anon, authenticated;
revoke execute on function import_legacy_loans(jsonb, date, date, payment_frequency, boolean) from public, anon;
revoke execute on function collection_sheet(date) from public, anon;
grant execute on function import_legacy_loans(jsonb, date, date, payment_frequency, boolean) to authenticated;
grant execute on function collection_sheet(date) to authenticated;
grant select on v_dashboard_summary to authenticated;
grant execute on function collection_sheet(date), import_legacy_loans(jsonb, date, date, payment_frequency, boolean) to service_role;
