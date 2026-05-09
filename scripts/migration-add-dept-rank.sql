-- ============================================================
-- 부서/직급 마스터 테이블
-- ------------------------------------------------------------
-- 사원등록·수정 시 사용할 부서·직급 코드 마스터
-- ============================================================

CREATE TABLE IF NOT EXISTS departments (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ranks (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS (앱 내부 접근만 허용)
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranks       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_departments" ON departments;
DROP POLICY IF EXISTS "allow_all_ranks"       ON ranks;

CREATE POLICY "allow_all_departments" ON departments FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_ranks"       ON ranks       FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 시드 데이터: 기존 users.dept / users.rank에서 추출
INSERT INTO departments (name, sort_order)
SELECT DISTINCT dept, ROW_NUMBER() OVER (ORDER BY dept) * 10
FROM users
WHERE dept IS NOT NULL AND TRIM(dept) <> ''
ON CONFLICT (name) DO NOTHING;

INSERT INTO ranks (name, sort_order)
SELECT name, sort_order FROM (VALUES
  ('대표',    10),
  ('상무',    20),
  ('전무',    30),
  ('이사',    40),
  ('부장',    50),
  ('차장',    60),
  ('과장',    70),
  ('대리',    80),
  ('사원',    90)
) AS t(name, sort_order)
ON CONFLICT (name) DO NOTHING;

-- 검증
SELECT 'departments' AS tbl, COUNT(*) AS cnt FROM departments
UNION ALL SELECT 'ranks', COUNT(*) FROM ranks;
