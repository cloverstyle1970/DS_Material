-- ============================================================
-- 잔업보고서 개인별 휴일구분 컬럼 추가
-- ------------------------------------------------------------
-- overtime_reports.worker_holiday_types TEXT[]
-- 작업자별 휴일 유형 (연차/대체휴무/교육/출장/기타)
-- workers 배열과 동일 인덱스 대응
-- ============================================================

ALTER TABLE overtime_reports
  ADD COLUMN IF NOT EXISTS worker_holiday_types TEXT[] NOT NULL DEFAULT '{}';

-- 검증
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'overtime_reports'
  AND column_name = 'worker_holiday_types';
-- 기대값: worker_holiday_types | ARRAY | {}
