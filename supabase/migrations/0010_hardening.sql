-- Milestone 9 (go-live readiness): sign-in throttling and audit entries for data exports.

-- Failed/successful sign-in attempts, used only by the server (service role) to slow down password guessing.
-- Only a hash of the email is stored, never the email or password.
create table login_attempts (
  id bigint generated always as identity primary key,
  email_hash text not null,
  ip text,
  success boolean not null default false,
  created_at timestamptz not null default now()
);
create index login_attempts_email_idx on login_attempts (email_hash, created_at);
create index login_attempts_ip_idx on login_attempts (ip, created_at);
alter table login_attempts enable row level security;
revoke all on login_attempts from anon, authenticated;
grant all on login_attempts to service_role;
grant usage, select on sequence login_attempts_id_seq to service_role;

-- Owner-only: records that data was exported (who, what, when). The export itself is read through the normal row-level security.
create function log_export(p_kind text, p_detail jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_fin uuid := auth_financier_id();
begin
  if v_fin is null or auth_role() is distinct from 'owner' then raise exception 'permission denied: only the owner can export' using errcode = '42501'; end if;
  if p_kind not in ('collections', 'overdue', 'disbursed', 'sheet', 'backup', 'audit') then raise exception 'unknown export kind'; end if;
  insert into audit_logs (financier_id, actor_id, action, table_name, record_id, new_data)
  values (v_fin, auth.uid(), 'EXPORT', 'export:' || p_kind, null, coalesce(p_detail, '{}'::jsonb));
end $$;
revoke execute on function log_export(text, jsonb) from public, anon;
grant execute on function log_export(text, jsonb) to authenticated, service_role;
