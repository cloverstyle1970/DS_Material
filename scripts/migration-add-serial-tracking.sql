-- S/N 단위 자재 인스턴스 추적 도입
--
-- 1) materials.track_serial 플래그 (default false). true면 S/N 추적 자재.
-- 2) material_units 테이블: track_serial=true 자재의 인스턴스 1행씩.
-- 3) transactions.material_unit_id FK: 추적 자재 트랜잭션에 unit 연결.
-- 4) add_transaction RPC 재작성: serial_nos 배열 받아서 unit 자동 생성/갱신.
-- 5) mark_return_completed: unit status='반납완료'로 동기 갱신.

-- ── 1) materials.track_serial ──────────────────────────────────────
ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS track_serial boolean DEFAULT false NOT NULL;

-- ── 2) material_units ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS material_units (
  id                 serial      PRIMARY KEY,
  material_id        text        NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  serial_no          text        NOT NULL,
  status             text        NOT NULL DEFAULT '재고',
  current_site       text,
  current_elevator   text,
  inbound_at         timestamptz NOT NULL DEFAULT now(),
  last_event_at      timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_units_serial_unique UNIQUE (material_id, serial_no),
  CONSTRAINT material_units_status_check
    CHECK (status IN ('재고', '출고', '반납대기', '반납완료', '폐기'))
);

CREATE INDEX IF NOT EXISTS idx_material_units_material_id ON material_units(material_id);
CREATE INDEX IF NOT EXISTS idx_material_units_serial_no   ON material_units(serial_no);
CREATE INDEX IF NOT EXISTS idx_material_units_status      ON material_units(status);

-- ── 3) transactions.material_unit_id ───────────────────────────────
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS material_unit_id integer
    REFERENCES material_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_material_unit_id ON transactions(material_unit_id);

-- ── 4) add_transaction RPC 재작성 ──────────────────────────────────
DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text);
DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text, text, text, boolean);
DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text, text, text[], boolean);

CREATE OR REPLACE FUNCTION add_transaction(
  p_type            text,
  p_material_id     text,
  p_material_name   text,
  p_qty             integer,
  p_site_name       text,
  p_note            text,
  p_user_id         integer,
  p_user_name       text,
  p_elevator_name   text DEFAULT NULL,
  p_serial_nos      text[] DEFAULT NULL,
  p_requires_return boolean DEFAULT false
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_track_serial   boolean;
  v_prev_stock     integer;
  v_running_stock  integer;
  v_local_prev     integer;
  v_unit_id        integer;
  v_serial         text;
  v_records        json[] := ARRAY[]::json[];
  v_record         record;
  v_return_status  text;
  v_serial_count   integer;
BEGIN
  -- 자재 정보
  SELECT stock_qty, track_serial INTO v_prev_stock, v_track_serial
  FROM materials WHERE id = p_material_id FOR UPDATE;

  IF v_prev_stock IS NULL THEN
    RETURN json_build_object('error', '자재를 찾을 수 없습니다.');
  END IF;

  v_serial_count  := COALESCE(array_length(p_serial_nos, 1), 0);
  v_return_status := CASE WHEN p_requires_return AND p_type = '출고' THEN 'pending' ELSE NULL END;

  -- ── 추적 자재: S/N 갯수 == 수량 검증 ─────────────────────────
  IF v_track_serial THEN
    IF v_serial_count <> p_qty THEN
      RETURN json_build_object('error', 'S/N 추적 자재는 수량(' || p_qty || ')만큼 시리얼 번호 입력 필요. 현재 ' || v_serial_count || '개');
    END IF;

    v_running_stock := v_prev_stock;

    FOREACH v_serial IN ARRAY p_serial_nos LOOP
      v_local_prev := v_running_stock;

      IF p_type = '입고' THEN
        -- 신규 unit 생성 (중복 S/N이면 unique 제약으로 에러)
        BEGIN
          INSERT INTO material_units (material_id, serial_no, status, inbound_at, last_event_at)
          VALUES (p_material_id, v_serial, '재고', now(), now())
          RETURNING id INTO v_unit_id;
        EXCEPTION WHEN unique_violation THEN
          RETURN json_build_object('error', '이미 등록된 S/N: ' || v_serial);
        END;

        v_running_stock := v_running_stock + 1;

      ELSIF p_type = '출고' THEN
        SELECT id INTO v_unit_id FROM material_units
         WHERE material_id = p_material_id AND serial_no = v_serial AND status = '재고'
         FOR UPDATE;

        IF v_unit_id IS NULL THEN
          RETURN json_build_object('error', 'S/N ' || v_serial || ' 가(이) 재고 상태 unit이 아닙니다.');
        END IF;

        UPDATE material_units
           SET status           = CASE WHEN p_requires_return THEN '반납대기' ELSE '출고' END,
               current_site     = p_site_name,
               current_elevator = p_elevator_name,
               last_event_at    = now()
         WHERE id = v_unit_id;

        v_running_stock := v_running_stock - 1;
      ELSE
        RETURN json_build_object('error', 'unsupported transaction type: ' || p_type);
      END IF;

      INSERT INTO transactions (
        type, material_id, material_name, qty, prev_stock, after_stock,
        site_name, note, user_id, user_name,
        elevator_name, serial_no, requires_return, return_status,
        material_unit_id
      ) VALUES (
        p_type, p_material_id, p_material_name, 1, v_local_prev, v_running_stock,
        p_site_name, p_note, p_user_id, p_user_name,
        p_elevator_name, v_serial, p_requires_return, v_return_status,
        v_unit_id
      ) RETURNING * INTO v_record;

      v_records := array_append(v_records, row_to_json(v_record)::json);
    END LOOP;

    UPDATE materials SET stock_qty = v_running_stock WHERE id = p_material_id;
    RETURN json_build_object('records', array_to_json(v_records));
  END IF;

  -- ── 비추적 자재: 단일 트랜잭션 ───────────────────────────────
  IF v_serial_count > 1 THEN
    RETURN json_build_object('error', '비추적 자재에는 S/N을 1개까지만 기록할 수 있습니다.');
  END IF;

  IF p_type = '입고' THEN
    v_running_stock := v_prev_stock + p_qty;
  ELSIF p_type = '출고' THEN
    v_running_stock := v_prev_stock - p_qty;
    IF v_running_stock < 0 THEN
      RETURN json_build_object('error', '재고 부족 (현재 재고: ' || v_prev_stock || ')');
    END IF;
  ELSE
    RETURN json_build_object('error', 'unsupported transaction type: ' || p_type);
  END IF;

  UPDATE materials SET stock_qty = v_running_stock WHERE id = p_material_id;

  INSERT INTO transactions (
    type, material_id, material_name, qty, prev_stock, after_stock,
    site_name, note, user_id, user_name,
    elevator_name, serial_no, requires_return, return_status,
    material_unit_id
  ) VALUES (
    p_type, p_material_id, p_material_name, p_qty, v_prev_stock, v_running_stock,
    p_site_name, p_note, p_user_id, p_user_name,
    p_elevator_name,
    CASE WHEN v_serial_count = 1 THEN p_serial_nos[1] ELSE NULL END,
    p_requires_return, v_return_status,
    NULL
  ) RETURNING * INTO v_record;

  RETURN json_build_object('records', json_build_array(row_to_json(v_record)));
END;
$$;

-- ── 5) mark_return_completed: unit 상태 동기화 ─────────────────────
CREATE OR REPLACE FUNCTION mark_return_completed(
  p_transaction_id integer,
  p_user_id        integer,
  p_user_name      text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_record  record;
  v_unit_id integer;
BEGIN
  UPDATE transactions
     SET return_status         = 'returned',
         returned_at           = now(),
         returned_by_user_id   = p_user_id,
         returned_by_user_name = p_user_name
   WHERE id              = p_transaction_id
     AND requires_return = true
     AND return_status   = 'pending'
   RETURNING *, material_unit_id INTO v_record, v_unit_id;

  IF v_record.id IS NULL THEN
    RETURN json_build_object('error', '대상 트랜잭션을 찾을 수 없거나 이미 반납 처리됨');
  END IF;

  -- 추적 자재면 unit 상태도 반납완료로
  IF v_unit_id IS NOT NULL THEN
    UPDATE material_units
       SET status        = '반납완료',
           last_event_at = now()
     WHERE id = v_unit_id;
  END IF;

  RETURN json_build_object('record', row_to_json(v_record));
END;
$$;

-- 확인
SELECT 'materials.track_serial' AS check, count(*) AS rows
FROM information_schema.columns
WHERE table_name = 'materials' AND column_name = 'track_serial'
UNION ALL
SELECT 'material_units 테이블', count(*) FROM information_schema.tables WHERE table_name = 'material_units'
UNION ALL
SELECT 'transactions.material_unit_id', count(*) FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'material_unit_id';
