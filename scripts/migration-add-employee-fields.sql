-- ============================================================
-- 사원등록 페이지용 신규 컬럼 추가
-- ------------------------------------------------------------
-- users 테이블에 다음 컬럼 추가:
--   photo_url, emergency_contact, postal_code,
--   uniform_top_size, uniform_bottom_size, safety_shoes_size
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS photo_url            TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact    TEXT,
  ADD COLUMN IF NOT EXISTS postal_code          TEXT,
  ADD COLUMN IF NOT EXISTS uniform_top_size     TEXT,
  ADD COLUMN IF NOT EXISTS uniform_bottom_size  TEXT,
  ADD COLUMN IF NOT EXISTS safety_shoes_size    TEXT;

-- 검증
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN (
    'photo_url','emergency_contact','postal_code',
    'uniform_top_size','uniform_bottom_size','safety_shoes_size'
  );

-- ============================================================
-- 사원 사진 저장용 Storage 버킷 (대시보드 UI에서 수동 생성도 가능)
-- ------------------------------------------------------------
-- INSERT가 권한 문제로 실패하면 Supabase Dashboard에서 수동 생성:
--   Storage → New bucket
--     - Name: employee-photos
--     - Public: ✓
--     - File size limit: 3MB
--     - MIME: image/jpeg, image/png, image/webp
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-photos',
  'employee-photos',
  TRUE,
  3145728,   -- 3MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 정책 (idempotent)
DROP POLICY IF EXISTS "employee_photos_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "employee_photos_public_read"          ON storage.objects;
DROP POLICY IF EXISTS "employee_photos_authenticated_delete" ON storage.objects;

CREATE POLICY "employee_photos_authenticated_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'employee-photos');

CREATE POLICY "employee_photos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'employee-photos');

CREATE POLICY "employee_photos_authenticated_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'employee-photos');
