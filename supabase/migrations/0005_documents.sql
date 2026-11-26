-- Milestone 5: atomic document registration, insurance-expiry sync, "to verify" count on the dashboard.

-- The browser uploads the file to private storage, then calls this once. Document row + version row are created together
-- (or not at all), the path must sit inside this tenant/customer/document folder, and related ids must belong to the customer.
create function register_document_upload(
  p_document_id uuid, p_is_new boolean, p_customer_id uuid, p_vehicle_id uuid, p_loan_id uuid,
  p_category document_category, p_title text, p_expiry date, p_storage_path text, p_file_name text,
  p_mime text, p_size bigint, p_sha256 text
) returns int language plpgsql security definer set search_path = public as $$
declare v_fin uuid := auth_financier_id(); v_ver int; v_prefix text;
begin
  if not has_permission('documents.upload') then raise exception 'permission denied: documents.upload' using errcode = '42501'; end if;
  v_prefix := v_fin::text || '/' || p_customer_id::text || '/' || p_document_id::text || '/';
  if left(p_storage_path, length(v_prefix)) <> v_prefix then raise exception 'storage path does not match document'; end if;
  if not exists (select 1 from customers where id = p_customer_id and financier_id = v_fin) then raise exception 'customer not found'; end if;
  if p_vehicle_id is not null and not exists (select 1 from vehicles where id = p_vehicle_id and customer_id = p_customer_id and financier_id = v_fin) then
    raise exception 'vehicle does not belong to this customer'; end if;
  if p_loan_id is not null and not exists (select 1 from loans where id = p_loan_id and customer_id = p_customer_id and financier_id = v_fin) then
    raise exception 'loan does not belong to this customer'; end if;

  if p_is_new then
    insert into documents (id, financier_id, customer_id, vehicle_id, loan_id, category, title, expiry_date)
    values (p_document_id, v_fin, p_customer_id, p_vehicle_id, p_loan_id, p_category, nullif(trim(p_title), ''), p_expiry);
  else
    perform 1 from documents where id = p_document_id and financier_id = v_fin and customer_id = p_customer_id for update;
    if not found then raise exception 'document not found'; end if;
    -- a replacement file must be reviewed again
    update documents set status = (case when status in ('verified','rejected','needs_attention','expired') then 'uploaded' else status end)::document_status,
                         expiry_date = coalesce(p_expiry, expiry_date)
    where id = p_document_id;
  end if;

  select coalesce(max(version_no), 0) + 1 into v_ver from document_versions where document_id = p_document_id;
  insert into document_versions (financier_id, document_id, version_no, storage_path, file_name, mime_type, size_bytes, sha256)
  values (v_fin, p_document_id, v_ver, p_storage_path, p_file_name, p_mime, p_size, p_sha256);
  return v_ver;
end $$;

-- Vehicle insurance date follows the latest non-rejected insurance document that has an expiry date.
create function sync_vehicle_insurance() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.category = 'insurance' and new.vehicle_id is not null then
    update vehicles set insurance_expiry = coalesce((select max(expiry_date) from documents
        where vehicle_id = new.vehicle_id and category = 'insurance' and status <> 'rejected' and expiry_date is not null), insurance_expiry)
    where id = new.vehicle_id;
  end if;
  return null;
end $$;
create trigger trg_sync_insurance after insert or update of expiry_date, status, category, vehicle_id on documents
  for each row execute function sync_vehicle_insurance();

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
  (select count(*) from documents where status in ('uploaded','pending_review')) as documents_to_verify;

grant execute on function register_document_upload(uuid, boolean, uuid, uuid, uuid, document_category, text, date, text, text, text, bigint, text) to authenticated;
grant select on v_dashboard_summary to authenticated;
