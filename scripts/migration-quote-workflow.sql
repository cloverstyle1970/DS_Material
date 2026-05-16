-- ============================================================
-- Phase 1 — 견적 워크플로우 확장
-- ------------------------------------------------------------
-- 목적: 사용자 업무 흐름(보수원 청구 → 견적 → 승인 → 자재신청 → 출고 →
--       세금계산서 → 입금 → 종료) 을 지원하는 DB 골격.
--
-- 추가 사항
--   1. quotes.progress_state    : 후속 진행상태 (status 결재상태와 별도)
--   2. quotes.charge_type       : 유상/무상 구분
--   3. material_requests.quote_id, .request_type : 견적-신청 연결 + 청구 유형
--   4. transactions.pending_quote  : 당직 선출고 → 사후 견적 작성 대상 표시
--   5. materials.warranty_months   : 자재별 하자기간 (NULL=기본값 자동 적용)
--   6. quote_revisions          : 견적 수정 이력 (스냅샷)
--   7. snapshot_quote() RPC     : 견적 저장/상태변경 직전 스냅샷 기록
--
-- 정책
--   · 하자기간 기본 36개월. 배터리 6, 수리품(코드 R 접미사) 12개월.
--   · 무상 현장: 계약구분이 'TK-FM' 또는 '대솔FM' (FM=Full Maintenance).
--     이 경우 청구는 자재신청(무상신청)으로 처리하며 견적은 작성하지 않음.
--   · 당직 선출고: 즉시 출고 후 사후 견적 — transactions.pending_quote=true 로 표시.
--
-- idempotent: 모든 ALTER/CREATE 는 IF NOT EXISTS, DROP POLICY IF EXISTS 사용.
-- ============================================================

-- ── 1) quotes 컬럼 추가 ─────────────────────────────────────
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS progress_state TEXT NOT NULL DEFAULT '미시작',
  ADD COLUMN IF NOT EXISTS charge_type    TEXT NOT NULL DEFAULT '유상';

-- progress_state 값 체크 (DROP/ADD 패턴으로 idempotent)
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_progress_state_check;
ALTER TABLE quotes
  ADD CONSTRAINT quotes_progress_state_check
  CHECK (progress_state IN (
    '미시작',
    '자재신청',
    '자재출고',
    '세금계산서발급',
    '입금완료',
    '종료'
  ));

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_charge_type_check;
ALTER TABLE quotes
  ADD CONSTRAINT quotes_charge_type_check
  CHECK (charge_type IN ('유상','무상'));

CREATE INDEX IF NOT EXISTS idx_quotes_progress_state ON quotes(progress_state);

-- ── 2) material_requests 컬럼 추가 ──────────────────────────
ALTER TABLE material_requests
  ADD COLUMN IF NOT EXISTS quote_id      INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS request_type  TEXT;

ALTER TABLE material_requests DROP CONSTRAINT IF EXISTS material_requests_request_type_check;
ALTER TABLE material_requests
  ADD CONSTRAINT material_requests_request_type_check
  CHECK (request_type IS NULL OR request_type IN (
    '유상견적',     -- 견적 승인 후 자재신청
    '무상신청',     -- FM 현장 무상 자재신청
    '당직선출고'    -- 당직 선출고 (사후 견적 대상)
  ));

CREATE INDEX IF NOT EXISTS idx_material_requests_quote_id     ON material_requests(quote_id);
CREATE INDEX IF NOT EXISTS idx_material_requests_request_type ON material_requests(request_type);

-- ── 3) transactions 컬럼 추가 (당직 선출고 플래그) ───────────
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS pending_quote BOOLEAN NOT NULL DEFAULT FALSE;

-- pending_quote=true 행만 빠르게 조회하기 위한 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_transactions_pending_quote
  ON transactions(pending_quote) WHERE pending_quote = TRUE;

-- ── 4) materials.warranty_months ────────────────────────────
ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS warranty_months INTEGER;

-- 자재코드 끝 'R'이면 수리품 → 12개월 (기존 데이터 일괄 적용)
UPDATE materials
   SET warranty_months = 12
 WHERE warranty_months IS NULL
   AND right(id, 1) = 'R';

-- 그 외 신품은 NULL 유지 (NULL = 기본 36개월, 배터리는 추후 6으로 수동 설정)

COMMENT ON COLUMN materials.warranty_months IS
  'NULL = 기본 36개월(신품). 수리품 12, 배터리 6. 화면에서는 NULL → 36 으로 표시.';

-- ── 5) quote_revisions (수정 이력) ──────────────────────────
CREATE TABLE IF NOT EXISTS quote_revisions (
  id              SERIAL PRIMARY KEY,
  quote_id        INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  revision_no     INTEGER NOT NULL,
  snapshot_header JSONB   NOT NULL,    -- quotes 행 전체 스냅샷
  snapshot_items  JSONB   NOT NULL,    -- quote_items 배열 스냅샷
  change_summary  TEXT,                 -- 변경 사유/요약 (예: '자재 추가', '진행상태: 자재신청 → 자재출고')
  changed_by_id   INTEGER,
  changed_by_name TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT quote_revisions_unique UNIQUE (quote_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_quote_revisions_quote_id   ON quote_revisions(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_revisions_changed_at ON quote_revisions(changed_at DESC);

ALTER TABLE quote_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_quote_revisions" ON quote_revisions;
CREATE POLICY "allow_all_quote_revisions" ON quote_revisions FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ── 6) snapshot_quote RPC ───────────────────────────────────
-- 클라이언트가 견적 저장/상태변경 "직전"에 호출.
-- 현재 quote 헤더 + items 의 스냅샷을 새 revision_no 로 quote_revisions 에 기록.
CREATE OR REPLACE FUNCTION snapshot_quote(
  p_quote_id   INTEGER,
  p_summary    TEXT DEFAULT NULL,
  p_user_id    INTEGER DEFAULT NULL,
  p_user_name  TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_header JSONB;
  v_items  JSONB;
  v_revno  INTEGER;
BEGIN
  SELECT to_jsonb(q.*) INTO v_header FROM quotes q WHERE q.id = p_quote_id;
  IF v_header IS NULL THEN
    RAISE EXCEPTION '견적서를 찾을 수 없습니다: id=%', p_quote_id;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(qi.*) ORDER BY qi.sort_order, qi.id), '[]'::jsonb)
    INTO v_items
    FROM quote_items qi WHERE qi.quote_id = p_quote_id;

  SELECT COALESCE(MAX(revision_no), 0) + 1
    INTO v_revno
    FROM quote_revisions WHERE quote_id = p_quote_id;

  INSERT INTO quote_revisions
    (quote_id, revision_no, snapshot_header, snapshot_items, change_summary, changed_by_id, changed_by_name)
  VALUES
    (p_quote_id, v_revno, v_header, v_items, p_summary, p_user_id, p_user_name);

  RETURN v_revno;
END;
$$;

GRANT EXECUTE ON FUNCTION snapshot_quote(INTEGER, TEXT, INTEGER, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 검증
-- ============================================================
SELECT
  'quotes.progress_state'           AS chk,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='quotes' AND column_name='progress_state')                AS cnt
UNION ALL SELECT
  'quotes.charge_type',
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='quotes' AND column_name='charge_type')
UNION ALL SELECT
  'material_requests.quote_id',
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='material_requests' AND column_name='quote_id')
UNION ALL SELECT
  'material_requests.request_type',
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='material_requests' AND column_name='request_type')
UNION ALL SELECT
  'transactions.pending_quote',
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='transactions' AND column_name='pending_quote')
UNION ALL SELECT
  'materials.warranty_months',
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='materials' AND column_name='warranty_months')
UNION ALL SELECT
  'quote_revisions table',
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_name='quote_revisions')
UNION ALL SELECT
  'snapshot_quote function',
  (SELECT COUNT(*) FROM pg_proc WHERE proname='snapshot_quote');

-- 수리품 일괄 보정 결과
SELECT '수리품 warranty_months=12 적용 건수' AS chk,
       COUNT(*)::TEXT AS info
  FROM materials
 WHERE right(id, 1) = 'R' AND warranty_months = 12;
