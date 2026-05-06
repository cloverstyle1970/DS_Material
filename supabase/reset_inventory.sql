-- ============================================================
-- 재고/거래/신청 데이터 전체 초기화
-- ⚠️ 되돌릴 수 없음. 실행 전 Supabase Dashboard → Database → Backups 권장
-- ============================================================

BEGIN;

-- 1) S/N 단위 재고 (입고로 생성된 시리얼 인스턴스) 삭제
DELETE FROM material_units;

-- 2) 입고/출고 트랜잭션 전부 삭제
DELETE FROM transactions;

-- 3) 발주 내역 전부 삭제
DELETE FROM purchase_orders;

-- 4) 자재 신청 내역 전부 삭제
DELETE FROM material_requests;

-- 5) 모든 자재의 현재고를 0으로 초기화
UPDATE materials SET stock_qty = 0;

COMMIT;
