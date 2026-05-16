-- ============================================================
-- Phase 3 — 견적요청 (quote_requests)
-- ------------------------------------------------------------
-- 보수원의 [유상] 청구는 "견적요청"으로 접수되고, 견적 담당자가
-- 이 요청을 보고 정식 견적서(quotes)를 작성한다.
--
-- 흐름
--   보수원 → ClaimEntryClient(/claim/new) 에서 모드 선택
--     · 유상 → quote_requests 에 INSERT
--     · 무상 → material_requests 에 INSERT (request_type='무상신청')
--     · 당직 → material_requests 에 INSERT (request_type='당직선출고')
--       (실제 출고는 관리자가 즉시 처리 + transactions.pending_quote=true)
--
-- 견적 담당자 → /claim/quote-requests 에서 요청 확인 → [견적서 작성] 클릭
--   → /quotes/new?fromRequest=N 으로 라우트 → 헤더·라인 자동 프리필
--   → 견적서 저장 시 quote_requests.quote_id = 새 견적 ID 로 연결
--      및 quote_requests.status='견적발행' 으로 갱신
-- ============================================================

CREATE TABLE IF NOT EXISTS quote_requests (
  id              SERIAL PRIMARY KEY,
  request_no      TEXT NOT NULL UNIQUE,           -- 예: QR-2026-0001
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  site_name       TEXT,
  elevator_name   TEXT,                            -- 헤더 호기 (행별 호기는 items 에 저장)
  work_title      TEXT,                            -- 작업명 (예: 노후 부품 교체)
  reason          TEXT,                            -- 신청 사유 (고장 증상)
  requester_id    INTEGER,
  requester_name  TEXT,
  requester_dept  TEXT,
  status          TEXT NOT NULL DEFAULT '신청',
  quote_id        INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  processed_at    TIMESTAMPTZ,
  processor_id    INTEGER,
  processor_name  TEXT,
  CONSTRAINT quote_requests_status_check
    CHECK (status IN ('신청','견적작성중','견적발행','취소'))
);

CREATE INDEX IF NOT EXISTS idx_quote_requests_requested_at ON quote_requests(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_requests_status        ON quote_requests(status);
CREATE INDEX IF NOT EXISTS idx_quote_requests_site_name     ON quote_requests(site_name);
CREATE INDEX IF NOT EXISTS idx_quote_requests_quote_id      ON quote_requests(quote_id);

CREATE TABLE IF NOT EXISTS quote_request_items (
  id                SERIAL PRIMARY KEY,
  quote_request_id  INTEGER NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  material_id       TEXT REFERENCES materials(id),   -- NULL 가능 (수기 입력)
  material_name     TEXT NOT NULL,
  spec              TEXT,
  unit              TEXT,
  qty               NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (qty > 0),
  elevator_name     TEXT,                            -- 행별 호기
  remark            TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_quote_request_items_qrid ON quote_request_items(quote_request_id);

ALTER TABLE quote_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_request_items  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_quote_requests"       ON quote_requests;
DROP POLICY IF EXISTS "allow_all_quote_request_items"  ON quote_request_items;
CREATE POLICY "allow_all_quote_requests"       ON quote_requests       FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_quote_request_items"  ON quote_request_items  FOR ALL USING (TRUE) WITH CHECK (TRUE);

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 검증
-- ============================================================
SELECT 'quote_requests'      AS chk,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='quote_requests')      AS cnt
UNION ALL SELECT 'quote_request_items',
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='quote_request_items');
