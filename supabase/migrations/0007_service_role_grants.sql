-- Newer Supabase projects may not give the server-side "service_role" access to tables created through the SQL Editor.
-- The service role is the trusted server key (never used in the browser); it needs full access for admin tasks such as
-- creating the first owner and employee logins. Safe to run more than once. Browser/anonymous roles are NOT changed here.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
