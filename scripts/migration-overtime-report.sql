-- ============================================================
-- 잔업보고서 (overtime_reports) 마이그레이션
-- ============================================================

-- 잔업보고서 테이블
CREATE TABLE IF NOT EXISTS overtime_reports (
  id              BIGSERIAL PRIMARY KEY,
  report_no       TEXT UNIQUE NOT NULL,           -- OT-YY-MM-NNN 자동채번

  -- 작성자 / 권한
  author_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,

  -- 현장/작업 정보
  site_name       TEXT NOT NULL DEFAULT '',
  work_instructor TEXT,                           -- 작업지시자 이름 (자유입력)
  work_instructor_id INTEGER REFERENCES accounts(id),
  work_reasons    TEXT[] NOT NULL DEFAULT '{}',   -- ['점검','공사','수리·부품교체','상주','조출','기타']
  work_reason_etc TEXT,                           -- 기타 사유
  work_elevator   TEXT,                           -- 작업호기

  -- 작업 일시 / 근무 시간
  start_at        TIMESTAMPTZ NOT NULL,
  end_at          TIMESTAMPTZ NOT NULL,
  is_holiday      BOOLEAN NOT NULL DEFAULT FALSE,
  holiday_type    TEXT,                           -- '토요일'|'일요일'|'공휴일'
  work_hours      NUMERIC(5,2),                   -- 순 근무시간(h)
  holiday_hours   NUMERIC(5,2),                   -- 휴일근무 시간(h)
  overtime_hours  NUMERIC(5,2),                   -- 잔업 시간(h)

  -- 작업자 목록 (이름 배열)
  workers         TEXT[] NOT NULL DEFAULT '{}',

  -- 내용
  work_content    TEXT,
  work_result     TEXT,
  note            TEXT,

  -- 결재 (단일 승인자)
  approver_id     INTEGER REFERENCES accounts(id),
  approval_status TEXT NOT NULL DEFAULT 'draft',  -- draft|pending|approved|rejected
  submitted_at    TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  rejected_at     TIMESTAMPTZ,
  reject_reason   TEXT,

  -- 메타
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE overtime_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_overtime_reports ON overtime_reports;
CREATE POLICY allow_all_overtime_reports ON overtime_reports
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- OT 문서번호 채번 함수 (월 단위, advisory_xact_lock으로 동시성 보장)
CREATE OR REPLACE FUNCTION next_ot_no()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  yy     TEXT := TO_CHAR(NOW() AT TIME ZONE 'Asia/Seoul', 'YY');
  mm     TEXT := TO_CHAR(NOW() AT TIME ZONE 'Asia/Seoul', 'MM');
  prefix TEXT;
  seq    INT;
BEGIN
  prefix := 'OT-' || yy || '-' || mm || '-';
  PERFORM pg_advisory_xact_lock(hashtext('ot_no_seq'));
  SELECT COALESCE(MAX(CAST(SUBSTRING(report_no FROM LENGTH(prefix) + 1) AS INT)), 0) + 1
    INTO seq
    FROM overtime_reports
   WHERE report_no LIKE prefix || '%'
     AND report_no ~ ('^' || prefix || '\d+$');
  RETURN prefix || LPAD(seq::TEXT, 3, '0');
END;
$$;

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_overtime_reports_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_overtime_reports_updated_at ON overtime_reports;
CREATE TRIGGER trg_overtime_reports_updated_at
  BEFORE UPDATE ON overtime_reports
  FOR EACH ROW EXECUTE FUNCTION update_overtime_reports_updated_at();

-- 결과 확인
SELECT COUNT(*) AS overtime_reports_rows FROM overtime_reports;
SELECT proname FROM pg_proc WHERE proname IN ('next_ot_no','update_overtime_reports_updated_at');
