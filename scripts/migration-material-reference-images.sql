-- ============================================================
-- 자재 참조 사진 — 자재당 최대 2장
-- ------------------------------------------------------------
-- 자재 상세 화면에서 참조 자료로 첨부하는 사진 URL 2개.
-- 기존 소견서 이미지(opinion_image_url, 견적서 자동 첨부용)와 별개.
--
-- 추가
--   · materials.reference_image_url1 : 참조 사진 1
--   · materials.reference_image_url2 : 참조 사진 2
--
-- Storage 버킷
--   "material-references" 버킷이 Supabase Storage 에 있어야 함.
--   (Supabase Dashboard → Storage → New bucket → public 권한)
--   * 기존 "material-opinions" 버킷과 동일한 운영 정책 권장.
--
-- idempotent: ALTER ... IF NOT EXISTS
-- ============================================================

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS reference_image_url1 TEXT,
  ADD COLUMN IF NOT EXISTS reference_image_url2 TEXT;

NOTIFY pgrst, 'reload schema';

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
    WHERE table_name='materials' AND column_name='reference_image_url2');
