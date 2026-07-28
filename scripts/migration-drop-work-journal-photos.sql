-- ============================================================
-- work_journal_photos 테이블 삭제
-- ------------------------------------------------------------
-- 작업일지 사진 기능 제거에 따라 테이블 통째 삭제. 데이터 0건이라 안전.
-- FK가 work_journals(id) ON DELETE CASCADE 로 걸려있어 부모 삭제 없이 자식만 DROP.
-- ============================================================

DROP TABLE IF EXISTS work_journal_photos CASCADE;

-- 검증
SELECT table_name
FROM information_schema.tables
WHERE table_name = 'work_journal_photos';
-- 예상 결과: 0행
