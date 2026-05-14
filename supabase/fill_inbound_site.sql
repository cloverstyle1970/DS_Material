-- ─────────────────────────────────────────────────────────────────────
-- 기존 입고 트랜잭션의 site_name / elevator_name 채우기.
--
-- 배경:
--   입고완료 처리 시 mock-router가 트랜잭션 siteName을 null로 저장하던
--   버그가 있었음. 발주 ↔ 입고 트랜잭션은 note 의 "발주 #ID 입고완료"
--   패턴으로 연결되어 있으므로, 그 ID 로 purchase_orders 를 조회해
--   site_name / elevator_name 을 역채움.
--
-- 동작:
--   1. transactions.type = '입고' 이면서 site_name 이 비어있는 행 선별
--   2. note 의 "^발주 #(\d+)" 패턴에서 발주 ID 추출
--   3. 같은 발주의 site_name / elevator_name 으로 업데이트
--
-- 안전성:
--   · 이미 site_name 이 채워진 행은 건드리지 않음 (WHERE 조건)
--   · note 패턴이 없는 입고(예: 수동 입력, 일괄 업로드 등)는 건너뜀
--   · 발주를 찾지 못하는 경우(po IS NULL) 도 변경 없음 (INNER JOIN 효과)
--   · 반복 실행해도 동일한 결과 (idempotent)
--
-- 실행 방법:
--   Supabase 대시보드 > SQL Editor > 본 파일 내용 붙여넣고 Run
-- ─────────────────────────────────────────────────────────────────────

UPDATE transactions t
SET    site_name     = po.site_name,
       elevator_name = po.elevator_name
FROM   purchase_orders po
WHERE  t.type      = '입고'
  AND  t.site_name IS NULL
  AND  t.note ~ '^발주 #\d+ 입고완료'
  AND  po.id = substring(t.note FROM '^발주 #(\d+)')::int;

-- 결과 확인 (선택):
--   SELECT count(*) AS still_null
--   FROM transactions
--   WHERE type = '입고' AND site_name IS NULL AND note ~ '^발주 #\d+ 입고완료';
