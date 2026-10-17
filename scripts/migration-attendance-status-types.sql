-- ============================================================
-- 근태 종류 (근태현황 > ⚙ 근태 종류)
-- 근태현황 등록 버튼·범례·집계와 주52시간 근무 공제에 사용.
-- kind(집계 분류): leave=연차, off=휴가류, absent=결근 (이 셋은 day_amount 만큼 근무 공제)
--                  late=지각, early=조퇴·외출, work=출장·교육(출근 인정), extra=특근, etc=기타
-- 이름 변경 시 attendance_records.status 도 화면에서 함께 변경한다.
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_status_types (
  id          bigserial    PRIMARY KEY,
  name        text         NOT NULL,
  short       text         NOT NULL,
  kind        text         NOT NULL DEFAULT 'etc',
  day_amount  numeric      NOT NULL DEFAULT 1,
  sort_order  integer      NOT NULL DEFAULT 0,
  active      boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT attendance_status_types_name_uniq UNIQUE (name),
  CONSTRAINT attendance_status_types_kind_chk CHECK (kind IN ('leave','off','absent','late','early','work','extra','etc')),
  CONSTRAINT attendance_status_types_amount_chk CHECK (day_amount > 0 AND day_amount <= 1)
);

ALTER TABLE attendance_status_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_status_types_authenticated_all ON attendance_status_types;
CREATE POLICY attendance_status_types_authenticated_all ON attendance_status_types
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- 기본 15종
INSERT INTO attendance_status_types (name, short, kind, day_amount, sort_order) VALUES
  ('연차', '연', 'leave',  1,   10),
  ('반차', '반', 'leave',  0.5, 20),
  ('휴가', '휴', 'off',    1,   30),
  ('경조', '경', 'off',    1,   40),
  ('공가', '공', 'off',    1,   50),
  ('병가', '병', 'off',    1,   60),
  ('결근', '결', 'absent', 1,   70),
  ('지각', '지', 'late',   1,   80),
  ('조퇴', '조', 'early',  1,   90),
  ('외출', '외', 'early',  1,  100),
  ('출장', '출', 'work',   1,  110),
  ('교육', '교', 'work',   1,  120),
  ('훈련', '훈', 'work',   1,  130),
  ('특근', '특', 'extra',  1,  140),
  ('기타', '기', 'etc',    1,  150)
ON CONFLICT (name) DO NOTHING;

-- 검증
SELECT name, short, kind, day_amount, sort_order, active FROM attendance_status_types ORDER BY sort_order;
