-- Conversion Cycle Planner: private storage for offer screenshots.
-- Paste into Supabase: SQL Editor -> New query -> Run. Safe to run again.
-- Files are stored as <workspace id>/<offer id>/<file>.jpg and only members
-- of that workspace can see, add or delete them.

insert into storage.buckets (id, name, public)
values ('offer-images', 'offer-images', false)
on conflict (id) do nothing;

drop policy if exists "members read offer images" on storage.objects;
create policy "members read offer images" on storage.objects for select to authenticated
  using (bucket_id = 'offer-images' and public.is_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "members add offer images" on storage.objects;
create policy "members add offer images" on storage.objects for insert to authenticated
  with check (bucket_id = 'offer-images' and public.is_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "members delete offer images" on storage.objects;
create policy "members delete offer images" on storage.objects for delete to authenticated
  using (bucket_id = 'offer-images' and public.is_member(((storage.foldername(name))[1])::uuid));
