-- Run this once in Supabase Dashboard → SQL Editor
-- Creates Storage bucket + policies for recorded snaps / dubbed audio

insert into storage.buckets (id, name, public)
values ('snaps', 'snaps', true)
on conflict (id) do update set public = true;

drop policy if exists "Users can upload snaps" on storage.objects;
drop policy if exists "Public can read snaps" on storage.objects;
drop policy if exists "Users can update own snaps" on storage.objects;
drop policy if exists "Users can delete own snaps" on storage.objects;

-- Anyone authenticated can upload into their own folder: {user_id}/...
create policy "Users can upload snaps"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'snaps'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Public read (bucket is public) — simplify preview/playback for the demo
create policy "Public can read snaps"
on storage.objects for select
to public
using (bucket_id = 'snaps');

-- Users can update/delete their own files
create policy "Users can update own snaps"
on storage.objects for update
to authenticated
using (
  bucket_id = 'snaps'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can delete own snaps"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'snaps'
  and (storage.foldername(name))[1] = auth.uid()::text
);
