-- construction_schedules / construction_requests 에 현장구분(TK/DS) 컬럼 추가
-- Supabase Dashboard > SQL Editor 에서 1회 실행

ALTER TABLE construction_schedules
  ADD COLUMN IF NOT EXISTS company_type TEXT;

ALTER TABLE construction_requests
  ADD COLUMN IF NOT EXISTS company_type TEXT;

CREATE INDEX IF NOT EXISTS construction_schedules_company_type_idx
  ON construction_schedules (company_type);

CREATE INDEX IF NOT EXISTS construction_requests_company_type_idx
  ON construction_requests (company_type);
