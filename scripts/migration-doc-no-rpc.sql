-- ============================================================
-- 문서번호 채번 race-condition 해소
-- ------------------------------------------------------------
-- 기존: 클라이언트가 SELECT MAX(order_no)+1 후 INSERT — 동시 저장 시
--      두 클라이언트가 같은 번호를 받아 두 번째 INSERT가 UNIQUE 위반.
-- 변경: DB 함수 next_doc_no()로 채번 일원화.
--       advisory_xact_lock 으로 (channel, period) 단위 직렬화 +
--       doc_seq 카운터 테이블로 빠른 다음 시퀀스 조회.
--
-- 대상 채널
--   B = 발주(purchase_orders.order_no)            ?-YY-MM-NNN (월 리셋)
--   I = 입고(transactions.transaction_no, type=입고)  ?-YY-MM-NNN
--   O = 출고(transactions.transaction_no, type=출고)  ?-YY-MM-NNN
--   Q = 견적(quotes.quote_no)                      ?-YYYY-NNNN (연 리셋)
-- ============================================================

-- 1) 카운터 테이블
CREATE TABLE IF NOT EXISTS doc_seq (
  channel  TEXT NOT NULL,
  period   TEXT NOT NULL,
  next_seq INTEGER NOT NULL,
  PRIMARY KEY (channel, period)
);

ALTER TABLE doc_seq ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_doc_seq ON doc_seq;
CREATE POLICY allow_all_doc_seq ON doc_seq FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 2) 채번 함수
CREATE OR REPLACE FUNCTION next_doc_no(p_prefix TEXT, p_date DATE DEFAULT CURRENT_DATE)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_period       TEXT;
  v_width        INTEGER;
  v_head         TEXT;
  v_seq          INTEGER;
  v_existing_max INTEGER;
BEGIN
  -- 채널별 기간/자릿수
  IF p_prefix = 'Q' THEN
    v_period := TO_CHAR(p_date, 'YYYY');
    v_width  := 4;
  ELSIF p_prefix IN ('B','I','O') THEN
    v_period := TO_CHAR(p_date, 'YY-MM');
    v_width  := 3;
  ELSE
    RAISE EXCEPTION '알 수 없는 문서 prefix: %', p_prefix;
  END IF;
  v_head := p_prefix || '-' || v_period || '-';

  -- (channel, period) 단위 직렬화 — 같은 트랜잭션 끝까지 보유
  PERFORM pg_advisory_xact_lock(hashtextextended(v_head, 0));

  -- 카운터 있으면 +1, 없으면 기존 테이블 max 백필 후 시작
  SELECT next_seq INTO v_seq
  FROM doc_seq
  WHERE channel = p_prefix AND period = v_period;

  IF NOT FOUND THEN
    IF p_prefix = 'B' THEN
      SELECT COALESCE(MAX(CAST(SUBSTRING(order_no FROM '\d+$') AS INTEGER)), 0)
        INTO v_existing_max
        FROM purchase_orders
       WHERE order_no LIKE v_head || '%';
    ELSIF p_prefix = 'I' THEN
      SELECT COALESCE(MAX(CAST(SUBSTRING(transaction_no FROM '\d+$') AS INTEGER)), 0)
        INTO v_existing_max
        FROM transactions
       WHERE transaction_no LIKE v_head || '%' AND type = '입고';
    ELSIF p_prefix = 'O' THEN
      SELECT COALESCE(MAX(CAST(SUBSTRING(transaction_no FROM '\d+$') AS INTEGER)), 0)
        INTO v_existing_max
        FROM transactions
       WHERE transaction_no LIKE v_head || '%' AND type = '출고';
    ELSIF p_prefix = 'Q' THEN
      SELECT COALESCE(MAX(CAST(SUBSTRING(quote_no FROM '\d+$') AS INTEGER)), 0)
        INTO v_existing_max
        FROM quotes
       WHERE quote_no LIKE v_head || '%';
    END IF;

    v_seq := v_existing_max + 1;
    INSERT INTO doc_seq(channel, period, next_seq)
    VALUES (p_prefix, v_period, v_seq + 1);
  ELSE
    UPDATE doc_seq
       SET next_seq = next_seq + 1
     WHERE channel = p_prefix AND period = v_period;
  END IF;

  RETURN v_head || LPAD(v_seq::TEXT, v_width, '0');
END;
$$;

-- 3) 검증 (실제 채번 호출하지 않음 — 함수/테이블 존재만 확인)
SELECT
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'next_doc_no')                     AS fn_exists,
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema='public' AND table_name='doc_seq')                         AS doc_seq_exists;
-- 기대값: 1, 1
