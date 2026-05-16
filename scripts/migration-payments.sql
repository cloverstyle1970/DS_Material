-- ============================================================
-- Phase 6 — 입금 관리 (payments)
-- ------------------------------------------------------------
-- 정책
--   · 한 견적(quotes)에 1:N 입금 행. 분할 입금/선입금 지원.
--   · is_prepaid=true 는 자재 출고 전 선입금. 합계 비교에는 동일하게 포함.
--   · 누적 입금 ≥ quotes.total_amount → 클라이언트가 progress_state='입금완료' 전이.
--   · payment_no 채번 규칙: PAY-YYYY-NNNN
-- ============================================================

CREATE TABLE IF NOT EXISTS payments (
  id              SERIAL PRIMARY KEY,
  payment_no      TEXT NOT NULL UNIQUE,
  quote_id        INTEGER NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  paid_at         DATE NOT NULL DEFAULT CURRENT_DATE,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  method          TEXT NOT NULL DEFAULT '계좌이체',
  is_prepaid      BOOLEAN NOT NULL DEFAULT FALSE,
  depositor_name  TEXT,
  note            TEXT,
  status          TEXT NOT NULL DEFAULT '확정',
  created_by_id   INTEGER,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payments_method_check
    CHECK (method IN ('현금','계좌이체','카드','어음','기타')),
  CONSTRAINT payments_status_check
    CHECK (status IN ('확정','취소'))
);

CREATE INDEX IF NOT EXISTS idx_payments_quote_id   ON payments(quote_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at    ON payments(paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_payment_no ON payments(payment_no);
CREATE INDEX IF NOT EXISTS idx_payments_method     ON payments(method);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_payments" ON payments;
CREATE POLICY "allow_all_payments" ON payments FOR ALL USING (TRUE) WITH CHECK (TRUE);

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 검증
-- ============================================================
SELECT 'payments' AS chk,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='payments') AS cnt;
