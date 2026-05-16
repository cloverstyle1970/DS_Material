-- ============================================================
-- Phase 5 — 세금계산서·거래명세서 발행 이력 (invoices)
-- ------------------------------------------------------------
-- 정책
--   · 발행은 외부 시스템(홈택스/위하고) 연동 없이 발행 이력만 기록.
--     PDF 생성은 클라이언트 브라우저 인쇄(PDF로 저장)로 우선 처리.
--   · invoice_no 채번 규칙:
--       거래명세서 → DN-YYYY-NNNN
--       세금계산서 → TX-YYYY-NNNN
--   · 진행상태 자동 전이 정책 (클라이언트가 호출):
--       거래명세서만 발행 → 진행상태 유지 (정보성 발행)
--       세금계산서 발행 → quotes.progress_state='세금계산서발급'
--   · 향후 외부 연동 시 external_ref 컬럼에 발급 API ID 저장.
-- ============================================================

CREATE TABLE IF NOT EXISTS invoices (
  id              SERIAL PRIMARY KEY,
  invoice_no      TEXT NOT NULL UNIQUE,
  quote_id        INTEGER NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  invoice_type    TEXT NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by_id    INTEGER,
  issued_by_name  TEXT,
  status          TEXT NOT NULL DEFAULT '발행',
  -- 금액 스냅샷 (견적 변경 후에도 발행 시점 금액 보존)
  supply_amount   INTEGER NOT NULL DEFAULT 0,    -- 공급가액
  vat_amount      INTEGER NOT NULL DEFAULT 0,    -- 부가세 (세금계산서만 의미)
  total_amount    INTEGER NOT NULL DEFAULT 0,    -- 합계
  -- 거래처/공급자 스냅샷
  customer_name   TEXT,
  customer_biz_no TEXT,   -- 사업자등록번호 (있을 때)
  site_name       TEXT,
  -- PDF/외부 연동
  doc_url         TEXT,   -- 브라우저 인쇄 PDF 업로드 시 사용 (현재는 NULL)
  external_ref    TEXT,   -- 호택스/위하고 등 외부 시스템 발급 ID
  note            TEXT,
  CONSTRAINT invoices_type_check
    CHECK (invoice_type IN ('세금계산서','거래명세서')),
  CONSTRAINT invoices_status_check
    CHECK (status IN ('발행','취소'))
);

CREATE INDEX IF NOT EXISTS idx_invoices_quote_id    ON invoices(quote_id);
CREATE INDEX IF NOT EXISTS idx_invoices_issued_at   ON invoices(issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_no  ON invoices(invoice_no);
CREATE INDEX IF NOT EXISTS idx_invoices_type        ON invoices(invoice_type);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_invoices" ON invoices;
CREATE POLICY "allow_all_invoices" ON invoices FOR ALL USING (TRUE) WITH CHECK (TRUE);

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 검증
-- ============================================================
SELECT 'invoices'
       AS chk,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='invoices') AS cnt;
