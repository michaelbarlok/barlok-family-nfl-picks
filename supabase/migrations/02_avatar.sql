-- Add avatar_url column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Create a storage bucket for avatars (run in Supabase dashboard or via API)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);

-- Storage policies for avatars bucket:
-- Allow authenticated users to upload their own avatar
-- CREATE POLICY "Users can upload own avatar" ON storage.objects
--   FOR INSERT WITH CHECK (
--     bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
--   );

-- Allow authenticated users to update their own avatar
-- CREATE POLICY "Users can update own avatar" ON storage.objects
--   FOR UPDATE USING (
--     bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
--   );

-- Allow authenticated users to delete their own avatar
-- CREATE POLICY "Users can delete own avatar" ON storage.objects
--   FOR DELETE USING (
--     bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
--   );

-- Allow public read access to all avatars
-- CREATE POLICY "Public avatar read access" ON storage.objects
--   FOR SELECT USING (bucket_id = 'avatars');
