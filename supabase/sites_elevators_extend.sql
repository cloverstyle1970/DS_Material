-- 2026-05-13 통합 엑셀(대솔이엘_관리현장) 도입에 따른 컬럼 확장
-- Supabase Dashboard > SQL Editor 에서 1회 실행

ALTER TABLE sites ADD COLUMN IF NOT EXISTS alias TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS ledger_no TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_kind TEXT;

ALTER TABLE elevators ADD COLUMN IF NOT EXISTS model_name TEXT;

CREATE INDEX IF NOT EXISTS sites_alias_idx     ON sites (alias);
CREATE INDEX IF NOT EXISTS sites_ledger_no_idx ON sites (ledger_no);
