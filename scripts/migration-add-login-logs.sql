-- ============================================================
-- 시스템접속통계용 login_logs
-- ------------------------------------------------------------
-- 로그인 성공 이벤트 1건 = 1 row.
-- 시스템접속통계 페이지(/data/access-stats)에서 사용자별/일자별/월별 집계.
-- username 은 스냅샷(사원 개명 후에도 과거 로그 유지).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.login_logs (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  username   TEXT   NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_login_logs_user_created
  ON public.login_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_logs_created
  ON public.login_logs (created_at DESC);

ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_login_logs ON public.login_logs;
CREATE POLICY allow_all_login_logs ON public.login_logs
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ============================================================
-- 검증
-- ============================================================
SELECT
  column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'login_logs'
ORDER BY ordinal_position;

SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'login_logs';

SELECT COUNT(*) AS existing_rows FROM public.login_logs;
