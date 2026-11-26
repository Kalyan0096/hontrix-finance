-- Milestone 7: required-documents rules, missing-document detection, follow-up tasks, live alerts.

-- ───────────── required documents (owner-configurable per business) ─────────────
create table required_document_rules (
  financier_id uuid not null default auth_financier_id() references financiers(id),
  category document_category not null,
  created_at timestamptz not null default now(),
  primary key (financier_id, category)
);

create function seed_default_required_documents() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into required_document_rules (financier_id, category)
  select new.id, c from unnest(array['rc','insurance','kyc','address_proof','loan_agreement']::document_category[]) c on conflict do nothing;
  return new;
end $$;
create trigger trg_seed_rules after insert on financiers for each row execute function seed_default_required_documents();
insert into required_document_rules (financier_id, category)
select f.id, c from financiers f cross join unnest(array['rc','insurance','kyc','address_proof','loan_agreement']::document_category[]) c on conflict do nothing;

-- A requirement is met by any non-rejected document of that type for the customer that is not tied to a different loan or vehicle.
-- (An expired document still counts as present; expiry has its own alert.)
create view v_loan_missing_documents with (security_invoker = true) as
select l.id as loan_id, l.financier_id, l.loan_no, l.customer_id, l.vehicle_id, r.category
from loans l join required_document_rules r on r.financier_id = l.financier_id
where l.status in ('active', 'overdue') and not exists (
  select 1 from documents d
  where d.financier_id = l.financier_id and d.customer_id = l.customer_id and d.category = r.category and d.status <> 'rejected'
    and (d.loan_id is null or d.loan_id = l.id) and (d.vehicle_id is null or d.vehicle_id = l.vehicle_id));

create view v_loan_file_status with (security_invoker = true) as
select l.id as loan_id, l.financier_id, l.loan_no, l.customer_id, l.vehicle_id,
  (select count(*) from required_document_rules r where r.financier_id = l.financier_id) as required_count,
  (select count(*) from v_loan_missing_documents m where m.loan_id = l.id) as missing_count
from loans l where l.status in ('active', 'overdue');

-- ───────────── follow-up tasks ─────────────
create type task_status as enum ('open', 'done', 'cancelled');
create table follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  financier_id uuid not null default auth_financier_id() references financiers(id),
  customer_id uuid,
  loan_id uuid,
  title text not null check (length(trim(title)) between 2 and 200),
  notes text,
  due_date date not null,
  assigned_to uuid references profiles(id),
  status task_status not null default 'open',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  completed_by uuid,
  completed_at timestamptz,
  unique (id, financier_id),
  foreign key (customer_id, financier_id) references customers (id, financier_id),
  foreign key (loan_id, financier_id) references loans (id, financier_id)
);
create index tasks_open_idx on follow_up_tasks (financier_id, due_date) where status = 'open';

create function task_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not null and not exists (select 1 from profiles where id = new.assigned_to and financier_id = new.financier_id) then
    raise exception 'assigned person is not part of this business' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'open'; new.completed_by := null; new.completed_at := null;
  else
    if new.financier_id <> old.financier_id or new.customer_id is distinct from old.customer_id or new.loan_id is distinct from old.loan_id then
      raise exception 'task links cannot be changed';
    end if;
    if new.status <> old.status then
      if new.status = 'open' then new.completed_by := null; new.completed_at := null;
      else new.completed_by := auth.uid(); new.completed_at := now(); end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_task_guard before insert or update on follow_up_tasks for each row execute function task_guard();
create trigger trg_audit after insert or update or delete on follow_up_tasks for each row execute function audit_row();

create function audit_row_rules() returns trigger language plpgsql security definer set search_path = public as $$
declare r required_document_rules;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  insert into audit_logs (financier_id, actor_id, action, table_name, record_id, old_data, new_data)
  values (r.financier_id, auth.uid(), tg_op, tg_table_name, null,
          case when tg_op = 'DELETE' then to_jsonb(old) end, case when tg_op = 'INSERT' then to_jsonb(new) end);
  return null;
end $$;
create trigger trg_audit after insert or update or delete on required_document_rules for each row execute function audit_row_rules();

-- ───────────── live alerts (computed from current data; nothing to go stale) ─────────────
create view v_alerts with (security_invoker = true) as
-- overdue loans
select 'overdue_loan'::text as kind, 'high'::text as severity, o.financier_id, o.customer_id, c.full_name as customer_name, o.loan_id, o.loan_no, o.vehicle_id,
       v.registration_number, null::uuid as document_id, null::uuid as task_id, o.next_due_date as due_date, o.overdue_amount as amount,
       o.overdue_installments::bigint as count_value, null::text as label
from v_loan_outstanding o join customers c on c.id = o.customer_id join vehicles v on v.id = o.vehicle_id
where o.overdue_amount > 0 and o.status in ('active', 'overdue')
union all
-- instalments due in the next 7 days
select 'upcoming_installment', case when s.due_date = today_ist() then 'medium' else 'low' end, s.financier_id, l.customer_id, c.full_name, l.id, l.loan_no, l.vehicle_id,
       v.registration_number, null, null, s.due_date, s.total_outstanding, 1::bigint, null
from v_schedule_status s join loans l on l.id = s.loan_id join customers c on c.id = l.customer_id join vehicles v on v.id = l.vehicle_id
where s.total_outstanding > 0 and s.due_date between today_ist() and today_ist() + 7 and l.status in ('active', 'overdue')
union all
-- insurance of vehicles that have an open loan
select case when v.insurance_expiry < today_ist() then 'insurance_expired' else 'insurance_expiring' end,
       case when v.insurance_expiry < today_ist() then 'high' else 'medium' end, v.financier_id, v.customer_id, c.full_name, ln.id, ln.loan_no, v.id,
       v.registration_number, null, null, v.insurance_expiry, null, 1::bigint, null
from vehicles v join customers c on c.id = v.customer_id
cross join lateral (select l.id, l.loan_no from loans l where l.vehicle_id = v.id and l.status in ('active', 'overdue') order by l.loan_no limit 1) ln
where v.insurance_expiry <= today_ist() + 30
union all
-- other documents with an expiry date (insurance linked to a vehicle is covered above)
select case when d.expiry_date < today_ist() then 'document_expired' else 'document_expiring' end,
       case when d.expiry_date < today_ist() then 'high' else 'medium' end, d.financier_id, d.customer_id, c.full_name, null, null, d.vehicle_id,
       null, d.id, null, d.expiry_date, null, 1::bigint, d.category::text
from documents d join customers c on c.id = d.customer_id
where d.expiry_date <= today_ist() + 30 and d.status <> 'rejected' and not (d.category = 'insurance' and d.vehicle_id is not null)
union all
-- loan files missing required documents
select 'missing_documents', 'medium', f.financier_id, f.customer_id, c.full_name, f.loan_id, f.loan_no, f.vehicle_id, null, null, null, null, null, f.missing_count, null
from v_loan_file_status f join customers c on c.id = f.customer_id where f.missing_count > 0
union all
-- documents waiting for a staff check (one row per business)
select 'documents_to_verify', 'low', financier_id, null, null, null, null, null, null, null, null, null, null, count(*), null
from documents where status in ('uploaded', 'pending_review') group by financier_id
union all
-- follow-ups that are due
select 'follow_up', case when t.due_date < today_ist() then 'high' else 'medium' end, t.financier_id, t.customer_id, c.full_name, t.loan_id, l.loan_no, null, null, null,
       t.id, t.due_date, null, 1::bigint, t.title
from follow_up_tasks t left join customers c on c.id = t.customer_id left join loans l on l.id = t.loan_id
where t.status = 'open' and t.due_date <= today_ist();

-- dashboard gets two more figures (columns appended; existing ones unchanged)
create or replace view v_dashboard_summary with (security_invoker = true) as
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
  (select count(*) from vehicles where insurance_expiry between today_ist() and today_ist() + 30) as insurance_expiring_30d,
  (select count(*) from documents where status in ('uploaded','pending_review')) as documents_to_verify,
  (select count(*) from v_loan_file_status where missing_count > 0)         as incomplete_loan_files,
  (select count(*) from follow_up_tasks where status = 'open' and due_date <= today_ist()) as follow_ups_due;

-- ───────────── security ─────────────
alter table required_document_rules enable row level security;
alter table follow_up_tasks enable row level security;
create policy rules_select on required_document_rules for select to authenticated using (financier_id = auth_financier_id());
create policy rules_insert on required_document_rules for insert to authenticated with check (financier_id = auth_financier_id() and auth_role() = 'owner');
create policy rules_delete on required_document_rules for delete to authenticated using (financier_id = auth_financier_id() and auth_role() = 'owner');
create policy tasks_select on follow_up_tasks for select to authenticated using (financier_id = auth_financier_id());
create policy tasks_insert on follow_up_tasks for insert to authenticated with check (financier_id = auth_financier_id());
create policy tasks_update on follow_up_tasks for update to authenticated using (financier_id = auth_financier_id()) with check (financier_id = auth_financier_id());

revoke all on all tables in schema public from anon;
revoke all on required_document_rules, follow_up_tasks, v_alerts, v_loan_missing_documents, v_loan_file_status from authenticated;
grant select on required_document_rules, follow_up_tasks, v_alerts, v_loan_missing_documents, v_loan_file_status to authenticated;
grant insert, delete on required_document_rules to authenticated;
grant insert, update on follow_up_tasks to authenticated;
grant select on v_dashboard_summary to authenticated;
grant all on all tables in schema public to service_role;
revoke execute on function seed_default_required_documents(), task_guard(), audit_row_rules() from public, anon, authenticated;
