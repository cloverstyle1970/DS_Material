-- ============================================================
-- 사원 등록 서명(싸인) 이미지 — 위험성평가·TBM 등 서명 필요 화면에서
-- 매번 손으로 그리지 않고 등록된 서명을 재사용할 수 있도록 지원
-- ------------------------------------------------------------
-- accounts 테이블에 signature_url 컬럼 추가
-- 서명 이미지는 신규 Storage 버킷 'signatures'에 저장
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS signature_url TEXT;

-- 검증
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'accounts'
  AND column_name = 'signature_url';

-- ============================================================
-- 서명 이미지 저장용 Storage 버킷 (대시보드 UI에서 수동 생성도 가능)
-- ------------------------------------------------------------
-- INSERT가 권한 문제로 실패하면 Supabase Dashboard에서 수동 생성:
--   Storage → New bucket
--     - Name: signatures
--     - Public: ✓
--     - File size limit: 2MB
--     - MIME: image/jpeg, image/png, image/webp
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'signatures',
  'signatures',
  TRUE,
  2097152,   -- 2MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 정책 (idempotent)
DROP POLICY IF EXISTS "signatures_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "signatures_public_read"          ON storage.objects;
DROP POLICY IF EXISTS "signatures_authenticated_delete" ON storage.objects;

CREATE POLICY "signatures_authenticated_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'signatures');

CREATE POLICY "signatures_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'signatures');

CREATE POLICY "signatures_authenticated_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'signatures');

-- 검증
SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'signatures';
