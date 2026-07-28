-- ============================================================
-- 승강기 유지관리 작업일지 (Work Journal) 마이그레이션
-- ------------------------------------------------------------
-- 4개 테이블: 본체 + 호기별 작업내역 + 온열질환 휴게 + 참가자
-- 사용자/현장은 기존 accounts, managed_sites 재사용
-- 서명은 기존 Supabase Storage 'tbm-photos' 버킷 재사용 (work-journal/ 하위 폴더)
-- ============================================================

-- ============================================================
-- [1] 본체 (하루 1건, 사원별)
-- ============================================================

CREATE TABLE IF NOT EXISTS work_journals (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_name             TEXT NOT NULL,

  -- 기본 정보
  work_date             DATE NOT NULL,
  weekday               TEXT,                              -- 월/화/수/목/금/토/일
  weather               TEXT,                              -- 맑음/흐림/비/눈 등 자유 입력
  site_name             TEXT NOT NULL DEFAULT '',          -- 현장명 (다중 현장 시 콤마)
  elevator_unique_no    TEXT NOT NULL DEFAULT '',          -- 승강기 고유번호

  -- 환경 지표
  temperature           NUMERIC(4,1),                      -- 온도 (℃)
  humidity              NUMERIC(4,1),                      -- 습도 (%)
  apparent_temperature  NUMERIC(4,1),                      -- 체감온도
  location              TEXT,                              -- 지역명 (reverse-geocode 또는 수동 입력)

  -- 근무 시간
  base_work_start       TIME NOT NULL DEFAULT '08:30',
  base_work_end         TIME NOT NULL DEFAULT '17:30',
  overtime_start        TIME,
  overtime_end          TIME,
  overtime_hours        INT NOT NULL DEFAULT 0,
  overtime_minutes      INT NOT NULL DEFAULT 0,

  -- 작업 구분 (복수 선택 가능)
  category_inspection   BOOLEAN NOT NULL DEFAULT FALSE,    -- 점검(자체점검)
  category_fault        BOOLEAN NOT NULL DEFAULT FALSE,    -- 고장처리
  category_repair       BOOLEAN NOT NULL DEFAULT FALSE,    -- 수리공사

  -- 특이사항
  special_notes         TEXT NOT NULL DEFAULT '',

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_journals_user_id    ON work_journals(user_id);
CREATE INDEX IF NOT EXISTS idx_work_journals_work_date  ON work_journals(work_date DESC);
CREATE INDEX IF NOT EXISTS idx_work_journals_site_name  ON work_journals(site_name);
CREATE INDEX IF NOT EXISTS idx_work_journals_created_at ON work_journals(created_at DESC);

-- ============================================================
-- [2] 호기별 작업 내역 (엑셀 6줄 그리드)
-- ============================================================

CREATE TABLE IF NOT EXISTS work_journal_items (
  id            BIGSERIAL PRIMARY KEY,
  journal_id    BIGINT NOT NULL REFERENCES work_journals(id) ON DELETE CASCADE,
  seq           INT NOT NULL,                    -- 1..N (동적 추가)
  unit_no       TEXT NOT NULL DEFAULT '',        -- 호기
  work_category TEXT NOT NULL DEFAULT '',        -- 작업구분 (점검/고장/수리 자유입력)
  work_content  TEXT NOT NULL DEFAULT '',        -- 작업내용
  work_start    TIME,                            -- 작업 시작 시각
  work_end      TIME,                            -- 작업 종료 시각
  action_result TEXT NOT NULL DEFAULT '',        -- 조치결과 / 부품교체
  UNIQUE (journal_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_work_journal_items_journal_id ON work_journal_items(journal_id);

-- ============================================================
-- [3] 온열질환 예방 휴게 실시 확인 (엑셀 5행 고정)
-- ============================================================

CREATE TABLE IF NOT EXISTS work_journal_heat_rests (
  id            BIGSERIAL PRIMARY KEY,
  journal_id    BIGINT NOT NULL REFERENCES work_journals(id) ON DELETE CASCADE,
  seq           INT NOT NULL,       -- 1~N
  rest_start    TIME,               -- 휴게 시작
  rest_end      TIME,               -- 휴게 종료
  rest_method   TEXT,               -- 휴게방법
  UNIQUE (journal_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_work_journal_heat_rests_journal_id ON work_journal_heat_rests(journal_id);

-- ============================================================
-- [4] 작업 참가자 (worker1 / worker2 / manager 3역할)
-- ============================================================

CREATE TABLE IF NOT EXISTS work_journal_participants (
  id             BIGSERIAL PRIMARY KEY,
  journal_id     BIGINT NOT NULL REFERENCES work_journals(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role ~ '^worker[0-9]+$'),
  user_id        BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  name           TEXT NOT NULL DEFAULT '',
  signature_url  TEXT,                                       -- 참가자별 서명 URL
  UNIQUE (journal_id, role)
);

CREATE INDEX IF NOT EXISTS idx_work_journal_participants_journal_id ON work_journal_participants(journal_id);

-- ============================================================
-- [5] RLS 정책 (본 앱 개발 표준 — 내부 접근 전체 허용)
-- ============================================================

ALTER TABLE work_journals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_journal_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_journal_heat_rests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_journal_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_work_journals"             ON work_journals;
DROP POLICY IF EXISTS "allow_all_work_journal_items"        ON work_journal_items;
DROP POLICY IF EXISTS "allow_all_work_journal_heat_rests"   ON work_journal_heat_rests;
DROP POLICY IF EXISTS "allow_all_work_journal_participants" ON work_journal_participants;

CREATE POLICY "allow_all_work_journals"             ON work_journals             FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_work_journal_items"        ON work_journal_items        FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_work_journal_heat_rests"   ON work_journal_heat_rests   FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_work_journal_participants" ON work_journal_participants FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ============================================================
-- [6] 검증 쿼리
-- ============================================================

SELECT 'work_journals'             AS tbl, COUNT(*) AS cnt FROM work_journals
UNION ALL SELECT 'work_journal_items',        COUNT(*) FROM work_journal_items
UNION ALL SELECT 'work_journal_heat_rests',   COUNT(*) FROM work_journal_heat_rests
UNION ALL SELECT 'work_journal_participants', COUNT(*) FROM work_journal_participants;

-- 예상 결과: 모두 0
