SET client_encoding = 'UTF8';
-- ============================================================
-- 급여명세표 (Payroll) — 엑셀 업로드 → 자동 등록 → PDF 인쇄
-- ------------------------------------------------------------
-- MVP 범위:
--   - 외부 산출 엑셀(예: 회계담당자/세무사) 업로드 → 자동 파싱
--   - 사원별 명세표 저장 → A4 가로 인쇄
--   - 4대보험·세금 자체 산출 없음 (엑셀 값 그대로 사용)
--
-- 구조:
--   payroll_periods (귀속년월 마스터)
--     └─ payslips (사원별 명세표 헤더)
--           └─ payslip_items (지급/공제 명세 행)
--
-- 항목 마스터는 두지 않는다. 매달 컬럼명이 변할 수 있으므로
-- payslip_items.label 에 엑셀의 항목명을 그대로 보관한다.
-- ============================================================

-- 1) 귀속기간 마스터
CREATE TABLE IF NOT EXISTS payroll_periods (
  id          BIGSERIAL PRIMARY KEY,
  year        SMALLINT NOT NULL,
  month       SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  pay_date    DATE,
  closed      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_payroll_periods_ym UNIQUE (year, month)
);

CREATE INDEX IF NOT EXISTS idx_payroll_periods_ym
  ON payroll_periods (year DESC, month DESC);

-- 2) 사원별 명세표 헤더
-- account_id 는 accounts.id 참조. 사원 정보는 변경 가능성을 대비해 snapshot 으로도 보관.
CREATE TABLE IF NOT EXISTS payslips (
  id              BIGSERIAL PRIMARY KEY,
  period_id       BIGINT NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  account_id      BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  emp_name        TEXT NOT NULL,           -- 엑셀에 적힌 성명 (snapshot)
  dept            TEXT,                    -- 부서 snapshot
  rank            TEXT,                    -- 직급 snapshot
  gross           NUMERIC(14,0) NOT NULL DEFAULT 0,    -- 월간 급여 총액
  deduction       NUMERIC(14,0) NOT NULL DEFAULT 0,    -- 공제 금액 합계
  net             NUMERIC(14,0) NOT NULL DEFAULT 0,    -- 차인지급액 (gross - deduction 또는 엑셀 별도 값)
  remark          TEXT,                    -- 비고
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_payslips_period_account UNIQUE (period_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_payslips_period ON payslips (period_id);
CREATE INDEX IF NOT EXISTS idx_payslips_account ON payslips (account_id);
CREATE INDEX IF NOT EXISTS idx_payslips_name ON payslips (emp_name);

-- 3) 지급/공제 명세 행
CREATE TABLE IF NOT EXISTS payslip_items (
  id          BIGSERIAL PRIMARY KEY,
  payslip_id  BIGINT NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('earning', 'deduction')),
  label       TEXT NOT NULL,               -- 엑셀의 항목명 그대로 (예: "기본급", "국민연금")
  amount      NUMERIC(14,0) NOT NULL DEFAULT 0,
  sort        SMALLINT NOT NULL DEFAULT 0  -- 엑셀 컬럼 순서대로 정렬용
);

CREATE INDEX IF NOT EXISTS idx_payslip_items_payslip
  ON payslip_items (payslip_id, type, sort);

-- 4) RLS — 개발 단계 표준 (운영 전 권한 강화 필요)
ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslip_items   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_payroll_periods ON payroll_periods;
DROP POLICY IF EXISTS allow_all_payslips        ON payslips;
DROP POLICY IF EXISTS allow_all_payslip_items   ON payslip_items;

CREATE POLICY allow_all_payroll_periods ON payroll_periods FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY allow_all_payslips        ON payslips        FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY allow_all_payslip_items   ON payslip_items   FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 5) 검증
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name IN ('payroll_periods', 'payslips', 'payslip_items')
ORDER BY table_name, ordinal_position;
