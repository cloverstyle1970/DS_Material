-- 위험성평가 참가자 + 서명 지원
-- - hazard_survey_participants: 평가에 참여한 인원 목록 (survey_id, user_id, user_name, signature_url, signed_at)
-- - 서명 png는 기존 tbm-photos 버킷 재활용 (경로 접두사 'risk/')
-- - RLS 개방 (개발 표준)

CREATE TABLE IF NOT EXISTS public.hazard_survey_participants (
  survey_id     INTEGER NOT NULL REFERENCES public.hazard_surveys(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL,
  user_name     TEXT NOT NULL,
  signature_url TEXT,
  signed_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (survey_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_hazard_survey_participants_user_id
  ON public.hazard_survey_participants(user_id);

ALTER TABLE public.hazard_survey_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_hazard_survey_participants ON public.hazard_survey_participants;
CREATE POLICY allow_all_hazard_survey_participants
  ON public.hazard_survey_participants FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 확인
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'hazard_survey_participants'
ORDER BY ordinal_position;
