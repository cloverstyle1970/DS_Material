-- 위험성평가 수리공사 유해요인조사 마스터 시드 (6종)
-- 원본: Z:\산업안전\위험성평가\2026\대솔이엘\위험요인조사표.xlsx
-- 대분류: 쉬브·로프·모터·조속기·로프브레이크·(ES)보조브레이크
-- 미포함: 체인교체, SRS (원본 자료 대기)
-- Idempotent: 각 doc_no UPSERT 후 해당 카테고리 items 전량 재삽입

BEGIN;

-- ================ DS-003 쉬브교체 (31건) ================
INSERT INTO public.risk_categories (name, doc_no, sub_process, sort_order, active)
VALUES ('쉬브교체', 'DS-003', '중량물/장비차량적재 | 중량물/장비이동 | PIT 파이프고임작업 | 카 양중작업 | Main Rope제거작업 | Main Sheave분해 | Main Sheave가열 | Main Sheave조립 | Main Rope걸기작업 | 카양중제거작업 | (카상부) | 카양중제거작업(PIT) | 철거중량물/장비이동 | 중량물/장비하차', 3, TRUE)
ON CONFLICT (doc_no) DO UPDATE SET
  name        = EXCLUDED.name,
  sub_process = EXCLUDED.sub_process,
  sort_order  = EXCLUDED.sort_order,
  active      = EXCLUDED.active;

DELETE FROM public.risk_hazard_items
 WHERE category_id = (SELECT id FROM public.risk_categories WHERE doc_no = 'DS-003');

INSERT INTO public.risk_hazard_items (category_id, gubun, hazard, default_present, sort_order)
SELECT c.id, v.gubun, v.hazard, v.default_present, v.sort_order
FROM public.risk_categories c,
(VALUES
  ('중량물/장비차량적재', '중량물/장비를 차량에 적재시 허리 요통 발생', TRUE, 1),
  ('중량물/장비차량적재', '중량물 차량에 적재시 손/발이 끼어 압착사고발생', TRUE, 2),
  ('중량물/장비이동', '전도 및 낙하로 인한 발/손가락이 끼어 압착사고발생', TRUE, 3),
  ('PIT 파이프고임작업', '파이프를 PIT로 운반시 파이프 낙하로 인한 손/발의 압착사고발생', TRUE, 4),
  ('PIT 파이프고임작업', '안전라인(JUMPER) 미제거로 인하여 카상부 진입 시 압착사고 발생', TRUE, 5),
  ('PIT 파이프고임작업', '도어 판넬의 날카로운 절단면에 손바닥이 찢어짐 사고발생', TRUE, 6),
  ('PIT 파이프고임작업', '작업완료후 승강장으로 나갈경우 도어를 개방하려다 추락사고발생', TRUE, 7),
  ('카 양중작업', '체인블록을 카 상부 운반시 허리 통증 발생됨', TRUE, 8),
  ('카 양중작업', '체인블록을 체인다이스키에 체결시 낙하로 인한 압착사고발생', TRUE, 9),
  ('카 양중작업', '승강로로 작업자의 추락사고 위험발생', TRUE, 10),
  ('Main Rope제거작업', '제거 시 손가락 끼임으로 인한 압착사고 발생', FALSE, 11),
  ('Main Rope제거작업', '조속기 캣치시 손 끼임등의 압착사고 발생', FALSE, 12),
  ('Main Sheave분해', '지그의 낙하로 인한 손가락/발등의 압착사고 발생', FALSE, 13),
  ('Main Sheave분해', 'Sheave 분해시 낙하로 인한 손가락/발등의 압착사고발생', TRUE, 14),
  ('Main Sheave가열', 'Sheave의 열달굼으로 인하여 이상온도 접촉으로 손등의 사고발생', FALSE, 15),
  ('Main Sheave조립', '조립 시 중량물의 운반시 허리등의 통증이 발생됨', TRUE, 16),
  ('Main Sheave조립', 'Sheave 조립시 낙하로 인한 손가락/발등의 압착사고발생', TRUE, 17),
  ('Main Rope걸기작업', '걸기작업 시 손가락 끼임사고 발생', FALSE, 18),
  ('Main Rope걸기작업', 'Rope의 처짐의 중량으로 인한 허리 통증 발생', FALSE, 19),
  ('카양중제거작업', '체인블록을 체인다이스키에 체결시 낙하로 인한 압착사고발생', TRUE, 20),
  ('(카상부)', '체인블록을 카 상부에서 승강장으로 운반시 허리 통증 발생됨', TRUE, 21),
  ('(카상부)', '로프 체결시 머리등의 충돌로 인한 사고 발생', FALSE, 22),
  ('카양중제거작업(PIT)', '안전라인(JUMPER) 미제거로 인하여 카상부 진입 시 압착사고 발생', TRUE, 23),
  ('카양중제거작업(PIT)', '도어 판넬의 날카로운 절단면에 손바닥이 찢어짐 사고발생', TRUE, 24),
  ('카양중제거작업(PIT)', '작업완료후 승강장으로 나갈경우 도어를 개방하려다 추락사고발생', TRUE, 25),
  ('카양중제거작업(PIT)', 'PIT에서 파이프가 옆으로 넘어짐으로 인한 도괴사고발생', FALSE, 26),
  ('철거중량물/장비이동', '전도 및 낙하로 인한 발/손가락 압착사고발생', TRUE, 27),
  ('중량물/장비차량적재', '중량물/장비를 차량에 적재시 허리 요통 발생', TRUE, 28),
  ('중량물/장비차량적재', '중량물 차량에 적재시 손/발이 끼어 압착사고발생', TRUE, 29),
  ('중량물/장비하차', '중량물/장비를 차량에 적재시 허리 요통 발생', TRUE, 30),
  ('중량물/장비하차', '중량물 차량 하차시 손/발이 끼어 압착사고발생', TRUE, 31)
) AS v(gubun, hazard, default_present, sort_order)
WHERE c.doc_no = 'DS-003';

-- ================ DS-004 로프교체 (43건) ================
INSERT INTO public.risk_categories (name, doc_no, sub_process, sort_order, active)
VALUES ('로프교체', 'DS-004', '중량물/장비차량적재 | 중량물/장비이동 | PIT 파이프고임작업 | 카 양중작업 | 로프철거작업(PIT) | 로프철거작업(카상부) | 로프걸기작업(카상부) | 로프걸기작업(기계실) | 로프걸기작업(PIT) | 카양중제거작업(카상부) | 카양중제거작업(PIT) | 페 로프 운반작업 | 철거중량물/장비이동 | 중량물/장비하차', 4, TRUE)
ON CONFLICT (doc_no) DO UPDATE SET
  name        = EXCLUDED.name,
  sub_process = EXCLUDED.sub_process,
  sort_order  = EXCLUDED.sort_order,
  active      = EXCLUDED.active;

DELETE FROM public.risk_hazard_items
 WHERE category_id = (SELECT id FROM public.risk_categories WHERE doc_no = 'DS-004');

INSERT INTO public.risk_hazard_items (category_id, gubun, hazard, default_present, sort_order)
SELECT c.id, v.gubun, v.hazard, v.default_present, v.sort_order
FROM public.risk_categories c,
(VALUES
  ('중량물/장비차량적재', '중량물/장비를 차량에 적재시 허리 요통 발생', TRUE, 1),
  ('중량물/장비차량적재', '중량물 차량에 적재시 손/발이 끼어 압착사고발생', TRUE, 2),
  ('중량물/장비이동', '전도 및 낙하로 인한 발/손가락이 끼어 압착사고발생', TRUE, 3),
  ('PIT 파이프고임작업', '파이프를 PIT로 운반시 파이프 낙하로 인한 손/발의 압착사고발생', TRUE, 4),
  ('PIT 파이프고임작업', '안전라인(JUMPER) 미제거로 인하여 카상부 진입 시 압착사고 발생', TRUE, 5),
  ('PIT 파이프고임작업', '도어 판넬의 날카로운 절단면에 손바닥이 찢어짐 사고발생', TRUE, 6),
  ('PIT 파이프고임작업', '작업완료후 승강장으로 나갈경우 도어를 개방하려다 추락사고발생', TRUE, 7),
  ('카 양중작업', '체인블록을 카 상부 운반시 허리 통증 발생됨', TRUE, 8),
  ('카 양중작업', '체인블록을 체인다이스키에 체결시 낙하로 인한 압착사고발생', TRUE, 9),
  ('로프철거작업(PIT)', '카운터측 샤클로드의 너트 풀림작업 시 추락사고발생', TRUE, 10),
  ('로프철거작업(PIT)', '카 상부 및 기계실 작업으로 공구등의 낙하로 인한 사고발생', TRUE, 11),
  ('로프철거작업(PIT)', '출입문 도어의 열림으로 인하여 이용자 추락위험발생', TRUE, 12),
  ('로프철거작업(카상부)', '카측 샤클로드 너트 풀림작업 시 체대에 충돌사고발생', FALSE, 13),
  ('로프철거작업(카상부)', '기계실 작업으로 인한 공구등의 낙하로 인한 사고발생', TRUE, 14),
  ('로프철거작업(카상부)', '승강로로 작업자의 추락사고 위험발생', TRUE, 15),
  ('로프철거작업(카상부)', '조속기 캣치시 손 끼임등의 압착사고 발생', FALSE, 16),
  ('로프걸기작업(카상부)', '로프에 샤클로드에 끼임작업 시 발등에 망치로 인한 충돌사고발생', FALSE, 17),
  ('로프걸기작업(카상부)', '로프의 연결부에 가열된 납을 부을 시 이상온도 접촉으로 인한 사고발생', FALSE, 18),
  ('로프걸기작업(카상부)', '카측 샤클로드 체결시 체대에 충돌사고발생', FALSE, 19),
  ('로프걸기작업(카상부)', '승강로로 작업자의 추락사고 위험발생', TRUE, 20),
  ('로프걸기작업(기계실)', '로프에 끼임으로 인한 압착사고발생', FALSE, 21),
  ('로프걸기작업(기계실)', '기계대에 충돌 위험발생', FALSE, 22),
  ('로프걸기작업(PIT)', '카 상부 및 기계실 작업으로 공구등의 낙하로 인한 사고발생', TRUE, 23),
  ('로프걸기작업(PIT)', '출입문 도어의 열림으로 인하여 이용자 추락위험발생', TRUE, 24),
  ('로프걸기작업(PIT)', '로프에 샤클로드에 끼임작업 시 발등에 망치로 인한 충돌사고발생', TRUE, 25),
  ('로프걸기작업(PIT)', '로프의 연결부에 가열된 납을 부을 시 이상온도 접촉으로 인한 사고발생', FALSE, 26),
  ('로프걸기작업(PIT)', '카운터측 샤클로드의 체결작업 시 추락사고발생', TRUE, 27),
  ('카양중제거작업(카상부)', '체인블록을 체인다이스키에 체결시 낙하로 인한 압착사고발생', TRUE, 28),
  ('카양중제거작업(카상부)', '체인블록을 카 상부에서 승강장으로 운반시 허리 통증 발생됨', TRUE, 29),
  ('카양중제거작업(카상부)', '로프 체결시 머리등의 충돌로 인한 사고 발생', FALSE, 30),
  ('카양중제거작업(PIT)', '안전라인(JUMPER) 미제거로 인하여 카상부 진입 시 압착사고 발생', TRUE, 31),
  ('카양중제거작업(PIT)', '도어 판넬의 날카로운 절단면에 손바닥이 찢어짐 사고발생', TRUE, 32),
  ('카양중제거작업(PIT)', '작업완료후 승강장으로 나갈경우 도어를 개방하려다 추락사고발생', TRUE, 33),
  ('카양중제거작업(PIT)', 'PIT에서 파이프가 옆으로 넘어짐으로 인한 도괴사고발생', FALSE, 34),
  ('페 로프 운반작업', '폐로프 철거자재 운반시 허리 통증 발생', TRUE, 35),
  ('페 로프 운반작업', '폐로프 이동대차에서 하차시 손/발이 끼어 압착사고발생', TRUE, 36),
  ('페 로프 운반작업', '폐로프 차량 적재시 허리 통증 발생', TRUE, 37),
  ('페 로프 운반작업', '폐로프 차량 적재시 낙하로 인한 손/발등의 압착사고발생', TRUE, 38),
  ('철거중량물/장비이동', '전도 및 낙하로 인한 발/손가락 압착사고발생', TRUE, 39),
  ('중량물/장비차량적재', '중량물/장비를 차량에 적재시 허리 요통 발생', TRUE, 40),
  ('중량물/장비차량적재', '중량물 차량에 적재시 손/발이 끼어 압착사고발생', TRUE, 41),
  ('중량물/장비하차', '중량물/장비를 차량에 적재시 허리 요통 발생', TRUE, 42),
  ('중량물/장비하차', '중량물 차량에 적재시 손/발이 끼어 압착사고발생', TRUE, 43)
) AS v(gubun, hazard, default_present, sort_order)
WHERE c.doc_no = 'DS-004';

-- ================ DS-005 MOTOR교체 (28건) ================
INSERT INTO public.risk_categories (name, doc_no, sub_process, sort_order, active)
VALUES ('MOTOR교체', 'DS-005', '중량물/장비차량적재 | 중량물/장비이동 | 파이프고임작업 | 카 양중작업 | Main Rope제거작업 | 모터 분해작업 | 커플링 분해/조립작업 | 모터조립작업 | 모터운반 | 철거중량물/장비이동 | 중량물/장비하차', 5, TRUE)
ON CONFLICT (doc_no) DO UPDATE SET
  name        = EXCLUDED.name,
  sub_process = EXCLUDED.sub_process,
  sort_order  = EXCLUDED.sort_order,
  active      = EXCLUDED.active;

DELETE FROM public.risk_hazard_items
 WHERE category_id = (SELECT id FROM public.risk_categories WHERE doc_no = 'DS-005');

INSERT INTO public.risk_hazard_items (category_id, gubun, hazard, default_present, sort_order)
SELECT c.id, v.gubun, v.hazard, v.default_present, v.sort_order
FROM public.risk_categories c,
(VALUES
  ('중량물/장비차량적재', '중량물/장비를 차량에 적재시 허리 요통 발생', TRUE, 1),
  ('중량물/장비차량적재', '중량물 차량에 적재시 손/발이 끼어 압착사고발생', TRUE, 2),
  ('중량물/장비이동', '모터 양중작업시 무리한 동작으로 허리 통증 발생', TRUE, 3),
  ('중량물/장비이동', '모터 기계실 양중작업 시 전도 및 낙하로 신체 압착사고발생', TRUE, 4),
  ('파이프고임작업', '파이프를 PIT로 운반시 파이프 낙하로 인한 손/발의 압착사고발생', TRUE, 5),
  ('파이프고임작업', '안전라인(JUMPER) 미제거로 인하여 카상부 진입 시 압착사고 발생', TRUE, 6),
  ('파이프고임작업', '도어 판넬의 날카로운 절단면에 손바닥이 찢어짐 사고발생', TRUE, 7),
  ('파이프고임작업', '작업완료후 승강장으로 나갈경우 도어를 개방하려다 추락사고발생', TRUE, 8),
  ('카 양중작업', '체인블록을 카 상부 운반시 허리 통증 발생됨', TRUE, 9),
  ('카 양중작업', '체인블록을 체인다이스키에 체결시 낙하로 인한 압착사고발생', TRUE, 10),
  ('카 양중작업', '승강로로 작업자의 추락사고 위험발생', TRUE, 11),
  ('Main Rope제거작업', '로프 제거시 손가락 끼임으로 인한 압착사고 발생', TRUE, 12),
  ('Main Rope제거작업', '조속기 캣치시 손 끼임등의 압착사고 발생', FALSE, 13),
  ('모터 분해작업', '커플링 분해 시 손가락 끼임사고발생', FALSE, 14),
  ('모터 분해작업', '모터 분해시 양중기가 기울러져 넘어짐으로 인한 도괴/낙하사고 발생', TRUE, 15),
  ('모터 분해작업', '모터 베어링 교체작업시 베어링 파편에 의한 사고발생 위험', TRUE, 16),
  ('모터 분해작업', '모터를 분해후 양중시 체인블록의 체인 파단으로 인한 낙하사고발생', TRUE, 17),
  ('커플링 분해/조립작업', '분해된 모터에 지그를 사용하여 커플링 분해시 손/발의 압착사고 위험', FALSE, 18),
  ('커플링 분해/조립작업', '모터에 가열된 커플링을 조립하기 위해 이상온도 접촉에 의한 위험발생', FALSE, 19),
  ('모터조립작업', '양중기 기울어져 넘어짐으로 인한 도괴/낙하사고 발생', TRUE, 20),
  ('모터조립작업', '체인블록의 체인 파단으로 인한 낙하사고발생', TRUE, 21),
  ('모터운반', '모터 양중작업시 무리한 동작으로 허리 통증 발생', TRUE, 22),
  ('모터운반', '모터 하향 양중작업 시 전도 및 낙하로 신체 압착사고발생', TRUE, 23),
  ('철거중량물/장비이동', '전도 및 낙하로 인한 발/손가락 압착사고발생', TRUE, 24),
  ('중량물/장비차량적재', '중량물/장비를 차량에 적재시 허리 요통 발생', TRUE, 25),
  ('중량물/장비차량적재', '중량물 차량에 적재시 손/발이 끼어 압착사고발생', TRUE, 26),
  ('중량물/장비하차', '중량물/장비를 차량에 적재시 허리 요통 발생', TRUE, 27),
  ('중량물/장비하차', '중량물 차량에 적재시 손/발이 끼어 압착사고발생', TRUE, 28)
) AS v(gubun, hazard, default_present, sort_order)
WHERE c.doc_no = 'DS-005';

-- ================ DS-006 조속기교체 (14건) ================
INSERT INTO public.risk_categories (name, doc_no, sub_process, sort_order, active)
VALUES ('조속기교체', 'DS-006', '부품/공구현장이동 | 이동 통로 | 기계실조명상태 | 카상부 작업 | 조속기 교체작업 | 부품/공구차량이동', 6, TRUE)
ON CONFLICT (doc_no) DO UPDATE SET
  name        = EXCLUDED.name,
  sub_process = EXCLUDED.sub_process,
  sort_order  = EXCLUDED.sort_order,
  active      = EXCLUDED.active;

DELETE FROM public.risk_hazard_items
 WHERE category_id = (SELECT id FROM public.risk_categories WHERE doc_no = 'DS-006');

INSERT INTO public.risk_hazard_items (category_id, gubun, hazard, default_present, sort_order)
SELECT c.id, v.gubun, v.hazard, v.default_present, v.sort_order
FROM public.risk_categories c,
(VALUES
  ('부품/공구현장이동', '계단에서 미끄러짐등으로 인한 전도사고발생', FALSE, 1),
  ('이동 통로', '기계실로의 이동 통로에 장애물 및 어두움으로 전도/충돌 사고 발생', FALSE, 2),
  ('기계실조명상태', '기계실 내에서 조명의 미점등으로 인해 전도/충돌 위험 발생', FALSE, 3),
  ('카상부 작업', '천정이나 체대의 오일로 인한 전도사고발생', FALSE, 4),
  ('카상부 작업', '안전라인(JUMPER) 미제거로 인하여 카상부 진입 시 압착사고 발생', TRUE, 5),
  ('카상부 작업', '조속기 로프 연결부위 분해작업 시 충돌위험발생', FALSE, 6),
  ('카상부 작업', '기계실 작업자의 공구등의 낙하물에 의한 사고 위헙발생', TRUE, 7),
  ('카상부 작업', '승강로로 작업자의 추락사고 위험발생', TRUE, 8),
  ('조속기 교체작업', '조속기의 회전체에 의한 손 등이 압착 위험', TRUE, 9),
  ('조속기 교체작업', '바닥 몰타르 제거시 이물질의 비산으로 눈에 튀어들어가는 위험발생', TRUE, 10),
  ('조속기 교체작업', '조속기 로프 걸기작업시 조속기에 압착사고위험발생', FALSE, 11),
  ('조속기 교체작업', '카 상부 조속기 로프 연결부위 체결작업 시 충돌위험발생', FALSE, 12),
  ('부품/공구차량이동', '계단에서 미끄러짐등으로 인한 전도사고발생', FALSE, 13),
  ('부품/공구차량이동', '조속기의 회전체에 의한 손 등이 협착 위험', TRUE, 14)
) AS v(gubun, hazard, default_present, sort_order)
WHERE c.doc_no = 'DS-006';

-- ================ DS-007 로프브레이크 (15건) ================
INSERT INTO public.risk_categories (name, doc_no, sub_process, sort_order, active)
VALUES ('로프브레이크', 'DS-007', '부품/공구 현장이동 | 이동 통로 | 기계실조명상태 | 로프브레이크 철거 | 로프브레이크 설치 | 중량물 운반', 7, TRUE)
ON CONFLICT (doc_no) DO UPDATE SET
  name        = EXCLUDED.name,
  sub_process = EXCLUDED.sub_process,
  sort_order  = EXCLUDED.sort_order,
  active      = EXCLUDED.active;

DELETE FROM public.risk_hazard_items
 WHERE category_id = (SELECT id FROM public.risk_categories WHERE doc_no = 'DS-007');

INSERT INTO public.risk_hazard_items (category_id, gubun, hazard, default_present, sort_order)
SELECT c.id, v.gubun, v.hazard, v.default_present, v.sort_order
FROM public.risk_categories c,
(VALUES
  ('부품/공구 현장이동', '계단에서 미끄러짐등으로 인한 전도사고발생', FALSE, 1),
  ('부품/공구 현장이동', '중량물 운반시 무리한 동작으로 허리 요통발생', TRUE, 2),
  ('부품/공구 현장이동', '중량물 낙하로 인한 발/손 등의 압착사고 위험', TRUE, 3),
  ('이동 통로', '기계실로의 이동 통로에 장애물 및 어두움으로 전도/충돌 사고 발생', FALSE, 4),
  ('기계실조명상태', '기계실 내에서 조명의 미점등으로 인해 전도/충돌 위험 발생', TRUE, 5),
  ('로프브레이크 철거', '메인전원을 OFF시 스파크로 인한 눈의 손상위험', FALSE, 6),
  ('로프브레이크 철거', '로프브레이크 철거시 압착사고 위험발생', TRUE, 7),
  ('로프브레이크 철거', '철거 부품 이동시 중량물 및 자세 부주의로 인한 허리 통증발생', TRUE, 8),
  ('로프브레이크 설치', '부품 설치시 중량물 및 자세 부주의로 인한 허리 통증발생', TRUE, 9),
  ('로프브레이크 설치', '로프브레이크 설치시 손 등의 압착사고 위험발생', TRUE, 10),
  ('로프브레이크 설치', '로프 브레이크 기계대 볼트 체결시 기계대에 충돌 위험', FALSE, 11),
  ('로프브레이크 설치', '전원 연결부위의 감전사고 위험', FALSE, 12),
  ('중량물 운반', '계단에서 미끄러짐등으로 인한 전도사고발생', FALSE, 13),
  ('중량물 운반', '중량물 운반시 무리한 동작으로 허리 요통발생', TRUE, 14),
  ('중량물 운반', '중량물 낙하로 인한 발/손 등의 압착사고 위험', TRUE, 15)
) AS v(gubun, hazard, default_present, sort_order)
WHERE c.doc_no = 'DS-007';

-- ================ DS-008 보조브레이크 (11건) ================
INSERT INTO public.risk_categories (name, doc_no, sub_process, sort_order, active)
VALUES ('보조브레이크', 'DS-008', '자재운반 및 적재 | 작업준비 | 스텝 제거 | 기계실 작업 | 브레이크 교체 | 보조브레이크 설치 | 시운전 | 스텝 조립', 8, TRUE)
ON CONFLICT (doc_no) DO UPDATE SET
  name        = EXCLUDED.name,
  sub_process = EXCLUDED.sub_process,
  sort_order  = EXCLUDED.sort_order,
  active      = EXCLUDED.active;

DELETE FROM public.risk_hazard_items
 WHERE category_id = (SELECT id FROM public.risk_categories WHERE doc_no = 'DS-008');

INSERT INTO public.risk_hazard_items (category_id, gubun, hazard, default_present, sort_order)
SELECT c.id, v.gubun, v.hazard, v.default_present, v.sort_order
FROM public.risk_categories c,
(VALUES
  ('자재운반 및 적재', '작업현장 이동 통로에 장애물 및 어두움으로 전도/충돌 사고', TRUE, 1),
  ('작업준비', '출입구 주변 및 작업 공간의 외부인 접근 가능성,', TRUE, 2),
  ('작업준비', '상부/하부 기계실 발판 제거시 협착 사고 위험', TRUE, 3),
  ('스텝 제거', '작업 공간 확보를 위한 스텝 제거시 협착 사고 위험', TRUE, 4),
  ('스텝 제거', '철거 부품 이동시 자세 부주의로 인한 허리 통증', TRUE, 5),
  ('기계실 작업', '전원 연결부위의 감전사고 위험', TRUE, 6),
  ('브레이크 교체', '부품 설치시 협소한 장소로 인한허리 통증', TRUE, 7),
  ('브레이크 교체', '부품 설치시 손 등의 압착사고 위험', TRUE, 8),
  ('보조브레이크 설치', '부품 설치시 협소한 장소로 인한허리 통증', TRUE, 9),
  ('시운전', '개구부 전도 및 끼임사고 위험', TRUE, 10),
  ('스텝 조립', '부품 이동시 자세 부주의로 인한 허리 통증발생', TRUE, 11)
) AS v(gubun, hazard, default_present, sort_order)
WHERE c.doc_no = 'DS-008';

COMMIT;

-- 검증
SELECT c.doc_no, c.name, c.sort_order, COUNT(i.id)::int AS 항목수,
       COUNT(*) FILTER (WHERE i.default_present) AS 유표시
FROM public.risk_categories c
LEFT JOIN public.risk_hazard_items i ON i.category_id = c.id
WHERE c.doc_no BETWEEN 'DS-003' AND 'DS-008'
GROUP BY c.doc_no, c.name, c.sort_order
ORDER BY c.sort_order;
