-- ============================================================
-- 근무복·안전장구 신청용 분류 시드
-- ------------------------------------------------------------
-- 대분류 99(범용) / 중분류 02(근무복) / 03(안전장구)
-- 소분류 99·02·01~ : 상의·하의 등 (필요한 만큼 추가)
-- 소분류 99·03·01~ : 안전모·안전벨트 등 (필요한 만큼 추가)
-- ON CONFLICT DO NOTHING — 이미 있으면 그대로 유지
-- ============================================================

-- 대분류 99
INSERT INTO categories (level, code, label, major_code, mid_code)
VALUES ('major', '99', '범용', NULL, NULL)
ON CONFLICT DO NOTHING;

-- 중분류
INSERT INTO categories (level, code, label, major_code, mid_code) VALUES
  ('mid', '02', '근무복',     '99', NULL),
  ('mid', '03', '개인안전장구', '99', NULL)
ON CONFLICT DO NOTHING;

-- 근무복(99·02) 소분류 — 필요한 항목만 남기거나 추가
INSERT INTO categories (level, code, label, major_code, mid_code) VALUES
  ('sub', '01', '하계 상의',  '99', '02'),
  ('sub', '02', '하계 하의',  '99', '02'),
  ('sub', '03', '동계 상의',  '99', '02'),
  ('sub', '04', '동계 하의',  '99', '02'),
  ('sub', '05', '춘추 점퍼',  '99', '02')
ON CONFLICT DO NOTHING;

-- 안전장구(99·03) 소분류 — 필요한 항목만 남기거나 추가
INSERT INTO categories (level, code, label, major_code, mid_code) VALUES
  ('sub', '01', '안전화',    '99', '03'),
  ('sub', '02', '안전모',    '99', '03'),
  ('sub', '03', '안전벨트',  '99', '03'),
  ('sub', '04', '장갑류',    '99', '03'),
  ('sub', '05', '보안경',    '99', '03'),
  ('sub', '06', '귀마개',    '99', '03')
ON CONFLICT DO NOTHING;

-- 검증
SELECT level, code, label, major_code, mid_code
FROM categories
WHERE major_code = '99' OR (level = 'major' AND code = '99')
ORDER BY level, major_code NULLS FIRST, mid_code NULLS FIRST, code;
