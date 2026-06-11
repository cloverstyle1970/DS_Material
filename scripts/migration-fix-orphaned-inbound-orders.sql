SET client_encoding = 'UTF8';
-- ============================================================
-- migration-fix-orphaned-inbound-orders.sql
-- ============================================================
-- 입고 transaction이 존재하는데 purchase_orders.status='발주'로 남아 있는
-- "고아 발주"를 일괄 '입고완료'로 정정한다.
--
-- 배경:
-- - 과거 InboundEntry.save()가 발주 status를 갱신하지 않아 잔존 데이터가 다수.
-- - 신규 코드(21d922a, B 패치) 적용 이후엔 자동 갱신되지만 과거 데이터는 별도 보정 필요.
-- - OrderPopup 안전장치(A 패치)가 transactions 매칭으로 보호하지만,
--   원천 데이터 정리도 함께 해야 status 컬럼이 의미 있는 상태가 됨.
--
-- 매칭 규칙:
-- - transactions.type = '입고' AND note에 '발주 #N' 또는 '발주#N' 패턴이 들어 있는 경우,
--   N에 해당하는 purchase_orders 행이 status='발주' 라면 '입고완료'로 갱신.
-- - received_at은 매칭된 입고 transaction 중 가장 빠른 created_at으로 설정.
--
-- 멱등성: 이미 status='입고완료'인 row는 영향 없음.
-- ============================================================

-- 1) 보정 대상 미리 보기
WITH order_inbound AS (
  SELECT
    (regexp_match(t.note, '발주\s*#(\d+)'))[1]::int AS order_id,
    MIN(t.created_at) AS first_inbound_at
  FROM transactions t
  WHERE t.type = '입고'
    AND t.note ~ '발주\s*#\d+'
  GROUP BY order_id
)
SELECT po.id, po.material_name, po.qty, po.status, po.ordered_at, oi.first_inbound_at
FROM purchase_orders po
JOIN order_inbound oi ON oi.order_id = po.id
WHERE po.status = '발주'
ORDER BY po.ordered_at DESC;

-- 2) 실제 보정
WITH order_inbound AS (
  SELECT
    (regexp_match(t.note, '발주\s*#(\d+)'))[1]::int AS order_id,
    MIN(t.created_at) AS first_inbound_at
  FROM transactions t
  WHERE t.type = '입고'
    AND t.note ~ '발주\s*#\d+'
  GROUP BY order_id
)
UPDATE purchase_orders po
SET
  status      = '입고완료',
  received_at = oi.first_inbound_at
FROM order_inbound oi
WHERE po.id = oi.order_id
  AND po.status = '발주';

-- 3) 검증: 남아있는 잔존 데이터(있다면 추가 조사 필요)
WITH order_inbound AS (
  SELECT
    (regexp_match(t.note, '발주\s*#(\d+)'))[1]::int AS order_id
  FROM transactions t
  WHERE t.type = '입고'
    AND t.note ~ '발주\s*#\d+'
  GROUP BY order_id
)
SELECT COUNT(*) AS remaining_orphans
FROM purchase_orders po
JOIN order_inbound oi ON oi.order_id = po.id
WHERE po.status = '발주';
