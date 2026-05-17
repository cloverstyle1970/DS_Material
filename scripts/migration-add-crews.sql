-- ============================================================
-- 팀 내 조(crew) 구성 + users.crew_id
-- ------------------------------------------------------------
-- 보수1팀/보수2팀/보수3팀 등 각 팀(department) 아래에 여러 조(crew)를 두고
-- 사원을 조에 배정한다. 같은 조 사원들끼리는 견적요청·자재신청을 서로
-- 조회할 수 있도록 가시성 헬퍼에서 사용한다.
-- ============================================================

CREATE TABLE IF NOT EXISTS crews (
  id             SERIAL PRIMARY KEY,
  department_id  INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (department_id, name)
);

CREATE INDEX IF NOT EXISTS idx_crews_department_id ON crews(department_id);

-- users.crew_id FK (사원이 삭제된 조에 묶여 있어도 사원 자체는 유지)
ALTER TABLE users ADD COLUMN IF NOT EXISTS crew_id INTEGER REFERENCES crews(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_crew_id ON users(crew_id);

-- RLS (개발 단계 표준: 전체 허용)
ALTER TABLE crews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_crews" ON crews;
CREATE POLICY "allow_all_crews" ON crews FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT 'crews_table'         AS check_name,
       to_jsonb(EXISTS (SELECT 1 FROM information_schema.tables
                        WHERE table_name = 'crews')) AS result
UNION ALL
SELECT 'users.crew_id_column',
       to_jsonb(EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'users' AND column_name = 'crew_id'))
UNION ALL
SELECT 'crews_fk_to_departments',
       to_jsonb(EXISTS (SELECT 1 FROM information_schema.referential_constraints rc
                        JOIN information_schema.key_column_usage k
                          ON k.constraint_name = rc.constraint_name
                        WHERE k.table_name = 'crews' AND k.column_name = 'department_id'))
UNION ALL
SELECT 'users_fk_to_crews',
       to_jsonb(EXISTS (SELECT 1 FROM information_schema.referential_constraints rc
                        JOIN information_schema.key_column_usage k
                          ON k.constraint_name = rc.constraint_name
                        WHERE k.table_name = 'users' AND k.column_name = 'crew_id'))
UNION ALL
SELECT 'crews_rls_enabled',
       to_jsonb(EXISTS (SELECT 1 FROM pg_class c
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public' AND c.relname = 'crews' AND c.relrowsecurity));
