SET client_encoding = 'UTF8';
-- ============================================================
-- 도움말센터(Manual Center) PDF 매뉴얼 등록 지원
-- ------------------------------------------------------------
-- 기존 마크다운 본문 외에 PDF 파일을 업로드하여 매뉴얼로
-- 등록할 수 있도록 manuals 테이블에 pdf_url 컬럼을 추가하고,
-- PDF 보관용 Storage 버킷(manual-docs)을 생성합니다.
-- (migration-add-manuals.sql 실행 이후 적용)
-- ============================================================

-- 1) manuals 테이블 컬럼 추가
ALTER TABLE manuals ADD COLUMN IF NOT EXISTS pdf_url TEXT;

-- PDF 매뉴얼은 마크다운 본문이 없을 수 있으므로 content NOT NULL 해제
ALTER TABLE manuals ALTER COLUMN content DROP NOT NULL;

-- 2) PDF 보관용 Storage 버킷
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'manual-docs',
  'manual-docs',
  TRUE,
  52428800,   -- 50MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "manual_docs_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "manual_docs_public_read"          ON storage.objects;
DROP POLICY IF EXISTS "manual_docs_authenticated_delete" ON storage.objects;

CREATE POLICY "manual_docs_authenticated_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'manual-docs');

CREATE POLICY "manual_docs_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'manual-docs');

CREATE POLICY "manual_docs_authenticated_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'manual-docs');

-- 검증
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_name = 'manuals' AND column_name IN ('content', 'pdf_url');
SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'manual-docs';
