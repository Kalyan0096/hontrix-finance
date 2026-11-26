-- Milestone 1 part 2: derived views, financial RPCs, row-level security, grants.

-- ───────────── derived views (security_invoker: RLS of the caller applies) ─────────────
create view v_schedule_status with (security_invoker = true) as
select x.*,
  case
    when x.total_outstanding = 0           then 'paid'
    when x.due_date < today_ist()          then 'overdue'
    when x.paid_total > 0                  then 'partially_paid'
    when x.due_date = today_ist()          then 'due'
    else 'upcoming'
  end as status
from (
  select s.id as schedule_id, s.financier_id, s.loan_id, s.installment_no, s.due_date,
         s.principal_due, s.interest_due, s.fees_due,
         s.principal_due + s.interest_due + s.fees_due as amount_due,
         coalesce(a.p, 0) as paid_principal, coalesce(a.i, 0) as paid_interest, coalesce(a.f, 0) as paid_fees,
         coalesce(a.p, 0) + coalesce(a.i, 0) + coalesce(a.f, 0) as paid_total,
         s.principal_due - coalesce(a.p, 0) as principal_outstanding,
         s.interest_due  - coalesce(a.i, 0) as interest_outstanding,
         s.fees_due      - coalesce(a.f, 0) as fees_outstanding,
         (s.principal_due + s.interest_due + s.fees_due) - (coalesce(a.p,0) + coalesce(a.i,0) + coalesce(a.f,0)) as total_outstanding
  from repayment_schedules s
  left join (select schedule_id, sum(principal_amount) p, sum(interest_amount) i, sum(fees_amount) f
             from payment_allocations group by schedule_id) a on a.schedule_id = s.id
  where s.is_active
) x;

-- "interest_outstanding" = scheduled interest on instalments not yet paid (not accrued-to-date interest).
create view v_loan_outstanding with (security_invoker = true) as
select l.id as loan_id, l.financier_id, l.loan_no, l.status, l.customer_id, l.vehicle_id, l.principal_amount,
       coalesce(sum(v.principal_outstanding), 0) as principal_outstanding,
       coalesce(sum(v.interest_outstanding), 0)  as interest_outstanding,
       coalesce(sum(v.fees_outstanding), 0)      as fees_outstanding,
       coalesce(sum(v.total_outstanding), 0)     as total_receivable,
       coalesce(sum(v.total_outstanding) filter (where v.due_date < today_ist()), 0) as overdue_amount,
       count(*) filter (where v.total_outstanding > 0 and v.due_date < today_ist())  as overdue_installments,
       min(v.due_date) filter (where v.total_outstanding > 0) as next_due_date
from loans l left join v_schedule_status v on v.loan_id = l.id
group by l.id;

create view v_documents with (security_invoker = true) as
select d.*,
       case when d.expiry_date is not null and d.expiry_date < today_ist() then 'expired'::document_status else d.status end as effective_status,
       d.expiry_date - today_ist() as days_to_expiry,
       (select max(version_no) from document_versions dv where dv.document_id = d.id) as latest_version_no
from documents d;

create view v_dashboard_summary with (security_invoker = true) as
select
  (select count(*) from customers)                                          as total_customers,
  (select count(*) from loans where status in ('active','overdue'))         as active_loans,
  (select count(*) from loans where disbursement_date is not null)          as loans_disbursed,
  (select coalesce(sum(principal_amount),0) from loans where disbursement_date is not null) as amount_disbursed,
  (select coalesce(sum(amount),0) from payments
     where date_trunc('month', payment_date) = date_trunc('month', today_ist())) as collections_this_month,
  (select coalesce(sum(principal_outstanding),0) from v_loan_outstanding where status in ('active','overdue')) as principal_outstanding,
  (select coalesce(sum(overdue_amount),0) from v_loan_outstanding where status in ('active','overdue'))        as overdue_amount,
  (select count(*) from v_schedule_status where status = 'paid')            as paid_installments,
  (select count(*) from v_schedule_status where total_outstanding > 0)      as unpaid_installments,
  (select count(*) from v_schedule_status where status = 'overdue')         as overdue_installments,
  (select count(*) from vehicles where insurance_expiry < today_ist())      as expired_insurance,
  (select count(*) from vehicles where insurance_expiry between today_ist() and today_ist() + 30) as insurance_expiring_30d;

-- ───────────── financial RPCs (the only write path for the ledger) ─────────────
create function refresh_loan_status(p_loan_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from v_loan_outstanding where loan_id = p_loan_id;
  update loans set status = (case when o.total_receivable = 0 then 'closed'
                                  when o.overdue_amount > 0   then 'overdue'
                                  else 'active' end)::loan_status
  where id = p_loan_id and status in ('disbursed','active','overdue','closed');
end $$;

-- For a daily scheduled job (service role / pg_cron): overdue status changes with the calendar.
create function refresh_all_loan_statuses() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from loans where status in ('disbursed','active','overdue') loop
    perform refresh_loan_status(r.id); n := n + 1;
  end loop;
  return n;
end $$;

create function create_loan(
  p_customer_id uuid, p_vehicle_id uuid, p_principal numeric,
  p_application_date date, p_approval_date date, p_disbursement_date date,
  p_terms jsonb, p_schedule jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_fin uuid := auth_financier_id(); v_loan uuid; v_terms uuid;
  v_n int; v_sum numeric; v_cnt int; v_first date; v_last date; v_fees numeric;
begin
  if not has_permission('loans.write') then raise exception 'permission denied: loans.write' using errcode = '42501'; end if;
  if p_disbursement_date is null then raise exception 'disbursement_date is required for a loan record'; end if;
  if not exists (select 1 from vehicles where id = p_vehicle_id and customer_id = p_customer_id and financier_id = v_fin) then
    raise exception 'vehicle does not belong to this customer';
  end if;

  v_n := (p_terms->>'tenure_installments')::int;
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
                          installment_amount, first_due_date, final_due_date, processing_fee, other_fees, notes)
  values (v_fin, v_loan, (p_terms->>'interest_rate_pa')::numeric, (p_terms->>'interest_method')::interest_method,
          (p_terms->>'tenure_installments')::int, (p_terms->>'frequency')::payment_frequency,
          (p_terms->>'installment_amount')::numeric, v_first, v_last,
          coalesce((p_terms->>'processing_fee')::numeric, 0), coalesce((p_terms->>'other_fees')::numeric, 0), p_terms->>'notes')
  returning id into v_terms;

  insert into repayment_schedules (financier_id, loan_id, loan_terms_id, installment_no, due_date, principal_due, interest_due, fees_due)
  select v_fin, v_loan, v_terms, installment_no, due_date, principal_due, interest_due, coalesce(fees_due, 0)
  from jsonb_to_recordset(p_schedule) as t(installment_no int, due_date date, principal_due numeric, interest_due numeric, fees_due numeric);

  perform refresh_loan_status(v_loan);
  return v_loan;
end $$;

-- Allocation order: oldest instalment first; within an instalment fees → interest → principal.
-- Advance payments simply flow into the next unpaid instalments. Overpayment is rejected.
create function record_payment(
  p_loan_id uuid, p_amount numeric, p_payment_date date, p_method payment_method,
  p_reference text default null, p_notes text default null, p_receipt_document_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_fin uuid := auth_financier_id(); v_loan loans%rowtype; v_pay uuid;
  v_rem numeric(14,2) := p_amount; r record; f numeric; i numeric; p numeric;
begin
  if not has_permission('payments.record') then raise exception 'permission denied: payments.record' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_amount <> round(p_amount, 2) then raise exception 'amount cannot have more than 2 decimals'; end if;
  if p_payment_date > today_ist() then raise exception 'payment_date cannot be in the future'; end if;
  select * into v_loan from loans where id = p_loan_id and financier_id = v_fin for update;
  if not found then raise exception 'loan not found'; end if;
  if v_loan.status not in ('disbursed','active','overdue') then raise exception 'loan status % does not accept payments', v_loan.status; end if;

  insert into payments (financier_id, loan_id, kind, amount, payment_date, method, transaction_ref, notes, receipt_document_id)
  values (v_fin, p_loan_id, 'receipt', p_amount, p_payment_date, p_method, p_reference, p_notes, p_receipt_document_id)
  returning id into v_pay;

  for r in select * from v_schedule_status where loan_id = p_loan_id and total_outstanding > 0 order by installment_no loop
    exit when v_rem <= 0;
    f := least(v_rem, r.fees_outstanding);     v_rem := v_rem - f;
    i := least(v_rem, r.interest_outstanding); v_rem := v_rem - i;
    p := least(v_rem, r.principal_outstanding); v_rem := v_rem - p;
    if f + i + p > 0 then
      insert into payment_allocations (financier_id, payment_id, schedule_id, principal_amount, interest_amount, fees_amount)
      values (v_fin, v_pay, r.schedule_id, p, i, f);
    end if;
  end loop;
  if v_rem > 0 then raise exception 'payment exceeds total receivable by %', v_rem; end if;

  perform refresh_loan_status(p_loan_id);
  return v_pay;
end $$;

-- A reversal is a new negative ledger entry mirroring the original allocations. Nothing is edited or deleted.
create function reverse_payment(p_payment_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_fin uuid := auth_financier_id(); v_pay payments%rowtype; v_new uuid;
begin
  if not has_permission('payments.reverse') then raise exception 'permission denied: payments.reverse' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'a reason is required'; end if;
  select * into v_pay from payments where id = p_payment_id and financier_id = v_fin;
  if not found then raise exception 'payment not found'; end if;
  if v_pay.kind <> 'receipt' then raise exception 'only receipts can be reversed'; end if;
  perform 1 from loans where id = v_pay.loan_id for update;
  if exists (select 1 from payments where reverses_payment_id = p_payment_id) then raise exception 'payment already reversed'; end if;

  insert into payments (financier_id, loan_id, kind, amount, payment_date, method, transaction_ref, reverses_payment_id, reversal_reason)
  values (v_fin, v_pay.loan_id, 'reversal', -v_pay.amount, today_ist(), v_pay.method, v_pay.transaction_ref, p_payment_id, p_reason)
  returning id into v_new;
  insert into payment_allocations (financier_id, payment_id, schedule_id, principal_amount, interest_amount, fees_amount)
  select v_fin, v_new, schedule_id, -principal_amount, -interest_amount, -fees_amount from payment_allocations where payment_id = p_payment_id;

  perform refresh_loan_status(v_pay.loan_id);
  return v_new;
end $$;

create function log_document_access(p_document_id uuid, p_version_id uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare v_fin uuid := auth_financier_id();
begin
  if v_fin is null or not exists (select 1 from documents where id = p_document_id and financier_id = v_fin) then
    raise exception 'document not found' using errcode = '42501';
  end if;
  insert into document_access_logs (financier_id, document_id, version_id, actor_id, action)
  values (v_fin, p_document_id, p_version_id, auth.uid(), p_action);
end $$;

-- ───────────── row-level security ─────────────
do $$
declare t text;
begin
  foreach t in array array['financiers','profiles','id_counters','customers','vehicles','loans','loan_terms','repayment_schedules',
                           'documents','document_versions','document_access_logs','payments','payment_allocations','business_settings','audit_logs']
  loop execute format('alter table %I enable row level security', t); end loop;
end $$;

create policy financiers_select on financiers for select to authenticated using (id = auth_financier_id());

create policy profiles_select on profiles for select to authenticated using (id = auth.uid() or financier_id = auth_financier_id());
create policy profiles_update on profiles for update to authenticated
  using (financier_id = auth_financier_id() and auth_role() = 'owner' and role = 'employee')
  with check (financier_id = auth_financier_id() and role = 'employee');

-- Read access: any active member of the tenant. Write access: per permission.
do $$
declare t text;
begin
  foreach t in array array['customers','vehicles','loans','loan_terms','repayment_schedules','documents','document_versions','payments','payment_allocations','business_settings']
  loop execute format('create policy %I on %I for select to authenticated using (financier_id = auth_financier_id())', t || '_select', t); end loop;
end $$;

create policy customers_insert on customers for insert to authenticated with check (financier_id = auth_financier_id() and has_permission('customers.write'));
create policy customers_update on customers for update to authenticated using (financier_id = auth_financier_id() and has_permission('customers.write')) with check (financier_id = auth_financier_id());
create policy vehicles_insert  on vehicles  for insert to authenticated with check (financier_id = auth_financier_id() and has_permission('vehicles.write'));
create policy vehicles_update  on vehicles  for update to authenticated using (financier_id = auth_financier_id() and has_permission('vehicles.write')) with check (financier_id = auth_financier_id());
create policy documents_insert on documents for insert to authenticated with check (financier_id = auth_financier_id() and has_permission('documents.upload'));
create policy documents_update on documents for update to authenticated using (financier_id = auth_financier_id() and has_permission('documents.upload')) with check (financier_id = auth_financier_id());
create policy docversions_insert on document_versions for insert to authenticated with check (financier_id = auth_financier_id() and has_permission('documents.upload'));
create policy settings_insert on business_settings for insert to authenticated with check (financier_id = auth_financier_id() and auth_role() = 'owner');
create policy settings_update on business_settings for update to authenticated using (financier_id = auth_financier_id() and auth_role() = 'owner') with check (financier_id = auth_financier_id());
create policy audit_select on audit_logs for select to authenticated using (financier_id = auth_financier_id() and auth_role() = 'owner');
create policy access_logs_select on document_access_logs for select to authenticated using (financier_id = auth_financier_id() and auth_role() = 'owner');
-- No policies on payments/allocations/loans/terms/schedules for insert/update/delete: those go through the RPCs above.
-- No delete policy exists anywhere: records are never hard-deleted by users.

-- ───────────── grants (least privilege) ─────────────
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public;

grant usage on schema public to authenticated;
grant select on financiers, profiles, customers, vehicles, loans, loan_terms, repayment_schedules, documents, document_versions,
                document_access_logs, payments, payment_allocations, business_settings, audit_logs,
                v_schedule_status, v_loan_outstanding, v_documents, v_dashboard_summary to authenticated;
grant insert, update on customers, vehicles, documents, business_settings to authenticated;
grant insert on document_versions to authenticated;
grant update (full_name, phone, permissions, is_active) on profiles to authenticated;
grant execute on function auth_financier_id(), auth_role(), has_permission(text), next_code(text, text), today_ist(),
  create_loan(uuid, uuid, numeric, date, date, date, jsonb, jsonb),
  record_payment(uuid, numeric, date, payment_method, text, text, uuid),
  reverse_payment(uuid, text), log_document_access(uuid, uuid, text) to authenticated;
-- refresh_loan_status / refresh_all_loan_statuses stay service-role only (daily job).
