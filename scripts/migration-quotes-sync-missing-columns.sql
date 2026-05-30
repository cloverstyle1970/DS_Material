-- ============================================================
-- 신DB quotes 누락 컬럼 복구
-- ------------------------------------------------------------
-- quote-entry-extend / quote-workflow 마이그레이션이 신DB에 미적용되어
-- 견적 저장 시 PGRST204(charge_type 등 컬럼 없음) 발생 → 누락 컬럼 일괄 추가.
-- idempotent.
-- ============================================================
ALTER TABLE quote_items
  ADD COLUMN IF NOT EXISTS elevator_name TEXT;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS labor_mode       TEXT NOT NULL DEFAULT '공',
  ADD COLUMN IF NOT EXISTS labor_manhours   NUMERIC(6,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS labor_unit_price INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS charge_type      TEXT NOT NULL DEFAULT '유상',
  ADD COLUMN IF NOT EXISTS progress_state   TEXT NOT NULL DEFAULT '미시작';

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_labor_mode_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_labor_mode_check CHECK (labor_mode IN ('공','식'));

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_charge_type_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_charge_type_check CHECK (charge_type IN ('유상','무상'));

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_progress_state_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_progress_state_check
  CHECK (progress_state IN ('미시작','자재신청','자재출고','세금계산서발급','입금완료','종료'));

NOTIFY pgrst, 'reload schema';

SELECT column_name FROM information_schema.columns
WHERE table_name='quotes'
  AND column_name IN ('labor_mode','labor_manhours','labor_unit_price','charge_type','progress_state')
ORDER BY column_name;
