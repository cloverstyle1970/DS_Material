-- 자재 화면 전환: materials RLS 개방
-- ------------------------------------------------------------
-- materials 는 신DB에 구DB와 동일 스키마+데이터(3,271행)로 이미 존재.
-- anon 클라이언트가 읽도록 개발 표준 USING(TRUE) 정책으로 푼다.
-- (코드 변경 불필요 — 스키마 호환. 카테고리 라벨은 정적 폴백)
-- Supabase Dashboard > SQL Editor 에서 1회 실행 (idempotent)

ALTER TABLE materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_full ON materials;
DROP POLICY IF EXISTS allow_all_materials ON materials;
CREATE POLICY allow_all_materials ON materials
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT policyname, roles::text FROM pg_policies
WHERE schemaname='public' AND tablename='materials';
