// 주52시간 관리 근무시간 계산.
// 하루 근무시간 = 정규(부서별 소정시간 − 연차 등 공제, 휴일·휴무일 0) + 승인 잔업보고서 + 근무표 당직·고장대기

import { DEDUCT_KINDS, addDays, dateKey, parseKey, type Employee, type Kind, type StatusDef } from "./attendanceShared";

export const WEEK_WARN_HOURS  = 52; // 초과 시 경고
export const WEEK_LIMIT_HOURS = 64; // 초과 시 위반 (52 + 연장 12)

// ── 부서별 소정 근무 ──
// endMin: 퇴근 시각(분). 13시 출근 시 정규시간 = 13:00~퇴근 (점심 12~13시 이전이라 휴게 차감 없음)
export interface DeptSchedule { label: string; time: string; hours: number; endMin: number; }
export function deptSchedule(dept: string | null): DeptSchedule {
  if (dept === "공사팀") return { label: "공사팀", time: "07:00~16:00", hours: 8, endMin: 16 * 60 };
  if (dept === "상주팀") return { label: "상주팀", time: "08:30~18:30", hours: 9, endMin: 18 * 60 + 30 };
  return { label: "일반", time: "08:30~17:30", hours: 8, endMin: 17 * 60 + 30 };
}
const LATE_START_MIN = 13 * 60;

// ── 근무표(duty_roster) 당직·고장대기 ──
export type DutyKind = "평일당직" | "휴일당직" | "고장대기" | "휴일고장대기" | "야간점검";
export const DUTY_RULES: Record<DutyKind, { hours: number; time: string; restNextDay: boolean }> = {
  평일당직:     { hours: 9.5,  time: "17:30~익일 08:30", restNextDay: true },
  휴일당직:     { hours: 17.5, time: "08:30~익일 08:30", restNextDay: true },
  고장대기:     { hours: 4,    time: "17:30~22:30",      restNextDay: false },
  휴일고장대기: { hours: 12,   time: "08:30~22:30",      restNextDay: false },
  // 야간점검: 근무표 '야간점검 (22:00 ~ 06:00)' 열. 시간은 잔업으로 집계, 작업 종료(06시) 후 퇴근
  야간점검:     { hours: 8,    time: "22:00~익일 06:00", restNextDay: true },
};

export interface OvertimeRow {
  id: number;
  report_no: string;
  start_at: string;
  end_at: string;
  is_holiday: boolean;
  work_hours: number | null;
  overtime_hours: number | null;
  workers: string[] | null;
}
export const OVERTIME_SELECT = "id,report_no,start_at,end_at,is_holiday,work_hours,overtime_hours,workers";

// 월 근무표(work_duty_roster) — 근무표 등록 탭에서 등록. 주52시간 계산의 유일한 당직·대기 출처
export interface RosterRow { id: number; duty_date: string; account_id: number; duty_type: DutyKind; note: string | null; }
export const ROSTER_SELECT = "id,duty_date,account_id,duty_type,note";
export const DUTY_KINDS = Object.keys(DUTY_RULES) as DutyKind[];

// 당직 후 연속근무 금지: 평일당직·휴일당직을 선 다음날에는 당직·파주대기(고장대기·휴일고장대기) 모두 배정 불가.
// (대기 다음날 당직은 허용)
export const isNightDuty = (k: DutyKind) => k === "평일당직" || k === "휴일당직";
// rows 중 accountIds 의 위반 쌍 [사원, 당직일, 다음날 근무]. focusDates 가 있으면 그 날짜가 낀 쌍만
export function consecutiveDuties(
  rows: { account_id: number; duty_date: string; duty_type: DutyKind }[],
  accountIds: number[],
  focusDates?: string[],
): { accountId: number; first: string; second: string }[] {
  const out: { accountId: number; first: string; second: string }[] = [];
  for (const id of accountIds) {
    const mine = rows.filter(r => r.account_id === id);
    const nights = new Set(mine.filter(r => isNightDuty(r.duty_type)).map(r => r.duty_date.slice(0, 10)));
    const anyDuty = new Set(mine.map(r => r.duty_date.slice(0, 10)));
    for (const d of [...nights].sort()) {
      const next = addDays(d, 1);
      if (!anyDuty.has(next)) continue;
      if (focusDates && !focusDates.some(f => f === d || f === next)) continue;
      out.push({ accountId: id, first: d, second: next });
    }
  }
  return out;
}

// 계산용 근무표 1건
export interface DutyEntry { date: string; kind: DutyKind; accountId: number | null; name: string | null; source: string; }
export const rosterToEntries = (roster: RosterRow[]): DutyEntry[] =>
  roster.map(r => ({ date: r.duty_date.slice(0, 10), kind: r.duty_type, accountId: r.account_id, name: null, source: "근무표" }));



// 야간 잔업 종료 시각 기준: 03:00~06:00 전 종료 → 종료일 13시 출근(late), 06:00 이후 종료 → 종료일 휴무(rest).
// 야간 잔업 = 날을 넘겼거나 자정~03시 사이 시작. 06시 이후 시작한 조출·주간 작업은 대상 아님.
export function overnightEffect(startAt: string, endAt: string): { endDay: string; endHm: string; effect: "rest" | "late" } | null {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const endDay = dateKey(end);
  const overnight = endDay > dateKey(start) || start.getHours() < 3;
  if (!overnight || end.getHours() < 3) return null;
  const endHm = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  return { endDay, endHm, effect: end.getHours() >= 6 ? "rest" : "late" };
}

export interface DayHours {
  date: string;
  regular: number;
  overtime: number;
  duty: number;
  total: number;
  notes: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// 사원별 일자별 근무시간 계산.
// leaveUse: 사원 → 일자 → 공제 일수(1=하루 전체). 휴직·재직외 기간은 0시간. today 이후는 같은 규칙의 예정치(내역에 '예정').
export function buildDailyHours(args: {
  employees: Employee[];
  from: string;
  to: string;
  today: string;
  isOffDay: (key: string) => boolean;
  employed: (e: Employee, key: string) => boolean;
  onLoa: (e: Employee, key: string) => string | null; // 휴직 표시명("휴직"·"육휴"), 휴직 아니면 null
  leaveUse: Map<number, Map<string, { amount: number; label: string }[]>>;
  // 휴일 근무 인정: 근태현황에 특근 분류(예: 근무)로 등록된 날 → 토·일·공휴일이면 부서 소정시간을 정규로
  holidayWork?: Map<number, Map<string, string>>;
  overtime: OvertimeRow[];
  duty: DutyEntry[];
}): Map<number, Map<string, DayHours>> {
  const { employees, from, to, today, isOffDay, employed, onLoa, leaveUse, overtime, duty, holidayWork } = args;
  const byName = new Map<string, number>();
  for (const e of employees) {
    if (e.username) byName.set(e.username.trim(), e.id);
    if (e.name && !byName.has(e.name.trim())) byName.set(e.name.trim(), e.id);
  }
  const ids = new Set(employees.map(e => e.id));

  // 사원 → 일자 → 추가시간/휴무 사유
  const extra = new Map<number, Map<string, { overtime: number; duty: number; notes: string[]; rest: string[]; late: string[] }>>();
  const slot = (id: number, date: string) => {
    let m = extra.get(id);
    if (!m) { m = new Map(); extra.set(id, m); }
    let s = m.get(date);
    if (!s) { s = { overtime: 0, duty: 0, notes: [], rest: [], late: [] }; m.set(date, s); }
    return s;
  };

  // 같은 날 야간 잔업보고서가 있는 사원 — 근무표 야간점검 시간과 중복 집계하지 않기 위함
  const nightReport = new Set<string>();
  for (const r of overtime) {
    const day = dateKey(new Date(r.start_at));
    // 휴일 잔업은 근무시간 전체, 평일은 잔업시간만 (정규시간은 소정근무로 이미 계산)
    const hours = Number(r.is_holiday ? r.work_hours : r.overtime_hours) || 0;
    const night = overnightEffect(r.start_at, r.end_at);
    for (const w of r.workers ?? []) {
      const id = byName.get(w.trim());
      if (id == null) continue;
      const s = slot(id, day);
      s.overtime += hours;
      s.notes.push(`잔업 ${hours}H (${r.report_no})`);
      if (night) nightReport.add(`${id}|${day}`);
      if (night?.effect === "rest") slot(id, night.endDay).rest.push(`잔업 익일 ${night.endHm} 종료 휴무`);
      if (night?.effect === "late") slot(id, night.endDay).late.push(`잔업 익일 ${night.endHm} 종료 13시 출근`);
    }
  }

  for (const d of duty) {
    const { kind, date } = d;
    const id = d.accountId && ids.has(d.accountId) ? d.accountId : byName.get((d.name ?? "").trim());
    if (id == null) continue;
    const rule = DUTY_RULES[kind];
    const s = slot(id, date);
    if (kind === "야간점검") {
      // 잔업으로 집계. 같은 날 야간 잔업보고서가 있으면 보고서 시간만 반영
      if (nightReport.has(`${id}|${date}`)) s.notes.push(`야간점검 (${d.source}, 잔업보고서 시간 반영)`);
      else { s.overtime += rule.hours; s.notes.push(`야간점검 잔업 ${rule.hours}H (${d.source})`); }
    } else {
      s.duty += rule.hours;
      s.notes.push(`${kind} ${rule.hours}H (${d.source})`);
    }
    if (rule.restNextDay) slot(id, addDays(date, 1)).rest.push(`${kind} 익일 퇴근`);
  }

  const out = new Map<number, Map<string, DayHours>>();
  for (const e of employees) {
    const sched = deptSchedule(e.dept);
    const row = new Map<string, DayHours>();
    for (let key = from; key <= to; key = addDays(key, 1)) {
      const x = extra.get(e.id)?.get(key);
      const notes: string[] = [];
      if (!employed(e, key)) { row.set(key, { date: key, regular: 0, overtime: 0, duty: 0, total: 0, notes: ["재직 기간 외"] }); continue; }
      // 미래 일자도 같은 규칙: 평일 소정시간(상주팀 9H·그 외 8H) − 승인 연차 + 등록 근무표(당직·대기, 다음날 퇴근)
      let regular = 0;
      const workLabel = holidayWork?.get(e.id)?.get(key);
      const loa = onLoa(e, key);
      if (loa) notes.push(loa);
      else if (isOffDay(key)) {
        if (workLabel) { regular = sched.hours; notes.push(`${workLabel} — 휴일 근무 ${sched.hours}H`); }
      } else {
        if (x?.rest.length) notes.push(...x.rest);
        else {
          const uses = leaveUse.get(e.id)?.get(key) ?? [];
          const used = Math.min(1, uses.reduce((t, u) => t + u.amount, 0));
          uses.forEach(u => notes.push(u.label));
          regular = sched.hours * (1 - used);
          if (x?.late.length) {
            notes.push(...x.late);
            regular = Math.min(regular, Math.max(0, sched.endMin - LATE_START_MIN) / 60);
          }
        }
      }
      const overtime = x?.overtime ?? 0;
      const dutyH = x?.duty ?? 0;
      if (x) notes.push(...x.notes);
      if (key > today) notes.push("예정");
      row.set(key, { date: key, regular: round2(regular), overtime: round2(overtime), duty: round2(dutyH), total: round2(regular + overtime + dutyH), notes });
    }
    out.set(e.id, row);
  }
  return out;
}

// 연차계 승인 건 + 근태 수기 등록 → 근무 공제 일수
// 연차·휴가류·결근은 공제, 출장·교육·훈련은 근무 인정. 연차계 조퇴는 사용 시간만큼 공제.
export function leaveDeduction(kind: string | undefined): boolean {
  return !!kind && (DEDUCT_KINDS.includes(kind as Kind) || kind === "early");
}
// 근태 수기 등록 → 공제 일수: 근태 종류의 집계 분류가 연차·휴가류·결근이면 그 종류의 공제 일수(반차 0.5 등)
export function recordDeduction(def: StatusDef | undefined): number {
  return def && DEDUCT_KINDS.includes(def.kind) ? def.dayAmount : 0;
}

// 일요일 시작 ~ 토요일 마감 주. 주의 귀속 월은 그 주 목요일이 속한 월 (예: 9/27~10/3 → 10월)
export function weekStart(key: string): string {
  return addDays(key, -parseKey(key).getDay());
}
export function weeksOfPeriod(from: string, to: string): string[] {
  const out: string[] = [];
  for (let sun = weekStart(from); sun <= to; sun = addDays(sun, 7)) {
    const thu = addDays(sun, 4);
    if (thu >= from && thu <= to) out.push(sun);
  }
  return out;
}

export function hoursLevel(h: number): "ok" | "warn" | "over" {
  return h > WEEK_LIMIT_HOURS ? "over" : h > WEEK_WARN_HOURS ? "warn" : "ok";
}

export const fmtH = (n: number) => (n === 0 ? "" : n % 1 === 0 ? String(n) : n.toFixed(1));
