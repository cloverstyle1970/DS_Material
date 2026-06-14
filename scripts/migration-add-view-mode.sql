-- accounts 테이블에 view_mode 컬럼 추가
-- 사용자별 화면 레이아웃 모드(모바일/PC) 저장. 환경설정에서 선택하며, 선택 시
-- viewport 반응형 자동 감지를 무시하고 해당 모드 레이아웃으로 강제 전환된다.
-- 'pc' | 'mobile' 두 값만 사용. 기본값 'pc'.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS view_mode TEXT NOT NULL DEFAULT 'pc';

-- 값 검증 제약 (idempotent — 이미 있으면 건너뜀)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_view_mode_check'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_view_mode_check CHECK (view_mode IN ('pc', 'mobile'));
  END IF;
END $$;

-- 실행 확인
SELECT id, username, view_mode
FROM accounts
LIMIT 5;
