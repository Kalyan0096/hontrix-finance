-- Milestone 6: reporting queries. All are SECURITY INVOKER, so row-level security limits them to the caller's business.

-- Overdue as it stood at the START of p_date: instalments due before p_date, minus payments dated before p_date.
create function overdue_as_of(p_date date) returns numeric
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(greatest(s.principal_due + s.interest_due + s.fees_due - coalesce(a.paid, 0), 0)), 0)
  from repayment_schedules s
  left join lateral (
    select sum(al.principal_amount + al.interest_amount + al.fees_amount) as paid
    from payment_allocations al join payments p on p.id = al.payment_id
    where al.schedule_id = s.id and p.payment_date < p_date
  ) a on true
  where s.is_active and s.due_date < p_date
$$;

-- One row per month for the last p_months (max 36), oldest first. overdue_amount is the position at the end of that month
-- (for the current month: as of the start of today). Collections are net of reversals.
create function report_monthly(p_months int default 12) returns table (
  month date, disbursed_count bigint, disbursed_amount numeric, collected numeric, overdue_amount numeric
) language sql stable security invoker set search_path = public as $$
  with m as (
    select (date_trunc('month', today_ist()) - make_interval(months => n))::date as month
    from generate_series(0, greatest(least(p_months, 36), 1) - 1) n
  )
  select m.month,
    (select count(*) from loans l where l.disbursement_date >= m.month and l.disbursement_date < (m.month + interval '1 month')::date),
    (select coalesce(sum(l.principal_amount), 0) from loans l where l.disbursement_date >= m.month and l.disbursement_date < (m.month + interval '1 month')::date),
    (select coalesce(sum(p.amount), 0) from payments p where p.payment_date >= m.month and p.payment_date < (m.month + interval '1 month')::date),
    overdue_as_of(least((m.month + interval '1 month')::date, today_ist()))
  from m order by m.month
$$;

create function report_daily_collections(p_from date, p_to date) returns table (day date, receipts bigint, collected numeric)
language sql stable security invoker set search_path = public as $$
  select p.payment_date, count(*) filter (where p.kind = 'receipt'), sum(p.amount)
  from payments p where p.payment_date between p_from and p_to
  group by p.payment_date order by p.payment_date
$$;

create view v_category_distribution with (security_invoker = true) as
select v.category, count(*) as loans_count, coalesce(sum(l.principal_amount), 0) as disbursed_amount
from loans l join vehicles v on v.id = l.vehicle_id
where l.disbursement_date is not null
group by v.category;

create view v_loan_status_distribution with (security_invoker = true) as
select (case when status = 'active' and overdue_amount > 0 then 'overdue' else status::text end) as status, count(*) as loans_count
from v_loan_outstanding group by 1;

-- Tighten function access: nothing is callable by anonymous or public roles unless listed here.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function auth_financier_id(), auth_role(), has_permission(text), next_code(text, text), today_ist(),
  create_loan(uuid, uuid, numeric, date, date, date, jsonb, jsonb),
  record_payment(uuid, numeric, date, payment_method, text, text, uuid),
  reverse_payment(uuid, text), log_document_access(uuid, uuid, text),
  register_document_upload(uuid, boolean, uuid, uuid, uuid, document_category, text, date, text, text, text, bigint, text),
  overdue_as_of(date), report_monthly(int), report_daily_collections(date, date) to authenticated;
grant select on v_category_distribution, v_loan_status_distribution to authenticated;
