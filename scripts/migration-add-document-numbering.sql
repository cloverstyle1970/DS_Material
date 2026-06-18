-- ============================================================
-- 발주·입고·출고 자동 채번
-- ------------------------------------------------------------
-- · purchase_orders.order_no  : 발주번호 (B-YY-MM-NNN)
-- · transactions.transaction_no : 입고/출고번호 (I/O-YY-MM-NNN)
-- 형식 ?-YY-MM-NNN  /  월 단위 시퀀스 리셋
-- 견적(quotes.quote_no, Q-YYYY-NNNN)은 기존 형식 유지
-- ============================================================

-- 1) 발주번호 컬럼 추가
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS order_no TEXT;

-- 중복 방지: 발급된 값은 UNIQUE (NULL 다수 허용은 PostgreSQL 기본 동작)
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_order_no
  ON purchase_orders(order_no)
  WHERE order_no IS NOT NULL;

-- 빠른 월별 시퀀스 조회용 (LIKE 'B-26-06-%' 패턴)
CREATE INDEX IF NOT EXISTS idx_purchase_orders_order_no_prefix
  ON purchase_orders(order_no text_pattern_ops)
  WHERE order_no IS NOT NULL;

-- 2) 입출고 번호 컬럼 추가
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transaction_no TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_transaction_no
  ON transactions(transaction_no)
  WHERE transaction_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_transaction_no_prefix
  ON transactions(transaction_no text_pattern_ops)
  WHERE transaction_no IS NOT NULL;

-- 3) 검증
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='purchase_orders' AND column_name='order_no') AS purchase_orders_order_no,
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='transactions' AND column_name='transaction_no') AS transactions_transaction_no,
  (SELECT COUNT(*) FROM pg_indexes
     WHERE schemaname='public' AND indexname IN (
       'idx_purchase_orders_order_no',
       'idx_purchase_orders_order_no_prefix',
       'idx_transactions_transaction_no',
       'idx_transactions_transaction_no_prefix'
     )) AS new_indexes;
-- 기대값: 1, 1, 4
