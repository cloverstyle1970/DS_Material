-- ============================================================
-- 자재 소견서 이미지용 Storage 버킷
-- ------------------------------------------------------------
-- 자재품목 관리 → 자재 수정 → 소견서 이미지 업로드 시 사용
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'material-opinions',
  'material-opinions',
  TRUE,
  10485760,   -- 10MB
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "material_opinions_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "material_opinions_public_read"          ON storage.objects;
DROP POLICY IF EXISTS "material_opinions_authenticated_delete" ON storage.objects;

CREATE POLICY "material_opinions_authenticated_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'material-opinions');

CREATE POLICY "material_opinions_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'material-opinions');

CREATE POLICY "material_opinions_authenticated_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'material-opinions');

-- 검증
SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'material-opinions';
