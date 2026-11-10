-- Private bucket for robot photos. Not public: images are shown via signed URLs.
-- Limits are enforced here (server side) in addition to client-side compression.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'robot-photos',
  'robot-photos',
  false,
  5242880, -- 5 MiB; client compresses to well under 1 MiB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects already has RLS enabled by Supabase. Policies below apply to
-- this bucket only and grant access to the `authenticated` role only.
-- No UPDATE policy: uploads use unique, deterministic paths and are never
-- overwritten, so retries should use upsert:false and treat "already exists"
-- as success.

create policy "robot-photos: read"
  on storage.objects for select to authenticated
  using (bucket_id = 'robot-photos');

create policy "robot-photos: upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'robot-photos');

create policy "robot-photos: delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'robot-photos');
