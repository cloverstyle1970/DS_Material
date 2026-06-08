-- site_elevators 에 호기별 원장번호 / job_no / 하자기간 컬럼 추가
-- 적용 후 scripts/import-elevator-ledger.mjs 로 엑셀 데이터 반영

ALTER TABLE public.site_elevators
  ADD COLUMN IF NOT EXISTS ledger_no       TEXT,  -- 원장번호
  ADD COLUMN IF NOT EXISTS job_no          TEXT,  -- Job No (호기 단위)
  ADD COLUMN IF NOT EXISTS warranty_period TEXT;  -- 하자기간

-- 검증
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'site_elevators'
   AND column_name IN ('ledger_no', 'job_no', 'warranty_period')
 ORDER BY column_name;
