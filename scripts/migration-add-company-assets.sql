SET client_encoding = 'UTF8';
-- 회사 인감도장·로고 이미지 (견적서/발주서/거래명세서 등 출력물 날인용)
-- quote_settings 에 이미지 URL 컬럼 추가 + 회사 자산 보관 Storage 버킷 생성.
-- Supabase Dashboard > SQL Editor 에서 1회 실행 (idempotent)

ALTER TABLE quote_settings
  ADD COLUMN IF NOT EXISTS company_stamp_url TEXT,
  ADD COLUMN IF NOT EXISTS company_logo_url  TEXT;

-- 회사 자산(인감·로고) 보관 Storage 버킷
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-assets',
  'company-assets',
  TRUE,
  10485760,   -- 10MB
  ARRAY['image/png','image/jpeg','image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "company_assets_auth_upload" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_public_read" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_auth_delete" ON storage.objects;

CREATE POLICY "company_assets_auth_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'company-assets');

CREATE POLICY "company_assets_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'company-assets');

CREATE POLICY "company_assets_auth_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'company-assets');

-- 검증
SELECT column_name FROM information_schema.columns
WHERE table_name = 'quote_settings' AND column_name IN ('company_stamp_url','company_logo_url');
SELECT id, public FROM storage.buckets WHERE id = 'company-assets';
