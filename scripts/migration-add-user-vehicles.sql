-- ============================================================
-- 사원 차량정보 테이블 + Storage 버킷
-- ============================================================

CREATE TABLE IF NOT EXISTS user_vehicles (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type          TEXT NOT NULL CHECK (vehicle_type IN ('자차','렌트','회사차량','기타')),
  plate_number          TEXT NOT NULL,
  model                 TEXT NOT NULL,
  year_made             TEXT,
  fuel_type             TEXT NOT NULL CHECK (fuel_type IN ('가솔린','디젤','가스','전기','기타')),
  registration_date     DATE,
  registration_doc_url  TEXT,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_vehicles_user_id ON user_vehicles(user_id);

ALTER TABLE user_vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_user_vehicles" ON user_vehicles;
CREATE POLICY "allow_all_user_vehicles" ON user_vehicles FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ============================================================
-- 차량등록증 첨부파일용 Storage 버킷 (이미지·PDF 허용)
-- ------------------------------------------------------------
-- 권한 문제로 실패 시 Dashboard → Storage → New bucket:
--   Name: vehicle-docs
--   Public: ✓
--   Size limit: 10MB
--   MIME: image/jpeg, image/png, image/webp, application/pdf
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-docs',
  'vehicle-docs',
  TRUE,
  10485760,   -- 10MB
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "vehicle_docs_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "vehicle_docs_public_read"          ON storage.objects;
DROP POLICY IF EXISTS "vehicle_docs_authenticated_delete" ON storage.objects;

CREATE POLICY "vehicle_docs_authenticated_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'vehicle-docs');

CREATE POLICY "vehicle_docs_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'vehicle-docs');

CREATE POLICY "vehicle_docs_authenticated_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'vehicle-docs');

SELECT 'user_vehicles' AS tbl, COUNT(*) FROM user_vehicles;
