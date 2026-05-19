-- 출고 트랜잭션의 S/N 수정 시 material_units 와 transactions 를 원자적으로 동기화
--
-- 클라이언트(mock-router)에서 여러 UPDATE 를 순차 호출하면 동시성·중간 실패 시
-- unit 상태가 어긋날 수 있어, 한 RPC 안에서 FOR UPDATE 잠금으로 처리한다.
--
-- 호출: rpc('edit_transaction_serial', { p_transaction_id, p_new_serial })
--   - p_new_serial = NULL  → 비추적 자재일 때만 허용 (S/N 텍스트 제거)
--   - 출고 트랜잭션이 아니면 거부
--   - return_status='returned' 이면 거부 (이력 무결성)
--   - 추적 자재(materials.track_serial=true):
--       · 새 S/N 이 material_units 에 없으면 거부
--       · 새 unit 이 다른 트랜잭션에서 사용 중(status<>'재고')이면 거부
--       · 새 unit → 출고/반납대기, 기존 unit → 재고 복원, tx.material_unit_id 갱신
--   - 비추적 자재: transactions.serial_no 텍스트만 갱신
--
-- 반환 JSON: { record: <updated transaction row> }  또는  { error: <message> }
-- Supabase Dashboard > SQL Editor 1회 실행 (idempotent: CREATE OR REPLACE)

CREATE OR REPLACE FUNCTION edit_transaction_serial(
  p_transaction_id integer,
  p_new_serial     text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx             record;
  v_track_serial   boolean;
  v_old_unit_id    integer;
  v_new_unit_id    integer;
  v_new_unit_stat  text;
  v_new_status     text;
  v_normalized     text;
BEGIN
  -- 입력 정규화 (공백 trim, 빈 문자열 → NULL)
  v_normalized := NULLIF(btrim(COALESCE(p_new_serial, '')), '');

  -- 1) 트랜잭션 잠금 조회
  SELECT * INTO v_tx FROM transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_tx.id IS NULL THEN
    RETURN json_build_object('error', '트랜잭션을 찾을 수 없습니다.');
  END IF;

  -- 출고만 지원
  IF v_tx.type <> '출고' THEN
    RETURN json_build_object('error', 'S/N 동기 수정은 출고 트랜잭션에서만 지원합니다.');
  END IF;

  -- 이미 반납 처리된 트랜잭션은 수정 거부
  IF v_tx.return_status = 'returned' THEN
    RETURN json_build_object('error', '반납 완료된 출고 트랜잭션의 S/N은 수정할 수 없습니다.');
  END IF;

  -- 변경 없음
  IF v_tx.serial_no IS NOT DISTINCT FROM v_normalized THEN
    RETURN json_build_object('record', row_to_json(v_tx));
  END IF;

  -- 자재 추적 여부 조회
  SELECT track_serial INTO v_track_serial FROM materials WHERE id = v_tx.material_id;
  IF v_track_serial IS NULL THEN
    RETURN json_build_object('error', '자재를 찾을 수 없습니다.');
  END IF;

  v_old_unit_id := v_tx.material_unit_id;

  -- ── 비추적 자재: 텍스트만 갱신 ───────────────────────────────
  IF NOT v_track_serial THEN
    UPDATE transactions SET serial_no = v_normalized
     WHERE id = p_transaction_id
     RETURNING * INTO v_tx;
    RETURN json_build_object('record', row_to_json(v_tx));
  END IF;

  -- ── 추적 자재: unit 동기화 필요 ──────────────────────────────
  IF v_normalized IS NULL THEN
    RETURN json_build_object('error', 'S/N 추적 자재는 S/N을 비울 수 없습니다.');
  END IF;

  -- 새 unit 잠금 조회
  SELECT id, status INTO v_new_unit_id, v_new_unit_stat
    FROM material_units
   WHERE material_id = v_tx.material_id AND serial_no = v_normalized
   FOR UPDATE;

  IF v_new_unit_id IS NULL THEN
    RETURN json_build_object('error', 'S/N "' || v_normalized || '" 가(이) 자재단위에 등록되지 않았습니다.');
  END IF;

  -- 동일 unit 이면 status 재검사 불필요. 다른 unit 이면 반드시 '재고' 여야 함
  IF v_new_unit_id IS DISTINCT FROM v_old_unit_id AND v_new_unit_stat <> '재고' THEN
    RETURN json_build_object(
      'error',
      'S/N "' || v_normalized || '" 는 현재 ' || v_new_unit_stat || ' 상태라 출고로 사용할 수 없습니다.'
    );
  END IF;

  v_new_status := CASE WHEN v_tx.requires_return THEN '반납대기' ELSE '출고' END;

  -- 1) 새 unit → 출고/반납대기 (동일 unit 이면 사이트 정보만 갱신)
  UPDATE material_units
     SET status           = v_new_status,
         current_site     = v_tx.site_name,
         current_elevator = v_tx.elevator_name,
         last_event_at    = now()
   WHERE id = v_new_unit_id;

  -- 2) 기존 unit 이 있고 다른 unit 이면 → 재고 복원
  IF v_old_unit_id IS NOT NULL AND v_old_unit_id IS DISTINCT FROM v_new_unit_id THEN
    UPDATE material_units
       SET status           = '재고',
           current_site     = NULL,
           current_elevator = NULL,
           last_event_at    = now()
     WHERE id = v_old_unit_id;
  END IF;

  -- 3) 트랜잭션 갱신
  UPDATE transactions
     SET serial_no        = v_normalized,
         material_unit_id = v_new_unit_id
   WHERE id = p_transaction_id
   RETURNING * INTO v_tx;

  RETURN json_build_object('record', row_to_json(v_tx));
END;
$$;

-- ── 검증 ────────────────────────────────────────────────────────
SELECT
  routine_name,
  data_type AS return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'edit_transaction_serial';
