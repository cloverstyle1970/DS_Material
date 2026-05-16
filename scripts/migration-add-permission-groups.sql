-- ============================================================
-- 사용자 권한 그룹 (Permission Group) 시스템
-- ------------------------------------------------------------
-- 1) permission_groups 테이블
-- 2) users.permission_group_id FK 컬럼
-- 3) 7개 기본 그룹 시드 (시스템관리자만 admin 권한 사전 적용)
-- ============================================================

CREATE TABLE IF NOT EXISTS permission_groups (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  description     TEXT,
  color           TEXT NOT NULL DEFAULT 'slate',    -- Tailwind 색상 키
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_system_role  BOOLEAN NOT NULL DEFAULT FALSE,   -- 시스템관리자는 삭제·이름변경 금지
  permissions     TEXT[] NOT NULL DEFAULT '{}',     -- ["admin"] 또는 ["menu:/path:read", ...]
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permission_groups_sort ON permission_groups(sort_order);

ALTER TABLE permission_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_permission_groups" ON permission_groups;
CREATE POLICY "allow_all_permission_groups" ON permission_groups FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION trg_permission_groups_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS permission_groups_updated_at ON permission_groups;
CREATE TRIGGER permission_groups_updated_at
  BEFORE UPDATE ON permission_groups
  FOR EACH ROW EXECUTE FUNCTION trg_permission_groups_updated_at();

-- users.permission_group_id
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS permission_group_id INTEGER REFERENCES permission_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_permission_group_id ON users(permission_group_id);

-- ============================================================
-- 기본 7개 그룹 시드 (이미 존재하면 건너뜀)
-- ------------------------------------------------------------
-- 시스템관리자만 ["admin"] 권한 사전 적용. 나머지는 UI에서 관리자가 채워 넣는다.
-- ============================================================

INSERT INTO permission_groups (name, description, color, sort_order, is_system_role, permissions) VALUES
  ('보수일반',      '보수팀 일반 사원 (자재 신청·회수·자기 정보 등)',          'sky',     10, FALSE, '{}'),
  ('보수관리자',    '보수팀 관리자 (자재 발주·입출고·재고실사·통계)',          'blue',    20, FALSE, '{}'),
  ('공사일반',      '공사팀 일반 사원 (현장·공사일정·견적 조회)',              'emerald', 30, FALSE, '{}'),
  ('공사관리자',    '공사팀 관리자 (견적 작성·현장 관리)',                     'green',   40, FALSE, '{}'),
  ('관리일반',      '관리부 일반 사원 (조회 중심)',                            'amber',   50, FALSE, '{}'),
  ('관리관리자',    '관리부 관리자 (사원·거래처·회사정보 관리)',                'orange',  60, FALSE, '{}'),
  ('시스템관리자',  '전체 권한 (admin) — 삭제 불가',                           'rose',    99, TRUE,  ARRAY['admin'])
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 검증
-- ============================================================
SELECT 'permission_groups' AS chk, id, name, color, is_system_role, array_length(permissions, 1) AS perm_count
  FROM permission_groups ORDER BY sort_order;

SELECT 'users.permission_group_id' AS chk, column_name FROM information_schema.columns
  WHERE table_name='users' AND column_name='permission_group_id';
