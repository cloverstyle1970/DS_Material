SET client_encoding = 'UTF8';
-- ============================================================
-- 구 견적조회 (Legacy Quotes Archive)
-- ------------------------------------------------------------
-- 과거 PDF 견적서를 업로드/검색/다운로드하기 위한 아카이브 테이블과
-- 보관용 Storage 버킷(legacy-quote-docs)을 생성한다.
--
-- 정책:
--   - 파일명을 그대로 보관 (자동 파싱 최소화)
--   - 파일명 끝의 _YY.MM.DD 패턴만 quote_date 로 자동 추출
-- ============================================================

-- 1) 부분일치 검색용 trigram 확장
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2) legacy_quotes 테이블
CREATE TABLE IF NOT EXISTS legacy_quotes (
  id            BIGSERIAL PRIMARY KEY,
  pdf_filename  TEXT NOT NULL,
  pdf_url       TEXT NOT NULL,
  pdf_path      TEXT,
  quote_date    DATE,
  file_size     INTEGER,
  uploaded_by   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legacy_quotes_quote_date
  ON legacy_quotes (quote_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_legacy_quotes_created_at
  ON legacy_quotes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_legacy_quotes_filename_trgm
  ON legacy_quotes USING gin (pdf_filename gin_trgm_ops);

-- 3) RLS — 개발 단계 표준(allow all)
ALTER TABLE legacy_quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_legacy_quotes ON legacy_quotes;
CREATE POLICY allow_all_legacy_quotes
  ON legacy_quotes FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 4) Storage 버킷 (legacy-quote-docs)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'legacy-quote-docs',
  'legacy-quote-docs',
  TRUE,
  52428800,   -- 50MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "legacy_quote_docs_upload" ON storage.objects;
DROP POLICY IF EXISTS "legacy_quote_docs_read"   ON storage.objects;
DROP POLICY IF EXISTS "legacy_quote_docs_delete" ON storage.objects;

CREATE POLICY "legacy_quote_docs_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'legacy-quote-docs');

CREATE POLICY "legacy_quote_docs_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'legacy-quote-docs');

CREATE POLICY "legacy_quote_docs_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'legacy-quote-docs');

-- 5) 검증
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'legacy_quotes'
ORDER BY ordinal_position;

SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'legacy-quote-docs';
