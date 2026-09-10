-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ migration-print-logs.sql                                                │
-- │ 목적: 잔업보고서·연차계 출력이력 추적 (중복출력 방지)                  │
-- └─────────────────────────────────────────────────────────────────────────┘

CREATE TABLE IF NOT EXISTS print_logs (
  id         bigserial    PRIMARY KEY,
  doc_type   text         NOT NULL CHECK (doc_type IN ('overtime', 'leave')),
  doc_id     bigint       NOT NULL,
  printed_by bigint       REFERENCES accounts(id) ON DELETE SET NULL,
  printed_at timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS print_logs_doc_idx ON print_logs (doc_type, doc_id);

ALTER TABLE print_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_print_logs ON print_logs;
CREATE POLICY allow_all_print_logs ON print_logs FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT count(*) AS print_logs_count FROM print_logs;
