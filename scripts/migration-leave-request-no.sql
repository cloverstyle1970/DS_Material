-- ============================================================
-- 연차계 문서번호 채번 race-condition 해소
-- ------------------------------------------------------------
-- 기존: COUNT(*) + 1 방식 → 삭제 이력 있으면 번호 충돌
-- 변경: next_doc_no('LR') RPC 사용 — doc_seq + advisory lock 직렬화
--
-- 포맷: LR-YY-NNN  (연 단위 리셋, 3자리)
-- ============================================================

-- 1) next_doc_no에 LR 채널 추가 (기존 B/I/O/Q 로직 유지, LR 분기 추가)
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
  IF p_prefix = 'Q' THEN
    v_period := TO_CHAR(p_date, 'YYYY');
    v_width  := 4;
  ELSIF p_prefix IN ('B','I','O') THEN
    v_period := TO_CHAR(p_date, 'YY-MM');
    v_width  := 3;
  ELSIF p_prefix = 'LR' THEN
    v_period := TO_CHAR(p_date AT TIME ZONE 'Asia/Seoul', 'YY');
    v_width  := 3;
  ELSE
    RAISE EXCEPTION '알 수 없는 문서 prefix: %', p_prefix;
  END IF;
  v_head := p_prefix || '-' || v_period || '-';

  PERFORM pg_advisory_xact_lock(hashtextextended(v_head, 0));

  SELECT next_seq INTO v_seq
  FROM doc_seq
  WHERE channel = p_prefix AND period = v_period;

  IF NOT FOUND THEN
    IF p_prefix = 'B' THEN
      SELECT COALESCE(MAX(CAST(SUBSTRING(order_no FROM '\d+$') AS INTEGER)), 0)
        INTO v_existing_max FROM purchase_orders WHERE order_no LIKE v_head || '%';
    ELSIF p_prefix = 'I' THEN
      SELECT COALESCE(MAX(CAST(SUBSTRING(transaction_no FROM '\d+$') AS INTEGER)), 0)
        INTO v_existing_max FROM transactions
       WHERE transaction_no LIKE v_head || '%' AND type = '입고';
    ELSIF p_prefix = 'O' THEN
      SELECT COALESCE(MAX(CAST(SUBSTRING(transaction_no FROM '\d+$') AS INTEGER)), 0)
        INTO v_existing_max FROM transactions
       WHERE transaction_no LIKE v_head || '%' AND type = '출고';
    ELSIF p_prefix = 'Q' THEN
      SELECT COALESCE(MAX(CAST(SUBSTRING(quote_no FROM '\d+$') AS INTEGER)), 0)
        INTO v_existing_max FROM quotes WHERE quote_no LIKE v_head || '%';
    ELSIF p_prefix = 'LR' THEN
      SELECT COALESCE(MAX(CAST(SUBSTRING(request_no FROM '\d+$') AS INTEGER)), 0)
        INTO v_existing_max FROM leave_requests WHERE request_no LIKE v_head || '%';
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

-- 2) 검증
SELECT
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'next_doc_no')   AS fn_exists,
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'doc_seq')   AS doc_seq_exists;
-- 기대값: 1, 1
