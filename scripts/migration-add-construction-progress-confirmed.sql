-- ============================================================
-- construction_schedules.progress_confirmed (기성확인) 컬럼 추가
-- ------------------------------------------------------------
-- 공사일정 카드의 "기성확인" 체크박스 상태 저장.
-- TRUE 이면 캘린더에서 해당 일정의 테두리·텍스트가 빨간색으로 표시됨.
-- ============================================================

ALTER TABLE construction_schedules
  ADD COLUMN IF NOT EXISTS progress_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_construction_schedules_progress_confirmed
  ON construction_schedules(progress_confirmed)
  WHERE progress_confirmed = TRUE;

-- ============================================================
-- 검증
-- ============================================================
SELECT 'construction_schedules.progress_confirmed' AS chk, column_name, data_type, column_default
  FROM information_schema.columns
  WHERE table_name='construction_schedules' AND column_name='progress_confirmed';
