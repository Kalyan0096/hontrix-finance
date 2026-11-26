-- Loans turn "overdue" with the calendar, not with a user action, so refresh statuses every day at 00:30 IST (19:00 UTC).
-- The app also shows overdue immediately wherever money is past due; this keeps stored statuses and reports in step.
-- Skipped silently if pg_cron is not available. On Supabase: Database → Extensions → enable pg_cron, then re-run this file.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'refresh-loan-statuses';
    perform cron.schedule('refresh-loan-statuses', '0 19 * * *', 'select public.refresh_all_loan_statuses()');
  else
    raise notice 'pg_cron not available; schedule select refresh_all_loan_statuses() daily another way';
  end if;
exception when others then
  raise notice 'could not schedule daily refresh: %', sqlerrm;
end $$;
