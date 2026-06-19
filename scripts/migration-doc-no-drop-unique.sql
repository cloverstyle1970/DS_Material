-- ============================================================
-- 문서번호 UNIQUE 제약 해제
-- ------------------------------------------------------------
-- 한 발주서/입고/출고에 자재가 여러 행이면 모두 같은 order_no /
-- transaction_no 를 공유하는 것이 정상이다(batch_id가 같은 묶음).
-- UNIQUE 인덱스로 잡혀있던 탓에 2개 이상의 자재가 든 문서를 저장하면
-- 두 번째 INSERT부터 무조건 UNIQUE 위반이 났다.
--
-- 별도 문서 간 동시 채번 race는 next_doc_no() advisory lock에서
-- 직렬화되므로 마지막 방어선으로서의 UNIQUE는 더 이상 필요 없다.
-- text_pattern_ops 보조 인덱스(`_prefix`)는 그대로 둔다(LIKE 검색용).
-- ============================================================

DROP INDEX IF EXISTS idx_purchase_orders_order_no;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_order_no
  ON purchase_orders(order_no)
  WHERE order_no IS NOT NULL;

DROP INDEX IF EXISTS idx_transactions_transaction_no;
CREATE INDEX IF NOT EXISTS idx_transactions_transaction_no
  ON transactions(transaction_no)
  WHERE transaction_no IS NOT NULL;

-- 검증: 두 인덱스가 비-UNIQUE 로 재생성됐는지 확인 (indexdef에 'UNIQUE' 없어야 정상)
SELECT indexname,
       (indexdef LIKE '%UNIQUE%') AS is_unique
  FROM pg_indexes
 WHERE indexname IN ('idx_purchase_orders_order_no', 'idx_transactions_transaction_no');
-- 기대값: 두 행 모두 is_unique = false
