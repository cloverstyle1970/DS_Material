-- ============================================================
-- 자재 참조 사진 — 자재당 최대 2장
-- ------------------------------------------------------------
-- 자재 상세 화면에서 참조 자료로 첨부하는 사진 URL 2개.
-- 기존 소견서 이미지(opinion_image_url, 견적서 자동 첨부용)와 별개.
--
-- 추가
--   · materials.reference_image_url1 : 참조 사진 1
--   · materials.reference_image_url2 : 참조 사진 2
--   · Storage 버킷 "material-references" + RLS 정책
--     (기존 "material-opinions" 와 동일한 운영 정책)
--
-- idempotent: ALTER ... IF NOT EXISTS / INSERT ... ON CONFLICT / DROP POLICY IF EXISTS
-- ============================================================

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS reference_image_url1 TEXT,
  ADD COLUMN IF NOT EXISTS reference_image_url2 TEXT;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- Storage 버킷 + RLS 정책
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'material-references',
  'material-references',
  TRUE,
  10485760,   -- 10MB
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "material_references_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "material_references_public_read"          ON storage.objects;
DROP POLICY IF EXISTS "material_references_authenticated_delete" ON storage.objects;

CREATE POLICY "material_references_authenticated_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'material-references');

CREATE POLICY "material_references_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'material-references');

CREATE POLICY "material_references_authenticated_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'material-references');

-- ============================================================
-- 검증
-- ============================================================
SELECT
  'materials.reference_image_url1' AS chk,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='materials' AND column_name='reference_image_url1') AS cnt
UNION ALL SELECT
  'materials.reference_image_url2',
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='materials' AND column_name='reference_image_url2')
UNION ALL SELECT
  'bucket material-references',
  (SELECT COUNT(*) FROM storage.buckets WHERE id='material-references');
