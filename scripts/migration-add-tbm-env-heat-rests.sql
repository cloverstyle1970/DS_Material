-- ============================================================
-- TBM 등록에 환경지표(기상정보) / 온열질환 예방 휴게실시 데이터 추가
--
-- 배경: 작업일지 페이지 폐지 예정 → 관련 지표를 TBM 기록에 흡수.
--       공사구분과 작업내용 사이에 환경지표·휴게 실시 확인 섹션이 추가된다.
--
-- - tbm_env_readings : 기상 관측 로그 (온도·습도·체감온도·지역·시각)
-- - tbm_heat_rests   : 온열질환 예방 휴게 실시 로그 (시작·종료·휴게방법)
--
-- 모두 tbm_records.id 참조, ON DELETE CASCADE.
-- 개발 단계 표준(all-permissive RLS)을 따른다.
--
-- 실행: Supabase Dashboard → SQL Editor 붙여넣기 (idempotent).
-- ============================================================

-- 1) tbm_env_readings
CREATE TABLE IF NOT EXISTS public.tbm_env_readings (
  id                    BIGSERIAL PRIMARY KEY,
  tbm_id                INTEGER NOT NULL
                        REFERENCES public.tbm_records(id) ON DELETE CASCADE,
  seq                   INTEGER NOT NULL DEFAULT 1,
  observed_at           TIME,
  temperature           NUMERIC,
  humidity              NUMERIC,
  apparent_temperature  NUMERIC,
  location              TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tbm_env_readings_tbm_id
  ON public.tbm_env_readings(tbm_id);

ALTER TABLE public.tbm_env_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_tbm_env_readings ON public.tbm_env_readings;
CREATE POLICY allow_all_tbm_env_readings
  ON public.tbm_env_readings
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 2) tbm_heat_rests
CREATE TABLE IF NOT EXISTS public.tbm_heat_rests (
  id           BIGSERIAL PRIMARY KEY,
  tbm_id       INTEGER NOT NULL
               REFERENCES public.tbm_records(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL DEFAULT 1,
  rest_start   TIME,
  rest_end     TIME,
  rest_method  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tbm_heat_rests_tbm_id
  ON public.tbm_heat_rests(tbm_id);

ALTER TABLE public.tbm_heat_rests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_tbm_heat_rests ON public.tbm_heat_rests;
CREATE POLICY allow_all_tbm_heat_rests
  ON public.tbm_heat_rests
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 3) 검증
SELECT 'tbm_env_readings' AS table_name, COUNT(*) AS rows FROM public.tbm_env_readings
UNION ALL
SELECT 'tbm_heat_rests', COUNT(*) FROM public.tbm_heat_rests;
