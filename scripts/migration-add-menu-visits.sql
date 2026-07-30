-- ============================================================
-- 시스템접속통계용 menu_visits
-- ------------------------------------------------------------
-- 사이드바 메뉴 클릭·URL 진입으로 "새 탭이 열린 순간" 1 row.
-- 이미 열린 탭 재클릭·탭바 스위칭은 카운트하지 않음(openTab.added=true 만).
-- href 는 원본 그대로 저장(서브 라우트도 별도 카운트: /quotes vs /quotes/new).
-- 공통 페이지(/dashboard·/me·/settings·/data/profile·/manual)도 포함.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.menu_visits (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  username   TEXT   NOT NULL,
  href       TEXT   NOT NULL,
  menu_label TEXT,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menu_visits_user_visited
  ON public.menu_visits (user_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_menu_visits_href_visited
  ON public.menu_visits (href, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_menu_visits_visited
  ON public.menu_visits (visited_at DESC);

ALTER TABLE public.menu_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_menu_visits ON public.menu_visits;
CREATE POLICY allow_all_menu_visits ON public.menu_visits
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ============================================================
-- 검증
-- ============================================================
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'menu_visits'
ORDER BY ordinal_position;

SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'menu_visits';

SELECT COUNT(*) AS existing_rows FROM public.menu_visits;
