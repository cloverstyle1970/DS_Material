-- transactions 테이블에 requester_name 컬럼 추가
-- 입고처리 시 발주전표의 신청자명을 보존하기 위함

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS requester_name TEXT DEFAULT NULL;

-- 결과 확인
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'transactions'
  AND column_name = 'requester_name';
