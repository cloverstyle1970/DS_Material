-- 게시판: 개선요청 기능
-- Supabase Dashboard > SQL Editor 또는 scripts/apply-migration.mjs로 실행 (idempotent).
--
-- 설계:
--   * 단일 페이지(/board/improvements) — 목록 + 모달 등록·상세
--   * 권한: 전직원 read/create — 운영 표준이라 마이그레이션에서 모든 계정에 직접 부여.
--     수정·삭제는 작성자 또는 admin만(런타임 체크). 상태 변경·응답은 admin만.
--   * 한 테이블만 — 댓글·카테고리·첨부는 향후 확장.

-- 1) improvement_requests 테이블
CREATE TABLE IF NOT EXISTS improvement_requests (
  id          BIGSERIAL    PRIMARY KEY,
  author_id   BIGINT       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title       TEXT         NOT NULL,
  content     TEXT         NOT NULL,
  status      TEXT         NOT NULL DEFAULT '접수'
                CHECK (status IN ('접수','검토중','반영','거부')),
  response    TEXT,
  assignee_id BIGINT       REFERENCES accounts(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS improvement_requests_author_idx ON improvement_requests (author_id);
CREATE INDEX IF NOT EXISTS improvement_requests_status_idx ON improvement_requests (status);
CREATE INDEX IF NOT EXISTS improvement_requests_created_idx ON improvement_requests (created_at DESC);

-- 자동 updated_at 갱신 트리거 (이미 같은 함수가 있을 수 있으니 CREATE OR REPLACE)
CREATE OR REPLACE FUNCTION set_updated_at_now() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS improvement_requests_set_updated_at ON improvement_requests;
CREATE TRIGGER improvement_requests_set_updated_at
  BEFORE UPDATE ON improvement_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- 2) RLS (개발 표준 — 운영 전 강화 필요)
ALTER TABLE improvement_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_improvement_requests ON improvement_requests;
CREATE POLICY allow_all_improvement_requests ON improvement_requests
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 3) 권한 부여 — 모든 사용자에게 read/create 키 자동 추가
--    실제 컬럼 타입 (2026-06-12 직접접속 확인):
--      accounts.permissions          jsonb           (CLAUDE.md의 text[] 기록은 부정확)
--      permission_groups.permissions text[]
--
--    a) accounts (jsonb) — admin 보유자는 이미 통과하므로 제외. jsonb ? 로 중복 체크.
UPDATE accounts
SET permissions = COALESCE(permissions, '[]'::jsonb) || jsonb_build_array('menu:/board/improvements:read')
WHERE NOT (COALESCE(permissions, '[]'::jsonb) ? 'admin')
  AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'menu:/board/improvements:read');

UPDATE accounts
SET permissions = COALESCE(permissions, '[]'::jsonb) || jsonb_build_array('menu:/board/improvements:create')
WHERE NOT (COALESCE(permissions, '[]'::jsonb) ? 'admin')
  AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'menu:/board/improvements:create');

--    b) permission_groups (text[]) — 7개 시드 템플릿에 추가. "↻ 멤버에 적용" 시 동기화.
UPDATE permission_groups
SET permissions = COALESCE(permissions, ARRAY[]::TEXT[]) || ARRAY['menu:/board/improvements:read']
WHERE NOT ('menu:/board/improvements:read' = ANY(COALESCE(permissions, ARRAY[]::TEXT[])));

UPDATE permission_groups
SET permissions = COALESCE(permissions, ARRAY[]::TEXT[]) || ARRAY['menu:/board/improvements:create']
WHERE NOT ('menu:/board/improvements:create' = ANY(COALESCE(permissions, ARRAY[]::TEXT[])));

-- 검증
SELECT
  (SELECT COUNT(*) FROM improvement_requests) AS total_requests,
  (SELECT COUNT(*) FROM accounts
     WHERE permissions ? 'menu:/board/improvements:read'
        OR permissions ? 'admin')              AS accounts_with_read,
  (SELECT COUNT(*) FROM permission_groups
     WHERE 'menu:/board/improvements:read' = ANY(permissions)) AS groups_patched;
