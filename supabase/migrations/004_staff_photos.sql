-- Staff profile photos.
--
-- Photos are uploaded through /api/profile/photo (server side, service key), so
-- the bucket needs no storage policies. It is public: a staff photo is not
-- private, and the file names carry a timestamp so they cannot be guessed.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
