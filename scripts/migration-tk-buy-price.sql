-- TK 자재 구매단가 = 판매단가의 80% (원 단위 반올림) 일괄 적용
-- 대상: 자재코드가 'D'로 시작하지 않는 TK 자재 중 판매단가가 있는 행
-- 화면(신규등록·수정·엑셀 일괄등록)은 tkBuyPrice()로 동일 규칙 자동 입력

-- 1) 변경 전 구매단가 백업 (최초 1회만 생성)
CREATE TABLE IF NOT EXISTS materials_tk_buy_price_backup AS
SELECT id, buy_price, sell_price, NOW() AS backed_up_at
FROM materials
WHERE id NOT LIKE 'D%' AND COALESCE(sell_price, 0) > 0;

ALTER TABLE materials_tk_buy_price_backup ENABLE ROW LEVEL SECURITY;

-- 2) 구매단가 80% 적용 (idempotent: 이미 같은 값이면 건너뜀)
UPDATE materials
SET buy_price = ROUND(sell_price * 0.8)
WHERE id NOT LIKE 'D%'
  AND COALESCE(sell_price, 0) > 0
  AND buy_price IS DISTINCT FROM ROUND(sell_price * 0.8);

-- 3) 검증: mismatch = 0 이어야 함
SELECT
  COUNT(*) FILTER (WHERE COALESCE(sell_price, 0) > 0)                                      AS tk_with_sell,
  COUNT(*) FILTER (WHERE COALESCE(sell_price, 0) > 0 AND buy_price = ROUND(sell_price * 0.8)) AS exact80,
  COUNT(*) FILTER (WHERE COALESCE(sell_price, 0) > 0 AND buy_price IS DISTINCT FROM ROUND(sell_price * 0.8)) AS mismatch
FROM materials
WHERE id NOT LIKE 'D%';
