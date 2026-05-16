-- ============================================================
-- 견적서 작성 확장 — 자재별 호기 + 인건비 공/식 모드
-- ------------------------------------------------------------
-- 추가
--   · quote_items.elevator_name : 자재 라인별 호기
--   · quotes.labor_mode         : '공' | '식'
--   · quotes.labor_manhours     : 공수 (공모드=공수, 식모드=통합 공수합)
--   · quotes.labor_unit_price   : 1공당 단가 (스냅샷, 기본값 quote_settings)
--
-- 기존 quotes.direct_labor 는 계산 결과 스냅샷으로 유지
--   direct_labor = labor_unit_price * labor_manhours
--   (식 모드에서도 식수=1 이므로 동일 공식)
--
-- idempotent: ALTER ... IF NOT EXISTS, DROP CONSTRAINT IF EXISTS
-- ============================================================

ALTER TABLE quote_items
  ADD COLUMN IF NOT EXISTS elevator_name TEXT;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS labor_mode       TEXT NOT NULL DEFAULT '공',
  ADD COLUMN IF NOT EXISTS labor_manhours   NUMERIC(6,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS labor_unit_price INTEGER NOT NULL DEFAULT 0;

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_labor_mode_check;
ALTER TABLE quotes
  ADD CONSTRAINT quotes_labor_mode_check
  CHECK (labor_mode IN ('공','식'));

-- 기존 행의 labor_unit_price 보정 (direct_labor 가 있고 labor_manhours=1 이면 그대로 단가로 간주)
UPDATE quotes
   SET labor_unit_price = direct_labor
 WHERE labor_unit_price = 0 AND direct_labor > 0;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 검증
-- ============================================================
SELECT
  'quote_items.elevator_name' AS chk,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='quote_items' AND column_name='elevator_name') AS cnt
UNION ALL SELECT
  'quotes.labor_mode',
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='quotes' AND column_name='labor_mode')
UNION ALL SELECT
  'quotes.labor_manhours',
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='quotes' AND column_name='labor_manhours')
UNION ALL SELECT
  'quotes.labor_unit_price',
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='quotes' AND column_name='labor_unit_price');
