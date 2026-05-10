-- ============================================================
-- categories 테이블 정리
-- ------------------------------------------------------------
-- 1) level 컬럼에 줄바꿈/공백이 섞여 들어간 행 정리
-- 2) label 컬럼의 \r\n 및 연속 공백 정리
-- 3) 9902(근무복)에 잘못 등록된 안전벨트(code=08) 소분류 제거
--    — 안전벨트는 9903(안전용품)·03 에 이미 정상 등록되어 있음
-- ============================================================

-- 0) 사전 검증: 영향 받을 행을 미리 확인 (실행만 하면 결과 확인용)
SELECT '== BEFORE: level 깨진 행 ==' AS section;
SELECT level, code, label, major_code, mid_code
FROM categories
WHERE level ~ '\s';

SELECT '== BEFORE: label에 줄바꿈/연속공백 있는 행 ==' AS section;
SELECT level, code, label, major_code, mid_code
FROM categories
WHERE label ~ '\r|\n|\s\s+'
ORDER BY level, major_code NULLS FIRST, mid_code NULLS FIRST, code;

SELECT '== BEFORE: 9902에 잘못 등록된 안전벨트 ==' AS section;
SELECT level, code, label, major_code, mid_code
FROM categories
WHERE major_code = '99' AND mid_code = '02' AND code = '08';

-- ============================================================
-- 1) level 컬럼의 모든 공백·줄바꿈 제거
--    (예: 'mi\r\n  d' → 'mid', 'sub\r\n  ' → 'sub')
-- ============================================================
UPDATE categories
SET level = REGEXP_REPLACE(level, '\s', '', 'g')
WHERE level ~ '\s';

-- ============================================================
-- 2) label 컬럼: 연속된 공백·줄바꿈을 단일 공백으로,
--    양끝 공백 TRIM
--    (예: '카\r\n  조작반(COP)' → '카 조작반(COP)')
-- ============================================================
UPDATE categories
SET label = TRIM(REGEXP_REPLACE(label, '\s+', ' ', 'g'))
WHERE label ~ '\r|\n|\s\s+';

-- ============================================================
-- 3) 9902·08 안전벨트 중복 행 제거
--    안전벨트의 정식 위치는 9903·03
-- ============================================================
-- 먼저 해당 코드로 등록된 자재가 있는지 확인 (있으면 수동 마이그레이션 필요)
SELECT '== 자재 D990208XXXX 존재 여부 ==' AS section;
SELECT id, name FROM materials WHERE id LIKE 'D990208%';

-- 자재가 없을 때만 분류 삭제 (있다면 수동 처리 후 다시 실행)
DELETE FROM categories
WHERE level = 'sub'
  AND major_code = '99'
  AND mid_code = '02'
  AND code = '08'
  AND NOT EXISTS (SELECT 1 FROM materials WHERE id LIKE 'D990208%');

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 최종 검증
-- ============================================================
SELECT '== AFTER: level 깨진 행 (0이어야 함) ==' AS section;
SELECT COUNT(*) AS broken_level_rows FROM categories WHERE level ~ '\s';

SELECT '== AFTER: label에 줄바꿈 있는 행 (0이어야 함) ==' AS section;
SELECT COUNT(*) AS broken_label_rows FROM categories WHERE label ~ '\r|\n';

SELECT '== AFTER: 9902 소분류 (정리 후 6건 + 99 기타) ==' AS section;
SELECT level, code, label
FROM categories
WHERE major_code = '99' AND mid_code = '02' AND level = 'sub'
ORDER BY code;

SELECT '== AFTER: 9903 소분류 ==' AS section;
SELECT level, code, label
FROM categories
WHERE major_code = '99' AND mid_code = '03' AND level = 'sub'
ORDER BY code;
