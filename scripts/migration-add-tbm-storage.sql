-- ============================================================
-- TBM 사진 저장용 Supabase Storage 버킷 생성
-- ------------------------------------------------------------
-- 본 SQL은 Supabase SQL Editor에서 실행하면 storage.buckets에
-- 'tbm-photos' 버킷을 추가합니다 (public read).
--
-- 만약 권한 문제로 실행이 실패하면, 대신 Supabase 대시보드 UI에서
-- 수동 생성하세요:
--   Dashboard → Storage → New bucket
--     - Name:   tbm-photos
--     - Public: ✓ (체크)
--     - File size limit: 5MB
--     - Allowed MIME types: image/jpeg, image/png, image/webp
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tbm-photos',
  'tbm-photos',
  TRUE,
  5242880,                                                      -- 5MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 업로드 정책 (인증된 모든 사용자 업로드 가능)
CREATE POLICY "tbm_photos_authenticated_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'tbm-photos');

-- 공개 읽기 정책 (URL을 알면 누구나 조회 가능)
CREATE POLICY "tbm_photos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'tbm-photos');

-- 삭제 정책 (앱 내부에서 TBM 삭제 시 사진도 함께 삭제)
CREATE POLICY "tbm_photos_authenticated_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'tbm-photos');

-- 검증
SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'tbm-photos';
