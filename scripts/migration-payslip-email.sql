-- migration-payslip-email.sql
-- 급여명세서 이메일 발송 기능: 발송 상태 추적 + 예약 발송일 컬럼 추가

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS email_status   text,         -- null=미발송 | 'sent'=완료 | 'failed'=실패
  ADD COLUMN IF NOT EXISTS email_sent_at  timestamptz;  -- 실제 발송된 시각

ALTER TABLE payroll_periods
  ADD COLUMN IF NOT EXISTS email_scheduled_at timestamptz;  -- 예약 발송 일시

-- 검증
SELECT
  t.table_name,
  c.column_name,
  c.data_type
FROM information_schema.columns c
JOIN (VALUES ('payslips'), ('payroll_periods')) t(table_name)
  ON c.table_name = t.table_name
WHERE c.column_name IN ('email_status', 'email_sent_at', 'email_scheduled_at')
ORDER BY t.table_name, c.column_name;
