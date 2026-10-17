-- ============================================================
-- 근태 종류 집계 분류에 '대체휴무(subst)' 추가
-- 휴가(off)와 별도 집계. 공제 방식은 같음 (근태현황 출근일수·주52시간 정규근무에서 공제 일수만큼 뺌)
-- ============================================================

ALTER TABLE attendance_status_types DROP CONSTRAINT IF EXISTS attendance_status_types_kind_chk;
ALTER TABLE attendance_status_types ADD CONSTRAINT attendance_status_types_kind_chk
  CHECK (kind IN ('leave','off','subst','absent','late','early','work','extra','etc'));

INSERT INTO attendance_status_types (name, short, kind, day_amount, sort_order)
VALUES ('대체휴무', '대휴', 'subst', 1, 65)
ON CONFLICT (name) DO UPDATE SET kind = 'subst';

-- 검증
SELECT name, short, kind, day_amount FROM attendance_status_types WHERE kind = 'subst';
