-- Private document bucket. Skipped automatically where Supabase Storage is not installed (e.g. plain Postgres tests).
-- Object path convention: <financier_id>/<customer_id>/<document_id>/<version_no>-<filename>
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('documents', 'documents', false, 15728640, array['application/pdf','image/jpeg','image/png'])
    on conflict (id) do nothing;

    execute $p$ create policy documents_read on storage.objects for select to authenticated
      using (bucket_id = 'documents' and (storage.foldername(name))[1] = public.auth_financier_id()::text) $p$;
    execute $p$ create policy documents_write on storage.objects for insert to authenticated
      with check (bucket_id = 'documents' and (storage.foldername(name))[1] = public.auth_financier_id()::text
                  and public.has_permission('documents.upload')) $p$;
    -- No update/delete policies: stored files are immutable; a replacement is a new version path.
  end if;
end $$;
