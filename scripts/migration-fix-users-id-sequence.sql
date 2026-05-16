-- ============================================================
-- users.id 자동 채번 복구
-- ------------------------------------------------------------
-- 증상: INSERT INTO users(...) 실행 시
--   "null value in column \"id\" of relation \"users\" violates not-null constraint"
-- 원인: users.id 컬럼에 SERIAL/IDENTITY 시퀀스가 연결돼 있지 않음
-- 처리: users_id_seq 시퀀스를 만들고 DEFAULT nextval(...)로 연결,
--       기존 MAX(id)+1 부터 채번하도록 setval로 동기화
-- 안전성: 시퀀스가 이미 있으면 건너뜀 (DO 블록 내 IF 체크)
-- ============================================================

DO $$
DECLARE
  has_seq      BOOLEAN;
  has_default  BOOLEAN;
  cur_max      BIGINT;
BEGIN
  -- 1) users.id 에 연결된 시퀀스가 이미 있는지 확인
  has_seq := pg_get_serial_sequence('public.users', 'id') IS NOT NULL;

  -- 2) DEFAULT 절이 설정돼 있는지 확인
  SELECT (column_default IS NOT NULL) INTO has_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='users' AND column_name='id';

  IF has_seq AND has_default THEN
    RAISE NOTICE '✅ users.id 에 이미 시퀀스(%)와 DEFAULT가 연결돼 있습니다.',
      pg_get_serial_sequence('public.users', 'id');
  ELSE
    -- 3) 시퀀스 생성 (이미 있으면 IF NOT EXISTS로 무시)
    CREATE SEQUENCE IF NOT EXISTS users_id_seq;

    -- 4) 시퀀스 소유권 → users.id (DROP COLUMN 시 자동 삭제)
    ALTER SEQUENCE users_id_seq OWNED BY public.users.id;

    -- 5) DEFAULT nextval 연결
    ALTER TABLE public.users
      ALTER COLUMN id SET DEFAULT nextval('users_id_seq');

    -- 6) 기존 MAX(id) + 1 로 시퀀스 동기화 (다음 INSERT 시 충돌 방지)
    SELECT COALESCE(MAX(id), 0) INTO cur_max FROM public.users;
    PERFORM setval('users_id_seq', cur_max + 1, false);

    RAISE NOTICE '🛠️  users_id_seq 생성·연결 완료. 다음 id = %', cur_max + 1;
  END IF;
END $$;

-- ============================================================
-- 검증
-- ============================================================
SELECT
  column_name,
  data_type,
  column_default,
  pg_get_serial_sequence('public.users', column_name) AS sequence
FROM information_schema.columns
WHERE table_schema='public' AND table_name='users' AND column_name='id';

-- 시퀀스 현재값
SELECT 'users_id_seq next value' AS chk, last_value, is_called
FROM users_id_seq;
