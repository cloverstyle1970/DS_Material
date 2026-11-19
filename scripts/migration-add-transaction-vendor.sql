-- transactions 테이블에 vendor_name 컬럼 추가
-- 입고처리 시 발주전표의 거래처명을 보존하기 위함
-- (requester_name 컬럼과 동일한 패턴. migration-add-transaction-requester.sql 참조)
--
-- 적용 후:
--   1) 새 입고 등록 시 발주 참조가 있으면 purchase_orders.vendor_name 을 함께 저장
--   2) 발주 없는 직접 입고도 거래처 수동 입력 가능해짐
--   3) 입고 리스트의 거래처 필터는 transactions.vendor_name 직접 조회 (join 불필요)

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS vendor_name TEXT DEFAULT NULL;

-- 기존 입고 데이터 역채움:
-- note 의 '발주 #<line_id>' 패턴 → purchase_order_lines → purchase_orders.vendor_name
UPDATE transactions t
SET    vendor_name = po.vendor_name
FROM   purchase_order_lines pol
JOIN   purchase_orders      po ON po.id = pol.order_id
WHERE  t.type        = '입고'
  AND  t.vendor_name IS NULL
  AND  t.note        ~ '^발주 #\d+ 입고완료'
  AND  pol.id        = substring(t.note FROM '^발주 #(\d+)')::int
  AND  po.vendor_name IS NOT NULL;

-- 결과 확인
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_name  = 'transactions'
  AND  column_name = 'vendor_name';

SELECT COUNT(*) AS backfilled_count
FROM   transactions
WHERE  type = '입고' AND vendor_name IS NOT NULL;
