-- ============================================================
-- TBM 참가자 확인(attestation) 기능 추가
-- ------------------------------------------------------------
-- 작업참가자가 TBM 내용(체크리스트·안전수칙)을 확인하고
-- 서명·사진을 추가할 수 있도록 다음을 추가:
--   1. tbm_participants: signature_url, confirmed_at 컬럼 추가
--   2. tbm_participant_checklist (참가자별 체크리스트 확인)
--   3. tbm_participant_safety   (참가자별 안전수칙 확인)
--   4. tbm_participant_photos   (참가자별 사진)
-- ============================================================

-- [1] 참가자 본인의 서명·확인일시
ALTER TABLE tbm_participants
  ADD COLUMN IF NOT EXISTS signature_url TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_at  TIMESTAMPTZ;

-- [2] 참가자별 체크리스트 확인 결과
CREATE TABLE IF NOT EXISTS tbm_participant_checklist (
  tbm_id      INTEGER NOT NULL REFERENCES tbm_records(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  item_id     INTEGER NOT NULL REFERENCES tbm_checklist_items(id) ON DELETE RESTRICT,
  is_checked  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tbm_id, user_id, item_id)
);

-- [3] 참가자별 안전수칙 확인 (acknowledged = 확인함)
CREATE TABLE IF NOT EXISTS tbm_participant_safety (
  tbm_id        INTEGER NOT NULL REFERENCES tbm_records(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rule_id       INTEGER NOT NULL REFERENCES tbm_safety_rules_master(id) ON DELETE RESTRICT,
  acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tbm_id, user_id, rule_id)
);

-- [4] 참가자별 사진
CREATE TABLE IF NOT EXISTS tbm_participant_photos (
  id          SERIAL PRIMARY KEY,
  tbm_id      INTEGER NOT NULL REFERENCES tbm_records(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  photo_url   TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tbm_participant_photos_tbm_id  ON tbm_participant_photos(tbm_id);
CREATE INDEX IF NOT EXISTS idx_tbm_participant_photos_user_id ON tbm_participant_photos(user_id);

-- [5] RLS (앱 내부 접근만 허용 — DROP 후 재생성으로 멱등 보장)
ALTER TABLE tbm_participant_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE tbm_participant_safety    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tbm_participant_photos    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_tbm_participant_checklist" ON tbm_participant_checklist;
DROP POLICY IF EXISTS "allow_all_tbm_participant_safety"    ON tbm_participant_safety;
DROP POLICY IF EXISTS "allow_all_tbm_participant_photos"    ON tbm_participant_photos;

CREATE POLICY "allow_all_tbm_participant_checklist" ON tbm_participant_checklist FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_tbm_participant_safety"    ON tbm_participant_safety    FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_tbm_participant_photos"    ON tbm_participant_photos    FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT 'tbm_participants(new cols)' AS tbl,
       COUNT(*) FILTER (WHERE column_name IN ('signature_url','confirmed_at')) AS cnt
FROM information_schema.columns
WHERE table_name = 'tbm_participants'
UNION ALL SELECT 'tbm_participant_checklist',
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'tbm_participant_checklist')
UNION ALL SELECT 'tbm_participant_safety',
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'tbm_participant_safety')
UNION ALL SELECT 'tbm_participant_photos',
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'tbm_participant_photos');

-- 예상 결과:
--   tbm_participants(new cols)   2
--   tbm_participant_checklist    1
--   tbm_participant_safety       1
--   tbm_participant_photos       1
