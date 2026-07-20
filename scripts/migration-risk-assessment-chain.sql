-- 위험성평가 수리공사 유해요인조사 마스터 시드 (체인교체)
-- 원본: Z:\산업안전\위험성평가\2026\대솔이엘\위험요인조사표_체인교체작업.xlsx
-- Idempotent: doc_no UPSERT 후 해당 카테고리 items 전량 재삽입

BEGIN;

-- ================ DS-009 체인교체 (11건) ================
INSERT INTO public.risk_categories (name, doc_no, sub_process, sort_order, active)
VALUES ('체인교체', 'DS-009', '준비 및 자재운반 | 피트(Pit) 진입 및 작업공간 확보 | 구 체인 해체, 철거 | 신규 체인 체결 | 시운전 및 마무리', 9, TRUE)
ON CONFLICT (doc_no) DO UPDATE SET
  name        = EXCLUDED.name,
  sub_process = EXCLUDED.sub_process,
  sort_order  = EXCLUDED.sort_order,
  active      = EXCLUDED.active;

DELETE FROM public.risk_hazard_items
 WHERE category_id = (SELECT id FROM public.risk_categories WHERE doc_no = 'DS-009');

INSERT INTO public.risk_hazard_items (category_id, gubun, hazard, default_present, sort_order)
SELECT c.id, v.gubun, v.hazard, v.default_present, v.sort_order
FROM public.risk_categories c,
(VALUES
  ('준비 및 자재운반', '중량물 인력 들기 및 이동, 허리 굽힘', TRUE, 1),
  ('준비 및 자재운반', '중량물 운반시 무리한 동작으로 허리 요통발생', TRUE, 2),
  ('준비 및 자재운반', '중량물 낙하로 인한 발/손 등의 압착사고 위험', TRUE, 3),
  ('피트(Pit) 진입 및 작업공간 확보', '피트 사디리 고정 상태 점검 (추락 주위)', FALSE, 4),
  ('피트(Pit) 진입 및 작업공간 확보', '개방된 홀도어에  끝단 부위에 의한 자상', TRUE, 5),
  ('피트(Pit) 진입 및 작업공간 확보', '안전장치 미확인으로 인한 협착 끼임주의', TRUE, 6),
  ('피트(Pit) 진입 및 작업공간 확보', '피트 바닥의 오염물(오일/구리스 등)로 인한 전도', TRUE, 7),
  ('구 체인 해체, 철거', '팔을 머리 위로 올린 자세(상체 과다 신전), 좁은 공간', TRUE, 8),
  ('구 체인 해체, 철거', '체인 자중에 의한 끌어당김, 반복적인 수동 윈치/인력 인상', TRUE, 9),
  ('신규 체인 체결', '머리 위 작업, 정밀 공구 조작, 악력 사용', TRUE, 10),
  ('시운전 및 마무리', '허리 숙임, 피트 내 이동 및 청소', FALSE, 11)
) AS v(gubun, hazard, default_present, sort_order)
WHERE c.doc_no = 'DS-009';

COMMIT;

-- 검증
SELECT c.doc_no, c.name, c.sort_order, COUNT(i.id)::int AS 항목수,
       COUNT(*) FILTER (WHERE i.default_present) AS 유표시
FROM public.risk_categories c
LEFT JOIN public.risk_hazard_items i ON i.category_id = c.id
WHERE c.doc_no = 'DS-009'
GROUP BY c.doc_no, c.name, c.sort_order;
