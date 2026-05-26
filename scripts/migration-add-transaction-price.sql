-- ============================================================
-- migration-add-transaction-price.sql
-- ============================================================
-- 입출고 전표 발생 당시의 자재 단가(unit_price) 기록 기능 도입
-- 1) transactions 테이블에 unit_price 컬럼 추가
-- 2) 기존 거래 데이터의 단가를 당사 자재마스터 기준(입고: buy_price, 출고: sell_price)으로 소급 반영
-- 3) add_transaction, mark_unused_return, scrap_material_unit RPC 함수 고도화

-- 1. unit_price 컬럼 추가
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS unit_price INTEGER DEFAULT 0;

-- 2. 기존 입출고 이력 데이터 단가 소급 보정
UPDATE public.transactions t
   SET unit_price = COALESCE(
       CASE WHEN t.type = '입고' THEN m.buy_price ELSE m.sell_price END, 
       0
   )
  FROM public.materials m
 WHERE t.material_id = m.id
   AND (t.unit_price IS NULL OR t.unit_price = 0);

-- 3. add_transaction RPC 함수 고도화 (단가 자동 기록)
DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text, text, text[], boolean, uuid);

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
  p_requires_return boolean DEFAULT false,
  p_batch_id        uuid DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_stock     integer;
  v_running_stock  integer;
  v_local_prev     integer;
  v_unit_id        integer;
  v_serial         text;
  v_records        json[] := ARRAY[]::json[];
  v_record         record;
  v_return_status  text;
  v_serial_count   integer;
  v_remaining      integer;
  v_unit_price     integer;
BEGIN
  -- 자재 재고 잠금 및 당시 단가(입고: buy_price, 출고: sell_price) 동시 조회
  SELECT stock_qty, CASE WHEN p_type = '입고' THEN buy_price ELSE sell_price END INTO v_prev_stock, v_unit_price
  FROM materials WHERE id = p_material_id FOR UPDATE;

  IF v_prev_stock IS NULL THEN
    RETURN json_build_object('error', '자재를 찾을 수 없습니다.');
  END IF;

  v_unit_price    := COALESCE(v_unit_price, 0);
  v_serial_count  := COALESCE(array_length(p_serial_nos, 1), 0);
  v_return_status := CASE WHEN p_requires_return AND p_type = '출고' THEN 'pending' ELSE NULL END;

  IF p_type NOT IN ('입고', '출고') THEN
    RETURN json_build_object('error', 'unsupported transaction type: ' || p_type);
  END IF;

  IF v_serial_count > p_qty THEN
    RETURN json_build_object('error', 'S/N 갯수(' || v_serial_count || ')가 수량(' || p_qty || ')보다 많습니다.');
  END IF;

  -- 출고 시 사전 재고 검증 (tracked + untracked 합산)
  IF p_type = '출고' AND v_prev_stock < p_qty THEN
    RETURN json_build_object('error', '재고 부족 (현재 재고: ' || v_prev_stock || ')');
  END IF;

  v_running_stock := v_prev_stock;

  -- ── (1) 추적분: S/N 1건당 unit + 트랜잭션 ────────────────────
  IF v_serial_count > 0 THEN
    FOREACH v_serial IN ARRAY p_serial_nos LOOP
      v_local_prev := v_running_stock;

      IF p_type = '입고' THEN
        BEGIN
          INSERT INTO material_units (material_id, serial_no, status, inbound_at, last_event_at)
          VALUES (p_material_id, v_serial, '재고', now(), now())
          RETURNING id INTO v_unit_id;
        EXCEPTION WHEN unique_violation THEN
          RETURN json_build_object('error', '이미 등록된 S/N: ' || v_serial);
        END;
        v_running_stock := v_running_stock + 1;

      ELSE -- 출고
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
      END IF;

      INSERT INTO transactions (
        type, material_id, material_name, qty, prev_stock, after_stock,
        site_name, note, user_id, user_name,
        elevator_name, serial_no, requires_return, return_status,
        material_unit_id, batch_id, unit_price
      ) VALUES (
        p_type, p_material_id, p_material_name, 1, v_local_prev, v_running_stock,
        p_site_name, p_note, p_user_id, p_user_name,
        p_elevator_name, v_serial, p_requires_return, v_return_status,
        v_unit_id, p_batch_id, v_unit_price
      ) RETURNING * INTO v_record;

      v_records := array_append(v_records, row_to_json(v_record)::json);
    END LOOP;
  END IF;

  -- ── (2) 잔여 비추적분: 단일 트랜잭션 ────────────────────────
  v_remaining := p_qty - v_serial_count;
  IF v_remaining > 0 THEN
    v_local_prev := v_running_stock;
    IF p_type = '입고' THEN
      v_running_stock := v_running_stock + v_remaining;
    ELSE
      v_running_stock := v_running_stock - v_remaining;
    END IF;

    INSERT INTO transactions (
      type, material_id, material_name, qty, prev_stock, after_stock,
      site_name, note, user_id, user_name,
      elevator_name, serial_no, requires_return, return_status,
      material_unit_id, batch_id, unit_price
    ) VALUES (
      p_type, p_material_id, p_material_name, v_remaining, v_local_prev, v_running_stock,
      p_site_name, p_note, p_user_id, p_user_name,
      p_elevator_name, NULL, p_requires_return, v_return_status,
      NULL, p_batch_id, v_unit_price
    ) RETURNING * INTO v_record;

    v_records := array_append(v_records, row_to_json(v_record)::json);
  END IF;

  UPDATE materials SET stock_qty = v_running_stock WHERE id = p_material_id;
  RETURN json_build_object('records', array_to_json(v_records));
END;
$$;


-- 4. mark_unused_return RPC 함수 고도화 (반납 입고 시 원출고 단가 상속)
CREATE OR REPLACE FUNCTION mark_unused_return(
  p_transaction_id integer,
  p_user_id        integer,
  p_user_name      text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx        record;
  v_new_stock integer;
BEGIN
  -- 대상 출고 트랜잭션 잠금
  SELECT * INTO v_tx
    FROM transactions
   WHERE id = p_transaction_id
   FOR UPDATE;

  IF v_tx.id IS NULL THEN
    RETURN json_build_object('error', '대상 트랜잭션을 찾을 수 없습니다.');
  END IF;
  IF v_tx.type <> '출고' THEN
    RETURN json_build_object('error', '출고 트랜잭션만 미사용 반납이 가능합니다.');
  END IF;
  IF v_tx.requires_return = true THEN
    RETURN json_build_object('error', '회수체크된 출고는 미사용 반납이 불가합니다 (폐자재회수 처리).');
  END IF;
  IF v_tx.return_status IS NOT NULL THEN
    RETURN json_build_object('error', '이미 반납 처리된 출고입니다.');
  END IF;

  -- 트랜잭션 상태 갱신
  UPDATE transactions
     SET return_status         = 'returned',
         return_type           = 'unused',
         returned_at           = now(),
         returned_by_user_id   = p_user_id,
         returned_by_user_name = p_user_name
    WHERE id = p_transaction_id;

  -- 재고 복원
  UPDATE materials
     SET stock_qty = stock_qty + v_tx.qty
   WHERE id = v_tx.material_id
   RETURNING stock_qty INTO v_new_stock;

  -- S/N 추적 자재: unit 상태 '재고'로 복원
  IF v_tx.material_unit_id IS NOT NULL THEN
    UPDATE material_units
       SET status           = '재고',
           current_site     = NULL,
           current_elevator = NULL,
           last_event_at    = now()
     WHERE id = v_tx.material_unit_id;
  END IF;

  -- 감사용 입고 트랜잭션 자동 생성 (원 출고 시점의 단가 unit_price 기입)
  INSERT INTO transactions (
    type, material_id, material_name, qty, prev_stock, after_stock,
    site_name, note, user_id, user_name,
    elevator_name, serial_no, requires_return, return_status, return_type,
    material_unit_id, unit_price
  ) VALUES (
    '입고', v_tx.material_id, v_tx.material_name, v_tx.qty,
    v_new_stock - v_tx.qty, v_new_stock,
    v_tx.site_name,
    '[미사용 반납 재입고] 원출고 #' || v_tx.id ||
      CASE WHEN v_tx.serial_no IS NOT NULL THEN ' / S/N ' || v_tx.serial_no ELSE '' END,
    p_user_id, p_user_name,
    v_tx.elevator_name, v_tx.serial_no, false, NULL, NULL,
    v_tx.material_unit_id, COALESCE(v_tx.unit_price, 0)
  );

  RETURN json_build_object('ok', true, 'restored_stock', v_new_stock);
END;
$$;


-- 5. scrap_material_unit RPC 함수 고도화 (실사 폐기 출고 시 당시 출고 단가 기록)
CREATE OR REPLACE FUNCTION scrap_material_unit(
  p_unit_id   integer,
  p_user_id   integer,
  p_user_name text,
  p_note      text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_unit         material_units%ROWTYPE;
  v_prev_stock   integer;
  v_after_stock  integer;
  v_material_name text;
  v_record       record;
  v_sell_price   integer;
BEGIN
  SELECT * INTO v_unit FROM material_units WHERE id = p_unit_id FOR UPDATE;
  IF v_unit.id IS NULL THEN
    RETURN json_build_object('error', 'unit을 찾을 수 없습니다.');
  END IF;

  IF v_unit.status <> '재고' THEN
    RETURN json_build_object('error', '재고 상태가 아닌 unit은 실사 폐기 불가 (현재: ' || v_unit.status || ')');
  END IF;

  -- 자재 재고 -1 및 당시 출고단가 조회
  SELECT stock_qty, name, sell_price INTO v_prev_stock, v_material_name, v_sell_price
  FROM materials WHERE id = v_unit.material_id FOR UPDATE;
  
  v_after_stock := v_prev_stock - 1;
  UPDATE materials SET stock_qty = v_after_stock WHERE id = v_unit.material_id;

  -- unit 상태 → 폐기
  UPDATE material_units
     SET status        = '폐기',
         last_event_at = now()
   WHERE id = p_unit_id;

  -- 출고 트랜잭션 기록 (단가 함께 기록)
  INSERT INTO transactions (
    type, material_id, material_name, qty, prev_stock, after_stock,
    site_name, note, user_id, user_name,
    elevator_name, serial_no, requires_return, return_status,
    material_unit_id, unit_price
  ) VALUES (
    '출고', v_unit.material_id, v_material_name, 1, v_prev_stock, v_after_stock,
    NULL, COALESCE(p_note, '재고실사 손실'), p_user_id, p_user_name,
    NULL, v_unit.serial_no, false, NULL,
    v_unit.id, COALESCE(v_sell_price, 0)
  ) RETURNING * INTO v_record;

  RETURN json_build_object('record', row_to_json(v_record));
END;
$$;
