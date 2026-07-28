-- ============================================================
-- work_journals.heat_alert 컬럼 삭제
-- ------------------------------------------------------------
-- 폭염특보 기능 제거에 따라 컬럼 정리. 데이터가 아직 없어 안전.
-- ============================================================

ALTER TABLE work_journals DROP COLUMN IF EXISTS heat_alert;

-- 검증
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'work_journals' AND column_name = 'heat_alert';
-- 예상 결과: 0행
