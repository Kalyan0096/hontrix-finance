-- Hontrix-PDTR — Milestone 1: core schema (tenancy, customers, vehicles, loans,
-- repayment ledger, documents, audit). Money is numeric(14,2) in INR.
-- Every business row carries financier_id; composite FKs keep related rows in one tenant.

create type app_role         as enum ('platform_admin','owner','employee');
create type customer_status  as enum ('active','inactive','blocked');
create type vehicle_category as enum ('car','commercial','truck','pickup','two_wheeler','other');
create type loan_status      as enum ('application','under_review','approved','rejected','disbursed','active','overdue','closed','restructured');
create type interest_method  as enum ('flat','reducing');
create type payment_frequency as enum ('weekly','fortnightly','monthly');
create type payment_kind     as enum ('receipt','reversal');
create type payment_method   as enum ('cash','upi','bank_transfer','cheque','other');
create type document_category as enum ('rc','insurance','kyc','address_proof','pan','loan_application','loan_agreement','promissory_note','hypothecation','payment_receipt','other');
create type document_status  as enum ('missing','uploaded','pending_review','verified','rejected','expired','needs_attention');

create function today_ist() returns date language sql stable as
$$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- ───────────── tenants and users ─────────────
create table financiers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  financier_id uuid references financiers(id),
  role app_role not null,
  full_name text not null,
  phone text,
  -- employee permissions: customers.write, vehicles.write, loans.write, payments.record,
  -- payments.reverse, documents.upload, documents.verify. Owners implicitly hold all.
  permissions text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((role = 'platform_admin') = (financier_id is null))
);

create function auth_financier_id() returns uuid language sql stable security definer set search_path = public as
$$ select financier_id from profiles where id = auth.uid() and is_active $$;

create function auth_role() returns app_role language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and is_active $$;

create function has_permission(p text) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles
                  where id = auth.uid() and is_active and financier_id is not null
                    and (role = 'owner' or p = any(permissions))) $$;

create table id_counters (
  financier_id uuid not null references financiers(id),
  kind text not null,
  last_value bigint not null default 0,
  primary key (financier_id, kind)
);

create function next_code(p_kind text, p_prefix text) returns text
language plpgsql security definer set search_path = public as $$
declare v_fin uuid := auth_financier_id(); v bigint;
begin
  if v_fin is null then raise exception 'no financier context' using errcode = '42501'; end if;
  insert into id_counters(financier_id, kind, last_value) values (v_fin, p_kind, 1)
  on conflict (financier_id, kind) do update set last_value = id_counters.last_value + 1
  returning last_value into v;
  return p_prefix || lpad(v::text, 5, '0');
end $$;

-- ───────────── customers and vehicles ─────────────
create table customers (
  id uuid primary key default gen_random_uuid(),
  financier_id uuid not null default auth_financier_id() references financiers(id),
  customer_no text not null default next_code('customer', 'C'),
  full_name text not null check (length(trim(full_name)) > 0),
  mobile text not null check (mobile ~ '^[6-9][0-9]{9}$'),
  address text, district text, state text,
  status customer_status not null default 'active',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, financier_id),
  unique (financier_id, customer_no)
);
create index customers_name_idx   on customers (financier_id, lower(full_name));
create index customers_mobile_idx on customers (financier_id, mobile);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  financier_id uuid not null default auth_financier_id() references financiers(id),
  customer_id uuid not null,
  registration_number text not null check (registration_number = upper(registration_number) and registration_number !~ '\s'),
  make text, model text,
  manufacture_year int check (manufacture_year between 1950 and 2100),
  category vehicle_category not null default 'other',
  chassis_number text, engine_number text, registered_owner text,
  insurance_expiry date,
  hypothecation_details text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, financier_id),
  unique (financier_id, registration_number),
  foreign key (customer_id, financier_id) references customers (id, financier_id)
);
create index vehicles_customer_idx on vehicles (customer_id);

-- ───────────── loans ─────────────
create table loans (
  id uuid primary key default gen_random_uuid(),
  financier_id uuid not null default auth_financier_id() references financiers(id),
  loan_no text not null default next_code('loan', 'L'),
  customer_id uuid not null,
  vehicle_id uuid not null,
  status loan_status not null default 'active',
  application_date date,
  approval_date date,
  disbursement_date date,
  principal_amount numeric(14,2) not null check (principal_amount > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, financier_id),
  unique (financier_id, loan_no),
  foreign key (customer_id, financier_id) references customers (id, financier_id),
  foreign key (vehicle_id, financier_id)  references vehicles (id, financier_id)
);
create index loans_customer_idx on loans (customer_id);
create index loans_status_idx   on loans (financier_id, status);

-- Terms are versioned so a restructure creates a new version instead of overwriting.
create table loan_terms (
  id uuid primary key default gen_random_uuid(),
  financier_id uuid not null references financiers(id),
  loan_id uuid not null,
  version int not null default 1,
  is_current boolean not null default true,
  interest_rate_pa numeric(7,4) not null check (interest_rate_pa >= 0),
  interest_method interest_method not null,
  tenure_installments int not null check (tenure_installments > 0),
  frequency payment_frequency not null,
  installment_amount numeric(14,2) not null check (installment_amount > 0),
  first_due_date date not null,
  final_due_date date not null,
  processing_fee numeric(14,2) not null default 0 check (processing_fee >= 0),
  other_fees numeric(14,2) not null default 0 check (other_fees >= 0),
  notes text,
  created_at timestamptz not null default now(),
  unique (id, financier_id),
  unique (loan_id, version),
  check (final_due_date >= first_due_date),
  foreign key (loan_id, financier_id) references loans (id, financier_id)
);
create unique index loan_terms_one_current on loan_terms (loan_id) where is_current;

create table repayment_schedules (
  id uuid primary key default gen_random_uuid(),
  financier_id uuid not null references financiers(id),
  loan_id uuid not null,
  loan_terms_id uuid not null,
  installment_no int not null check (installment_no > 0),
  due_date date not null,
  principal_due numeric(14,2) not null check (principal_due >= 0),
  interest_due  numeric(14,2) not null check (interest_due >= 0),
  fees_due      numeric(14,2) not null default 0 check (fees_due >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, financier_id),
  unique (loan_terms_id, installment_no),
  foreign key (loan_id, financier_id) references loans (id, financier_id),
  foreign key (loan_terms_id, financier_id) references loan_terms (id, financier_id)
);
create index schedules_loan_idx on repayment_schedules (loan_id, installment_no);
create index schedules_due_idx  on repayment_schedules (financier_id, due_date) where is_active;

-- ───────────── documents (files live in private storage; only paths here) ─────────────
create table documents (
  id uuid primary key default gen_random_uuid(),
  financier_id uuid not null default auth_financier_id() references financiers(id),
  customer_id uuid not null,
  vehicle_id uuid,
  loan_id uuid,
  category document_category not null,
  title text,
  status document_status not null default 'uploaded',
  expiry_date date,
  notes text,
  verified_by uuid,
  verified_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, financier_id),
  foreign key (customer_id, financier_id) references customers (id, financier_id),
  foreign key (vehicle_id, financier_id)  references vehicles (id, financier_id),
  foreign key (loan_id, financier_id)     references loans (id, financier_id)
);
create index documents_customer_idx on documents (customer_id, category);
create index documents_expiry_idx   on documents (financier_id, expiry_date) where expiry_date is not null;

create table document_versions (
  id uuid primary key default gen_random_uuid(),
  financier_id uuid not null default auth_financier_id() references financiers(id),
  document_id uuid not null,
  version_no int not null,
  storage_path text not null,
  file_name text,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now(),
  unique (document_id, version_no),
  foreign key (document_id, financier_id) references documents (id, financier_id),
  check (storage_path like financier_id::text || '/%')
);
create index document_versions_hash_idx on document_versions (financier_id, sha256);

create table document_access_logs (
  id bigint generated always as identity primary key,
  financier_id uuid not null references financiers(id),
  document_id uuid not null,
  version_id uuid,
  actor_id uuid,
  action text not null check (action in ('preview','download')),
  created_at timestamptz not null default now()
);

-- ───────────── payments: append-only ledger ─────────────
create table payments (
  id uuid primary key default gen_random_uuid(),
  financier_id uuid not null references financiers(id),
  loan_id uuid not null,
  kind payment_kind not null default 'receipt',
  amount numeric(14,2) not null,
  payment_date date not null,
  method payment_method not null,
  transaction_ref text,
  receipt_document_id uuid,
  reverses_payment_id uuid,
  reversal_reason text,
  notes text,
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, financier_id),
  foreign key (loan_id, financier_id) references loans (id, financier_id),
  foreign key (receipt_document_id, financier_id) references documents (id, financier_id),
  foreign key (reverses_payment_id, financier_id) references payments (id, financier_id),
  check (
    (kind = 'receipt'  and amount > 0 and reverses_payment_id is null) or
    (kind = 'reversal' and amount < 0 and reverses_payment_id is not null
                       and coalesce(length(trim(reversal_reason)), 0) > 0)
  )
);
create unique index payments_one_reversal on payments (reverses_payment_id) where kind = 'reversal';
create index payments_loan_idx on payments (loan_id);
create index payments_date_idx on payments (financier_id, payment_date);

create table payment_allocations (
  id uuid primary key default gen_random_uuid(),
  financier_id uuid not null references financiers(id),
  payment_id uuid not null,
  schedule_id uuid not null,
  principal_amount numeric(14,2) not null default 0,
  interest_amount  numeric(14,2) not null default 0,
  fees_amount      numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  foreign key (payment_id, financier_id)  references payments (id, financier_id),
  foreign key (schedule_id, financier_id) references repayment_schedules (id, financier_id),
  check (principal_amount <> 0 or interest_amount <> 0 or fees_amount <> 0)
);
create index allocations_schedule_idx on payment_allocations (schedule_id);
create index allocations_payment_idx  on payment_allocations (payment_id);

-- ───────────── settings, audit ─────────────
create table business_settings (
  financier_id uuid not null references financiers(id),
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (financier_id, key)
);

create table audit_logs (
  id bigint generated always as identity primary key,
  financier_id uuid,
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_record_idx on audit_logs (financier_id, table_name, record_id);

create function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
begin
  insert into audit_logs (financier_id, actor_id, action, table_name, record_id, old_data, new_data)
  values ((j->>'financier_id')::uuid, auth.uid(), tg_op, tg_table_name, (j->>'id')::uuid,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end $$;

create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% on % is not allowed: this table is append-only', tg_op, tg_table_name using errcode = '42501';
end $$;

do $$
declare t text;
begin
  foreach t in array array['customers','vehicles','loans','loan_terms','repayment_schedules','documents',
                           'document_versions','payments','payment_allocations','profiles','business_settings']
  loop
    execute format('create trigger trg_audit after insert or update or delete on %I for each row execute function audit_row()', t);
  end loop;
  foreach t in array array['payments','payment_allocations','audit_logs','document_versions','document_access_logs']
  loop
    execute format('create trigger trg_append_only before update or delete on %I for each row execute function forbid_mutation()', t);
  end loop;
end $$;

create function touch_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at := now(); return new; end $$;
create trigger trg_touch before update on customers for each row execute function touch_updated_at();
create trigger trg_touch before update on vehicles  for each row execute function touch_updated_at();
create trigger trg_touch before update on loans     for each row execute function touch_updated_at();

create function document_version_no() returns trigger language plpgsql as $$
begin
  if new.version_no is null then
    select coalesce(max(version_no), 0) + 1 into new.version_no from document_versions where document_id = new.document_id;
  end if;
  return new;
end $$;
create trigger trg_version_no before insert on document_versions for each row execute function document_version_no();
-- version_no is NOT NULL but filled by the trigger above, so it is declared without default.

create function documents_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('verified','rejected') then
      raise exception 'new documents cannot start as %', new.status using errcode = '42501';
    end if;
  else
    if new.status is distinct from old.status and new.status in ('verified','rejected') then
      if not has_permission('documents.verify') then
        raise exception 'permission denied: documents.verify' using errcode = '42501';
      end if;
      new.verified_by := auth.uid(); new.verified_at := now();
    elsif new.status is distinct from old.status and old.status = 'verified' then
      new.verified_by := null; new.verified_at := null;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger trg_documents_guard before insert or update on documents for each row execute function documents_guard();
