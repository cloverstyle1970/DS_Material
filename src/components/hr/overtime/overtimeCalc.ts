/** 2025~2027 한국 공휴일 목록 (YYYY-MM-DD) */
const KR_HOLIDAYS = new Set([
  // 2025
  "2025-01-01","2025-01-28","2025-01-29","2025-01-30",
  "2025-03-01","2025-05-05","2025-05-06","2025-06-06",
  "2025-08-15","2025-10-03","2025-10-06","2025-10-07","2025-10-08","2025-10-09",
  "2025-12-25",
  // 2026
  "2026-01-01","2026-02-17","2026-02-18","2026-02-19",
  "2026-03-01","2026-05-05","2026-06-06",
  "2026-08-17",
  "2026-10-03","2026-10-05","2026-10-06","2026-10-09",
  "2026-12-25",
  // 2027
  "2027-01-01","2027-02-08","2027-02-09","2027-02-10",
  "2027-03-01","2027-05-05","2027-06-06",
  "2027-08-16",
  "2027-10-04","2027-10-05","2027-10-09","2027-10-11",
  "2027-12-25",
]);

export type HolidayType = "토요일" | "일요일" | "공휴일" | "";

export function detectHoliday(date: Date): { isHoliday: boolean; holidayType: HolidayType } {
  const ymd = date.toLocaleDateString("sv-SE"); // YYYY-MM-DD
  const day = date.getDay();
  if (KR_HOLIDAYS.has(ymd)) return { isHoliday: true, holidayType: "공휴일" };
  if (day === 0) return { isHoliday: true, holidayType: "일요일" };
  if (day === 6) return { isHoliday: true, holidayType: "토요일" };
  return { isHoliday: false, holidayType: "" };
}

/**
 * 경과 시간(분)으로부터 순 근무 시간(분) 계산.
 *
 * 규칙: 4시간(240분) 근무마다 30분 휴식.
 * 사이클 = 240분 근무 + 30분 휴식 = 270분 경과.
 *
 * 예) 경과 540분(9h) → 2사이클(480분 근무=8h) ✓
 *     경과 270분(4.5h) → 1사이클(240분=4h) ✓
 *     경과 240분(4h)   → 0사이클 + 나머지240 → 4h ✓
 */
export function calcWorkMinutes(elapsedMinutes: number): number {
  if (elapsedMinutes <= 0) return 0;
  const CYCLE   = 270; // 경과 1사이클
  const WORK_PER = 240; // 사이클당 근무
  const cycles   = Math.floor(elapsedMinutes / CYCLE);
  const remaining = elapsedMinutes % CYCLE;
  return cycles * WORK_PER + Math.min(remaining, WORK_PER);
}

export interface OvertimeResult {
  workHours:     number; // 순 근무시간
  holidayHours:  number; // 휴일근무 시간 (is_holiday 일 때 최대 8)
  overtimeHours: number; // 잔업 시간
  display:       string; // UI 표시 문자열
}

/** 잔업시간 0.5 단위 올림: 0 < x ≤ 0.5 → 0.5, 0.5 < x ≤ 1.0 → 1.0 */
function roundOT(h: number): number {
  return Math.ceil(h * 2) / 2;
}
function hrStr(h: number): string {
  return `${h % 1 === 0 ? h : h.toFixed(1)}HR`;
}

export function calcOvertimeResult(start: Date, end: Date, isHoliday: boolean): OvertimeResult {
  const elapsedMin = (end.getTime() - start.getTime()) / 60000;
  if (elapsedMin <= 0) return { workHours: 0, holidayHours: 0, overtimeHours: 0, display: "-" };

  const workMin = calcWorkMinutes(elapsedMin);
  const workH   = workMin / 60;

  if (isHoliday) {
    const holidayH  = Math.min(workH, 8);
    const overtimeH = roundOT(Math.max(0, workH - 8));
    const overtimeStr = overtimeH > 0 ? ` + ${hrStr(overtimeH)}` : "";
    return {
      workHours:     workH,
      holidayHours:  holidayH,
      overtimeHours: overtimeH,
      display:       `휴일 ${hrStr(holidayH)}${overtimeStr}`,
    };
  }

  // 평일: 17:30 이후 시작 또는 총 근무시간 8h 미만 → 전체 잔업 / 그 외 → 초과분만 잔업
  const threshold = new Date(start);
  threshold.setHours(17, 30, 0, 0);

  const overtimeH = start >= threshold || workH < 8
    ? roundOT(workH)
    : roundOT(workH - 8);
  return {
    workHours:     workH,
    holidayHours:  0,
    overtimeHours: overtimeH,
    display:       hrStr(overtimeH),
  };
}

/** 요일 한글 문자 */
export function dayOfWeekKr(date: Date): string {
  return ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
}
