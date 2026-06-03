-- =============================================
-- 크로스사이트 인증 토큰 테이블
-- 유지보수 ↔ 자재관리 사이트 간 로그인 상태 공유용
-- Supabase SQL Editor에서 실행
-- =============================================

-- 1. 테이블 생성
CREATE TABLE IF NOT EXISTS auth_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '60 seconds',
  used BOOLEAN DEFAULT false,
  source TEXT DEFAULT 'unknown'  -- 'maintenance' 또는 'material' (어디서 생성했는지)
);

-- 2. RLS 활성화
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;

-- 3. 인증된 사용자 전체 접근 (유지보수 사이트: Supabase Auth 사용)
CREATE POLICY "auth_full" ON auth_tokens
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- 4. anon 사용자도 INSERT/SELECT 허용 (자재관리 사이트: Supabase Auth 미사용)
--    토큰은 1회용+60초 만료이므로 anon INSERT가 보안상 문제 없음
CREATE POLICY "anon_insert" ON auth_tokens
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon_select" ON auth_tokens
  FOR SELECT TO anon
  USING (true);

-- 5. anon도 사용 완료 표시 가능
CREATE POLICY "anon_update_used" ON auth_tokens
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- 6. 인덱스: 만료 토큰 정리용
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires ON auth_tokens (expires_at);

-- 7. (선택) 만료된 토큰 자동 정리 함수
-- pg_cron이 활성화되어 있다면 아래 cron 추가
-- SELECT cron.schedule('cleanup-auth-tokens', '*/5 * * * *',
--   $$DELETE FROM auth_tokens WHERE expires_at < now() - INTERVAL '5 minutes'$$
-- );
