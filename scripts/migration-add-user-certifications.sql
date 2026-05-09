-- ============================================================
-- 사원 자격정보 테이블 + Storage 버킷
-- ============================================================

CREATE TABLE IF NOT EXISTS user_certifications (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cert_name           TEXT NOT NULL,
  cert_number         TEXT,
  edu_completed_date  DATE,
  edu_next_date       DATE,
  cert_doc_url        TEXT,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_cert_user_id ON user_certifications(user_id);

ALTER TABLE user_certifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_user_certifications" ON user_certifications;
CREATE POLICY "allow_all_user_certifications" ON user_certifications FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ============================================================
-- 자격증 사본 첨부파일용 Storage 버킷 (이미지·PDF 허용)
-- ------------------------------------------------------------
-- 권한 문제로 실패 시 Dashboard → Storage → New bucket:
--   Name: cert-docs
--   Public: ✓
--   Size limit: 10MB
--   MIME: image/jpeg, image/png, image/webp, application/pdf
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cert-docs',
  'cert-docs',
  TRUE,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "cert_docs_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "cert_docs_public_read"          ON storage.objects;
DROP POLICY IF EXISTS "cert_docs_authenticated_delete" ON storage.objects;

CREATE POLICY "cert_docs_authenticated_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'cert-docs');

CREATE POLICY "cert_docs_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'cert-docs');

CREATE POLICY "cert_docs_authenticated_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'cert-docs');

SELECT 'user_certifications' AS tbl, COUNT(*) FROM user_certifications;
