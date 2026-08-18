-- ============================================================
-- leave_requests 테이블 컬럼 추가 (idempotent)
-- CREATE TABLE IF NOT EXISTS 는 기존 테이블에 새 컬럼을 추가하지 않으므로
-- 별도 ALTER TABLE로 누락 컬럼을 추가한다.
-- ============================================================

ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS author_signature   text;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approver_signature text;

-- 검증
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'leave_requests'
 ORDER BY ordinal_position;
