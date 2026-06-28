-- ============================================================
-- 위험성평가 / 유해요인조사표  (KOSHA 체크리스트법 지침 정렬)
--   - 대분류(risk_categories): 위험성평가 문서번호(DS-001) 자동 채번 단위
--   - 유해요인 마스터(risk_hazard_items): 유해요인조사표 전체 항목(= 위험성평가 항목 원본)
--       * default_present: 유해요인조사표 기본 유(true)/무(false)
--   - 유해요인조사(hazard_surveys): 기사가 대분류 1개에 대해 작성한 조사 1건
--   - 조사 항목 결과(hazard_survey_items): 항목별 유/무 + (관리자) 위험성평가 입력
--       * '유'로 평가된 항목만 위험성평가표에 반영
--       * 조사 시점 항목 내용을 스냅샷 보존(마스터 변경에도 과거 조사 불변)
-- idempotent. Supabase SQL Editor 수동 실행.
-- ============================================================

-- 1) 대분류 -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.risk_categories (
  id          serial PRIMARY KEY,
  name        text NOT NULL,                 -- 보수점검(자체점검), 고장처리, 수리공사(쉬브) ...
  doc_no      text UNIQUE NOT NULL,          -- 위험성평가 문서번호: DS-001 (대분류별 자동 채번)
  sub_process text,                          -- 중분류 공정
  sort_order  int DEFAULT 0,
  active       boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- 2) 유해요인 마스터(= 유해요인조사표 전체 항목) -------------
CREATE TABLE IF NOT EXISTS public.risk_hazard_items (
  id                  serial PRIMARY KEY,
  category_id         int NOT NULL REFERENCES public.risk_categories(id) ON DELETE CASCADE,
  gubun               text,                  -- 구분(중분류): 기계실/CAGE점검/카상부점검/승강장/PIT/HYD/MRL ...
  hazard              text NOT NULL,         -- 안전보건 유해·위험요인
  accident_type       text,                  -- 재해 형태
  current_measure     text,                  -- 현 안전조치
  default_improvement text,                  -- 기본 위험관리 및 개선대책
  default_legal_basis text,                  -- 기본 관련근거(법령/기준, 선택)
  default_present     boolean DEFAULT false, -- 유해요인조사표 기본 유(true)/무(false)
  sort_order          int DEFAULT 0,
  active              boolean DEFAULT true,
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_risk_hazard_items_category ON public.risk_hazard_items(category_id);

-- 3) 유해요인조사 (기사 작성 1건) ----------------------------
CREATE TABLE IF NOT EXISTS public.hazard_surveys (
  id          serial PRIMARY KEY,
  category_id int NOT NULL REFERENCES public.risk_categories(id) ON DELETE CASCADE,
  site_name   text,                          -- 현장명
  assess_type text DEFAULT '정기',           -- 종류: 정기 | 수시
  team        text,                          -- 작성팀
  assessor    text,                          -- 평가자
  survey_date date NOT NULL,                 -- 작성일
  user_id     int REFERENCES public.accounts(id) ON DELETE SET NULL,
  status      text DEFAULT 'submitted',      -- submitted(제출) | assessed(평가완료)
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hazard_surveys_category ON public.hazard_surveys(category_id);

-- 4) 조사 항목 결과 -----------------------------------------
CREATE TABLE IF NOT EXISTS public.hazard_survey_items (
  id              serial PRIMARY KEY,
  survey_id       int NOT NULL REFERENCES public.hazard_surveys(id) ON DELETE CASCADE,
  item_id         int REFERENCES public.risk_hazard_items(id) ON DELETE SET NULL,
  gubun           text,
  hazard          text,
  accident_type   text,
  current_measure text,
  present         boolean DEFAULT false,     -- 유=true / 무=false
  result          text,                      -- 적정 | 보완 | 해당없음
  improvement     text,                      -- 개선대책(위험성 감소대책)
  improve_done_date date,                    -- 개선 완료일 (KOSHA 지침)
  manager         text,                      -- 담당자 (KOSHA 지침)
  legal_basis     text,                      -- 관련근거(법령/기준, 선택)
  register_no     text,                      -- 중요위험 등록번호
  note            text,
  sort_order      int DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hazard_survey_items_survey ON public.hazard_survey_items(survey_id);

-- 기존 설치분 컬럼 보강 (재실행 안전) -----------------------
ALTER TABLE public.risk_hazard_items   ADD COLUMN IF NOT EXISTS default_legal_basis text;
ALTER TABLE public.risk_hazard_items   ADD COLUMN IF NOT EXISTS default_present boolean DEFAULT false;
ALTER TABLE public.hazard_survey_items ADD COLUMN IF NOT EXISTS improve_done_date date;
ALTER TABLE public.hazard_survey_items ADD COLUMN IF NOT EXISTS manager text;
ALTER TABLE public.hazard_survey_items ADD COLUMN IF NOT EXISTS legal_basis text;
ALTER TABLE public.hazard_surveys      ADD COLUMN IF NOT EXISTS site_name text;
ALTER TABLE public.hazard_surveys      ADD COLUMN IF NOT EXISTS assess_type text DEFAULT '정기';

-- RLS 개방(개발 표준) --------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['risk_categories','risk_hazard_items','hazard_surveys','hazard_survey_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS allow_all_%I ON public.%I', t, t);
    EXECUTE format('CREATE POLICY allow_all_%I ON public.%I FOR ALL USING (TRUE) WITH CHECK (TRUE)', t, t);
  END LOOP;
END $$;

-- 시드: 보수점검(자체점검) DS-001 + 유해요인조사표 60개 ------
-- (항목 수가 60이 아닐 때만 재시드 → 11개 구버전 자동 업그레이드, 60개면 no-op)
DO $$
DECLARE cat_id int; cnt int;
BEGIN
  SELECT id INTO cat_id FROM public.risk_categories WHERE doc_no = 'DS-001';
  IF cat_id IS NULL THEN
    INSERT INTO public.risk_categories(name, doc_no, sub_process, sort_order)
    VALUES ('보수점검(자체점검)', 'DS-001', '기계실/CAGE/카상부/승강장/PIT/HYD/MRL', 1)
    RETURNING id INTO cat_id;
  ELSE
    UPDATE public.risk_categories SET sub_process = '기계실/CAGE/카상부/승강장/PIT/HYD/MRL' WHERE id = cat_id;
  END IF;

  SELECT count(*) INTO cnt FROM public.risk_hazard_items WHERE category_id = cat_id;
  IF cnt <> 60 THEN
    DELETE FROM public.risk_hazard_items WHERE category_id = cat_id;
    INSERT INTO public.risk_hazard_items(category_id, gubun, hazard, accident_type, current_measure, default_improvement, default_legal_basis, default_present, sort_order) VALUES
    (cat_id, '기계실', '계단에서 미끄러짐등으로 인한 전도사고위험', '전도', NULL, NULL, NULL, FALSE, 1),
    (cat_id, '기계실', '기계실로의 이동 통로에 장애물 및 어두움으로 전도/충돌 사고위험', '전도/충돌', NULL, NULL, NULL, FALSE, 2),
    (cat_id, '기계실', '기계실 내에서 조명의 미점등으로 인해 전도/충돌 위험', '전도/충돌', NULL, NULL, NULL, FALSE, 3),
    (cat_id, '기계실', '쉬브의 회전으로 인한 손가락 협착 사고위험', '협착', NULL, NULL, NULL, TRUE, 4),
    (cat_id, '기계실', '베어링 소음 점검시 회전체 충돌 위험', '충돌', NULL, NULL, NULL, FALSE, 5),
    (cat_id, '기계실', '점검 시 머신 빔 등에 인해 전도/충돌 위험', '전도/충돌', NULL, NULL, NULL, FALSE, 6),
    (cat_id, '기계실', '안전화 미착용으로 인한 미끄러져 전도사고위험', '전도', NULL, NULL, NULL, FALSE, 7),
    (cat_id, '기계실', '갭 조정작업으로 인한 회전체의 손가락 끼임 위험', '끼임', NULL, NULL, NULL, FALSE, 8),
    (cat_id, '기계실', '쉬브의 회전으로 인한 손가락 협착 사고 발생', '협착', NULL, NULL, NULL, TRUE, 9),
    (cat_id, '기계실', '베어링 소음 점검시 기계대 빔에 충돌 위험 발생', '충돌', NULL, NULL, NULL, FALSE, 10),
    (cat_id, '기계실', '쉬브와 로프의 회전체에 손가락 끼임 발생', '끼임', NULL, NULL, NULL, TRUE, 11),
    (cat_id, '기계실', '조속기에 걸려서 전도사고발생', '전도', NULL, NULL, NULL, FALSE, 12),
    (cat_id, '기계실', '메인 전원에 감전 위험', '감전', NULL, NULL, NULL, TRUE, 13),
    (cat_id, '기계실', '점검으로 메인전원 차단시 이용자의 갇힘사고 발생', '갇힘', NULL, NULL, NULL, FALSE, 14),
    (cat_id, '기계실', 'Cover류나 전선등으로 인한 손가락 배임/좌상 발생', '좌상', NULL, NULL, NULL, FALSE, 15),
    (cat_id, '기계실', '장시간 조그려서 앉아서 일어나면 어지러움 발생', '건강장해', NULL, NULL, NULL, FALSE, 16),
    (cat_id, 'CAGE 점검', '아크릴의 낙하로 인한 사고발생', '낙하', NULL, NULL, NULL, FALSE, 17),
    (cat_id, 'CAGE 점검', '안전 스위치 불량으로 도어에 이용자/점검자가 충돌하는 사고발생', '충돌', NULL, NULL, NULL, FALSE, 18),
    (cat_id, 'CAGE 점검', '카내와 경비실(관리실)과의 통화불량으로 이용자의 오랜 갇힘사고발생', '갇힘', NULL, NULL, NULL, FALSE, 19),
    (cat_id, '카상부점검', '카 상부 진출입시 카와 승강장과의 차이가 많아 추락하는 사고발생', '추락', NULL, NULL, NULL, TRUE, 20),
    (cat_id, '카상부점검', '천정이나 체대의 오일로 인한 전도사고발생', '전도', NULL, NULL, NULL, FALSE, 21),
    (cat_id, '카상부점검', '안전라인(JUMPER) 미제거로 인하여 카상부 진입 시 압착사고 발생', '압착', NULL, NULL, NULL, TRUE, 22),
    (cat_id, '카상부점검', '기계실 내에서 조명의 미점등으로 인해 전도/추락 사고 발생', '추락/전도', NULL, NULL, NULL, TRUE, 23),
    (cat_id, '카상부점검', '도어 점검시 열리고 닫히는 레버에 손 압착 사고발생', '압착', NULL, NULL, NULL, TRUE, 24),
    (cat_id, '카상부점검', '행거롤러와 레일사이에 손가락 압착사고 발생', '압착', NULL, NULL, NULL, FALSE, 25),
    (cat_id, '카상부점검', '카덕트 점검시에 모터 전원에 의한 감전사고발생', '감전', NULL, NULL, NULL, FALSE, 26),
    (cat_id, '카상부점검', '쉬브와 로프 사이에 손가락 협착사고발생', '협착', NULL, NULL, NULL, FALSE, 27),
    (cat_id, '카상부점검', '쉬브와 로프 사이에 손가락 협착사고발생', '협착', NULL, NULL, NULL, FALSE, 28),
    (cat_id, '카상부점검', '도어 판넬의 날카로운 절단면에 손바닥이 찢어짐 사고발생', '자상', NULL, NULL, NULL, TRUE, 29),
    (cat_id, '카상부점검', '인터록 조정시 손가락 압착사고발생', '압착', NULL, NULL, NULL, FALSE, 30),
    (cat_id, '카상부점검', '행거롤러와 레일사이에 손가락 압착사고 발생', '압착', NULL, NULL, NULL, FALSE, 31),
    (cat_id, '카상부점검', '최하층 도어 장치 점검 시 추락의 위험 발생', '추락', NULL, NULL, NULL, FALSE, 32),
    (cat_id, '승강장', '고정되지 않아 홀 버튼이 떨어짐으로 인한 고객의 발에 낙하사고발생', '낙하', NULL, NULL, NULL, TRUE, 33),
    (cat_id, '승강장', '고정되지 않아 홀 표시기가 떨어짐으로 인한 고객의 머리에 낙하사고발생', '낙하', NULL, NULL, NULL, TRUE, 34),
    (cat_id, '승강장', '홀도어와 JAMB 사이에 간격이 넓어 손의 압착/찢어짐 사고발생', '압착/자상', NULL, NULL, NULL, FALSE, 35),
    (cat_id, '승강장', '홀 도어에 안전스티커 미부착시 추락사고발생', '추락', NULL, NULL, NULL, FALSE, 36),
    (cat_id, 'PIT', '안전라인(JUMPER) 미제거로 인하여 카상부 진입 시 압착사고 발생', '압착', NULL, NULL, NULL, TRUE, 37),
    (cat_id, 'PIT', '도어 판넬의 날카로운 절단면에 손바닥이 찢어짐 사고발생', '자상', NULL, NULL, NULL, TRUE, 38),
    (cat_id, 'PIT', '작업완료후 승강장으로 나갈경우 도어를 개방하려다 추락사고발생', '추락', NULL, NULL, NULL, TRUE, 39),
    (cat_id, 'PIT', '최하층 도어가 열린상태에서 피트 청소로 인하여 이용자 추락사고발생', '추락', NULL, NULL, NULL, TRUE, 40),
    (cat_id, 'PIT', '바닥의 오일 등으로 인한 전도사고발생', '전도', NULL, NULL, NULL, FALSE, 41),
    (cat_id, 'PIT', '기계실 내에서 조명의 미점등으로 인해 추락위험발생', '추락', NULL, NULL, NULL, TRUE, 42),
    (cat_id, 'PIT', '피트스위치 ON/OFF시 승강장 바닥에서 추락사고 발생', '추락', NULL, NULL, NULL, TRUE, 43),
    (cat_id, 'PIT', '로프 늘어짐으로 인해 조정 작업시 손가락 압착사고발생', '압착', NULL, NULL, NULL, FALSE, 44),
    (cat_id, 'PIT', '쉬브와 로프 사이에 손가락 협착사고위험', '협착', NULL, NULL, NULL, FALSE, 45),
    (cat_id, 'PIT', '로드 스위치 동작확인시 카 하부 플레이트에 충돌위험', '충돌', NULL, NULL, NULL, FALSE, 46),
    (cat_id, 'PIT', '고정부위 풀림이나 파단으로 낙하사고위험', '낙하', NULL, NULL, NULL, FALSE, 47),
    (cat_id, 'HYD', '오일 누유로 인한 바닥의 미끄러짐으로 전도사고위험', '전도', NULL, NULL, NULL, FALSE, 48),
    (cat_id, 'HYD', '조명 미점등 시 점검을 위해 기계실 출입시 전도/충돌사고위험', '전도/충돌', NULL, NULL, NULL, FALSE, 49),
    (cat_id, 'HYD', '오일의 온도 상승으로 인한 이상온도 접촉으로 사고위험', NULL, NULL, NULL, NULL, FALSE, 50),
    (cat_id, 'HYD', '플랜저 오일 누유로 인한 카내 승객 오일 떨어짐 발생', NULL, NULL, NULL, NULL, FALSE, 51),
    (cat_id, 'HYD', '실린더 오일 누유로 인한 PIT 바닥의 미끄러짐으로 전도사고위험', '전도', NULL, NULL, NULL, FALSE, 52),
    (cat_id, 'MRL', '승강로 조명 미점등시 카 상부진입 및 기계점검시 추락/충돌위험', '추락/충돌', NULL, NULL, NULL, TRUE, 53),
    (cat_id, 'MRL', '승강로 작업시 조명 파손으로 인한 낙하사고 위험', '낙하', NULL, NULL, NULL, TRUE, 54),
    (cat_id, 'MRL', '상부브레이크 동작소음발생으로 인한 점검시 승강로 추락위험', '추락', NULL, NULL, NULL, TRUE, 55),
    (cat_id, 'MRL', '하부브레이크 개방으로 인한 PIT의 카운터웨이트에 충돌위험', '충돌', NULL, NULL, NULL, TRUE, 56),
    (cat_id, 'MRL', '제어반 점검시 감전 위험', '감전', NULL, NULL, NULL, TRUE, 57),
    (cat_id, 'MRL', '제어반 판넬 분해시 중량물에 의한 요통등의 위험', '요통', NULL, NULL, NULL, FALSE, 58),
    (cat_id, 'MRL', '모터 불량으로 인한 점검시 추락위험', '추락', NULL, NULL, NULL, TRUE, 59),
    (cat_id, 'MRL', '조속기 점검 및 동작 테스터시 회전체에 협착사고', '협착', NULL, NULL, NULL, TRUE, 60);
  END IF;
END $$;

-- 검증 -----------------------------------------------------
SELECT c.doc_no, c.name, c.sub_process,
       count(i.id) AS 항목수,
       count(i.id) FILTER (WHERE i.default_present) AS 기본유
FROM public.risk_categories c
LEFT JOIN public.risk_hazard_items i ON i.category_id = c.id
GROUP BY c.id ORDER BY c.sort_order;
