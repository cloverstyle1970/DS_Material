-- ─────────────────────────────────────────────────────────────────────
-- public 스키마의 모든 자동채번(SERIAL / IDENTITY) 시퀀스를 일괄 동기화.
-- 시드 데이터를 id 명시해 import 한 뒤 시퀀스가 뒤처져
-- "duplicate key value violates unique constraint" 에러가 발생할 때 사용한다.
--
-- 동작:
--   1. public 스키마의 테이블 중 시퀀스가 연결된 컬럼을 모두 탐색
--   2. 각 테이블의 MAX(컬럼) 값을 조회
--   3. setval(시퀀스, MAX+1, false) — 다음 nextval이 정확히 MAX+1을 반환
--   4. RAISE NOTICE로 동기화된 시퀀스를 로그 출력
--
-- 안전성:
--   · 빈 테이블도 처리 (MAX null → 1로 시작)
--   · 시퀀스가 없는 컬럼은 건너뜀
--   · 데이터 변경 없음 — 시퀀스 카운터만 조정
--   · 반복 실행해도 동일한 결과 (idempotent)
--
-- 실행 방법:
--   Supabase 대시보드 > SQL Editor > 본 파일 내용 붙여넣고 Run
-- ─────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r        RECORD;
  max_val  BIGINT;
  next_val BIGINT;
BEGIN
  FOR r IN
    SELECT
      n.nspname            AS schema_name,
      c.relname            AS table_name,
      a.attname            AS column_name,
      pg_get_serial_sequence(
        format('%I.%I', n.nspname, c.relname),
        a.attname
      )                    AS seq_name
    FROM pg_class       c
    JOIN pg_namespace   n ON n.oid       = c.relnamespace
    JOIN pg_attribute   a ON a.attrelid  = c.oid
                          AND a.attnum   > 0
                          AND NOT a.attisdropped
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND pg_get_serial_sequence(
            format('%I.%I', n.nspname, c.relname),
            a.attname
          ) IS NOT NULL
    ORDER BY c.relname, a.attname
  LOOP
    EXECUTE format(
      'SELECT COALESCE(MAX(%I), 0) FROM %I.%I',
      r.column_name, r.schema_name, r.table_name
    ) INTO max_val;

    next_val := max_val + 1;
    PERFORM setval(r.seq_name, next_val, false);

    RAISE NOTICE '  %.% (seq: %) → next = %',
      r.table_name, r.column_name, r.seq_name, next_val;
  END LOOP;
END $$;
