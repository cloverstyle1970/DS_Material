-- ============================================================
-- 교체공사 공수 표준 + 견적 작업 라인
-- ------------------------------------------------------------
-- 목적: 견적서(QuoteEntry)에 "작업 라인"을 다건 추가할 수 있도록 지원.
--       작업 표준을 선택하면 공수(man_days)가 자동 입력되고,
--       라인 금액 = 1공 단가(견적 헤더 labor_unit_price) × 공수.
--
-- 추가 사항
--   1. labor_workload_standards : 교체공사 공수 표준 마스터 (엑셀 49건 시드)
--   2. quote_labor_lines        : 견적별 작업 라인 (1:N, quote_items 와 동일 패턴)
--
-- 정책
--   · 공수 미기재 표준 4건(모터베어링·가바나류) → man_days NULL + note='별도 견적'
--   · 1공 단가는 견적 헤더 labor_unit_price 를 공유하되, 라인 저장 시 스냅샷으로 복사.
--   · 라인은 전체 DELETE 후 INSERT 재삽입 (quote_items 와 동일한 1:N 정합성 패턴).
--
-- idempotent: 모든 CREATE 는 IF NOT EXISTS, DROP POLICY IF EXISTS 사용.
-- ============================================================

-- ── 1) 공수 표준 마스터 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS labor_workload_standards (
  id           SERIAL PRIMARY KEY,
  code         TEXT UNIQUE,                       -- 자동 채번 (WL001..) — import 시 세팅
  category     TEXT NOT NULL,                     -- 대분류 (품명) 예: MAIN SHEAVE
  type_name    TEXT,                              -- TYPE 예: TM30, 40 / 2:1
  subtype      TEXT,                              -- 보조구분 예: MR / MRL
  floor_range  TEXT,                              -- 세부/층수범위 예: 11~20층, 부하 & 반부하측
  man_days     NUMERIC(5,1),                      -- 공수 (NULL = 별도 견적)
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  note         TEXT,                              -- 비고 (미기재건 = '별도 견적')
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workload_std_active ON labor_workload_standards(is_active, sort_order);

ALTER TABLE labor_workload_standards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_labor_workload_standards ON labor_workload_standards;
CREATE POLICY allow_all_labor_workload_standards ON labor_workload_standards
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ── 2) 견적 작업 라인 (1:N) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS quote_labor_lines (
  id            SERIAL PRIMARY KEY,
  quote_id      INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  standard_id   INTEGER REFERENCES labor_workload_standards(id),  -- NULL = 자유 입력 라인
  work_name     TEXT NOT NULL,                    -- 작업명 스냅샷 (표준 label 또는 자유입력)
  man_days      NUMERIC(5,1) NOT NULL DEFAULT 0,  -- 공수 (표준값 또는 수정값)
  unit_price    INTEGER NOT NULL DEFAULT 0,       -- 1공 단가 스냅샷 (견적 헤더 labor_unit_price 복사)
  amount        INTEGER NOT NULL DEFAULT 0,       -- = ROUND(man_days * unit_price)
  remark        TEXT,                             -- 비고
  elevator_name TEXT,                             -- 호기 (선택)
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_labor_lines_quote    ON quote_labor_lines(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_labor_lines_standard ON quote_labor_lines(standard_id);

ALTER TABLE quote_labor_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_quote_labor_lines ON quote_labor_lines;
CREATE POLICY allow_all_quote_labor_lines ON quote_labor_lines
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ── 검증 ────────────────────────────────────────────────────
SELECT 'labor_workload_standards' AS tbl,
       to_regclass('public.labor_workload_standards') IS NOT NULL AS exists
UNION ALL
SELECT 'quote_labor_lines',
       to_regclass('public.quote_labor_lines') IS NOT NULL;
