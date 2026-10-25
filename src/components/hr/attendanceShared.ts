// 근태현황(/hr/attendance)·주52시간 관리(/hr/work-hours) 공통 로직.
// 연차계 승인 건 펼치기, 재직·휴직 기간 계산, 전무 이상 제외 등 두 화면이 같은 기준을 쓰도록 여기서만 정의한다.

// ── 근태 종류 ────────────────────────────────────────────────
// DB attendance_status_types 에서 관리 (근태현황 > ⚙ 근태 종류). 아래 기본값은 DB 를 못 읽을 때와,
// 연차계 종류(연차·휴가·경조 등)가 DB 에서 지워졌을 때의 판정용 예비값.
// kind: 집계 분류. leave=연차, off=휴가류, subst=대체휴무, absent=결근 (이 넷은 dayAmount 만큼 근무 공제),
//       late=지각, early=조퇴·외출, work=출장·교육(출근 인정),
//       extra=특근 (토·일·공휴일에 등록하면 주52시간에 부서 소정시간 근무로 인정), etc=기타
export type Kind = "leave" | "off" | "subst" | "absent" | "late" | "early" | "work" | "extra" | "etc";
// 근무 공제 분류 (근태현황 출근일수·주52시간 정규근무에서 공제 일수만큼 뺌)
export const DEDUCT_KINDS: Kind[] = ["leave", "off", "subst", "absent"];
export const KIND_LABELS: Record<Kind, string> = {
  leave: "연차 (공제)", off: "휴가류 (공제)", subst: "대체휴무 (공제)", absent: "결근 (공제)", late: "지각",
  early: "조퇴·외출", work: "출장·교육 (출근 인정)", extra: "특근 (휴일 근무 인정)", etc: "기타",
};

export interface StatusDef { id?: number; key: string; short: string; kind: Kind; dayAmount: number; sortOrder: number; active: boolean; }

export const DEFAULT_STATUS_DEFS: StatusDef[] = [
  ["연차", "연", "leave", 1], ["반차", "반", "leave", 0.5], ["휴가", "휴", "off", 1], ["경조", "경", "off", 1],
  ["공가", "공", "off", 1], ["병가", "병", "off", 1], ["결근", "결", "absent", 1], ["지각", "지", "late", 1],
  ["조퇴", "조", "early", 1], ["외출", "외", "early", 1], ["출장", "출", "work", 1], ["교육", "교", "work", 1],
  ["훈련", "훈", "work", 1], ["특근", "특", "extra", 1], ["기타", "기", "etc", 1],
].map(([key, short, kind, dayAmount], i) => ({ key, short, kind, dayAmount, sortOrder: (i + 1) * 10, active: true }) as StatusDef);

export const STATUS_TYPE_SELECT = "id,name,short,kind,day_amount,sort_order,active";
export interface StatusTypeRow { id: number; name: string; short: string; kind: Kind; day_amount: number; sort_order: number; active: boolean; }
export const rowToStatusDef = (r: StatusTypeRow): StatusDef =>
  ({ id: r.id, key: r.name, short: r.short, kind: r.kind, dayAmount: Number(r.day_amount), sortOrder: r.sort_order, active: r.active });

// 이름 → 정의. DB 값이 기본값을 덮어쓴다 (DB 에 없는 연차계 종류도 판정 가능하도록 기본값을 먼저 깐다)
export function statusMapOf(defs: StatusDef[]): Record<string, StatusDef> {
  return Object.fromEntries([...DEFAULT_STATUS_DEFS, ...defs].map(d => [d.key, d]));
}

// 직급 전무 이상은 근태관리 제외. ranks 테이블의 전무 sort_order 보다 높은(작은) 직급 + 아래 고정 목록
const EXEC_RANKS_FALLBACK = ["회장", "부회장", "대표이사", "대표", "사장", "부사장", "전무"];

export function excludedRankSet(ranks: Rank[]): Set<string> {
  const s = new Set(EXEC_RANKS_FALLBACK);
  const threshold = ranks.find(r => r.name === "전무")?.sort_order;
  if (threshold != null) ranks.forEach(r => { if (r.sort_order < threshold) s.add(r.name); });
  return s;
}

// 연차계와 동일한 표준 근무시간 08:30~17:30
const WORK_START_MINUTES = 8 * 60 + 30;
const WORK_END_MINUTES   = 17 * 60 + 30;
const WORK_SLOT_MINUTES  = WORK_END_MINUTES - WORK_START_MINUTES;

export interface Employee {
  id: number;
  username: string | null;
  name: string | null;
  dept: string | null;
  team: string | null;
  rank: string | null;
  status: string | null;
  hire_date: string | null;
  resign_date: string | null;
}
export const EMPLOYEE_SELECT = "id,username,name,dept,team,rank,status,hire_date,resign_date";

export interface Rank { name: string; sort_order: number; }
export interface LeaveRow {
  id: number;
  request_no: string;
  author_id: number;
  leave_type: string;
  s_yr: string | null; s_mo: string | null; s_dy: string | null; s_hr: string | null; s_mi: string | null;
  e_yr: string | null; e_mo: string | null; e_dy: string | null; e_hr: string | null; e_mi: string | null;
}
export const LEAVE_SELECT = "id,request_no,author_id,leave_type,s_yr,s_mo,s_dy,s_hr,s_mi,e_yr,e_mo,e_dy,e_hr,e_mi";

export interface AttendanceRecord {
  id: number;
  account_id: number;
  work_date: string;
  status: string;
  note: string | null;
}
export interface StatusEvent { user_id: number; status_type: string; event_date: string; }
export const STATUS_HISTORY_TYPES = ["입사", "퇴직", "재입사", "휴직", "육아휴직", "복직"];

// 휴직 종류(재직상태 이력·accounts.status) → 근태현황 표시
export const LOA_LABELS: Record<string, string> = { "휴직": "휴직", "육아휴직": "육휴" };
export interface Period { from: string; to: string | null; label?: string; } // to 포함, null=진행중. label: 휴직 기간 표시명

// ── 날짜 ────────────────────────────────────────────────────
export const pad2 = (n: number | string) => String(n).padStart(2, "0");
export const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
export const dateKey = (d: Date) => ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
export function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(key: string, n: number): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
export const DOW_KR = "일월화수목금토";

function leaveDate(yr: string | null, mo: string | null, dy: string | null): Date | null {
  if (!yr || !mo || !dy) return null;
  const y = yr.length <= 2 ? 2000 + Number(yr) : Number(yr);
  const d = new Date(y, Number(mo) - 1, Number(dy));
  return isNaN(d.getTime()) ? null : d;
}

// 승인된 연차계 1건을 일자별 사용량으로 펼친다 (0.5일 단위).
// 주말·공휴일도 기간 안이면 표시용으로 amount 0 으로 포함 — 연휴에 걸쳐 승인된 휴가가 화면에서 사라지지 않게.
export function expandLeave(r: LeaveRow, isOffDay: (key: string) => boolean): { date: string; amount: number }[] {
  const s = leaveDate(r.s_yr, r.s_mo, r.s_dy);
  if (!s) return [];
  const e = leaveDate(r.e_yr, r.e_mo, r.e_dy) ?? s;
  if (e < s) return [];
  const hasTime = !!(r.s_hr && r.s_mi && r.e_hr && r.e_mi);
  const sMin = hasTime ? Number(r.s_hr) * 60 + Number(r.s_mi) : WORK_START_MINUTES;
  const eMin = hasTime ? Number(r.e_hr) * 60 + Number(r.e_mi) : WORK_END_MINUTES;
  const out: { date: string; amount: number }[] = [];
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const key = dateKey(d);
    if (isOffDay(key)) { out.push({ date: key, amount: 0 }); continue; }
    const first = d.getTime() === s.getTime();
    const last  = d.getTime() === e.getTime();
    const effStart = Math.max(first ? sMin : WORK_START_MINUTES, WORK_START_MINUTES);
    const effEnd   = Math.min(last ? eMin : WORK_END_MINUTES, WORK_END_MINUTES);
    if (effEnd <= effStart) continue;
    const amount = Math.max(0.5, Math.round(((effEnd - effStart) / WORK_SLOT_MINUTES) * 2) / 2);
    out.push({ date: key, amount });
  }
  return out;
}

// 입사·퇴사일을 YYYY-MM-DD 로 정규화 ("2026-09-7" 같은 입력 보정 — 문자열 비교로 기간 판정하므로 필수).
// 퇴사일이 입사일보다 이르면 재입사 전 퇴사 기록이므로 무시한다.
function normDate(v: string | null): string | null {
  const m = v?.trim().match(/^(\d{4})\D?(\d{1,2})\D?(\d{1,2})$/);
  return m ? ymd(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}
export function normalizeEmploymentDates(e: Employee): Employee {
  const hire = normDate(e.hire_date);
  let resign = normDate(e.resign_date);
  if (hire && resign && resign < hire) resign = null;
  return { ...e, hire_date: hire, resign_date: resign };
}

// 재직 기간: 재직상태 이력(입사·재입사 → 퇴직, 퇴직일 포함)으로 계산해 퇴사 후 재입사 공백을 반영.
// 이력이 없으면 accounts.hire_date ~ resign_date (퇴사 상태인데 퇴사일이 없으면 대상 아님).
export function buildEmploymentPeriods(employees: Employee[], events: StatusEvent[]): Map<number, Period[]> {
  const byUser = new Map<number, StatusEvent[]>();
  for (const ev of events) {
    if (!["입사", "퇴직", "재입사"].includes(ev.status_type)) continue;
    byUser.set(ev.user_id, [...(byUser.get(ev.user_id) ?? []), ev]);
  }
  const m = new Map<number, Period[]>();
  for (const e of employees) {
    const evs = byUser.get(e.id);
    if (!evs) {
      m.set(e.id, e.status === "퇴사" && !e.resign_date ? [] : [{ from: e.hire_date ?? "0000-01-01", to: e.resign_date }]);
      continue;
    }
    const periods: Period[] = [];
    let open: Period | null = null;
    for (const ev of evs) {
      if (ev.status_type === "퇴직") {
        if (open) { open.to = ev.event_date; periods.push(open); open = null; }
        else if (periods.length === 0) {
          // 입사 이력 없이 퇴직만 있는 경우: hire_date 가 퇴직일 이전일 때만 시작일로 사용 (이후면 재입사일)
          const from = e.hire_date && e.hire_date <= ev.event_date ? e.hire_date : "0000-01-01";
          periods.push({ from, to: ev.event_date });
        }
      } else if (!open) {
        open = { from: ev.event_date, to: null };
      }
    }
    if (open) {
      if (e.resign_date && e.resign_date >= open.from) open.to = e.resign_date;
      periods.push(open);
    }
    m.set(e.id, periods);
  }
  return m;
}

// 휴직 기간: 재직상태 이력의 휴직(육아휴직)→복직. 복직일 전날까지가 휴직.
// 현재 휴직 상태인데 휴직·복직 이력이 전혀 없으면 전 기간 휴직으로 본다.
// (복직 예정일이 미리 등록된 경우 accounts.status 는 아직 '휴직'이므로 이력이 있으면 이력을 따른다)
export function buildLoaPeriods(employees: Employee[], events: StatusEvent[]): Map<number, Period[]> {
  const m = new Map<number, Period[]>();
  for (const ev of events) {
    const loaLabel = LOA_LABELS[ev.status_type];
    if (!loaLabel && ev.status_type !== "복직") continue;
    const list = m.get(ev.user_id) ?? [];
    const open = list.find(p => p.to === null);
    if (loaLabel && !open) list.push({ from: ev.event_date, to: null, label: loaLabel });
    if (ev.status_type === "복직" && open) open.to = addDays(ev.event_date, -1);
    m.set(ev.user_id, list);
  }
  for (const e of employees) {
    const label = e.status ? LOA_LABELS[e.status] : undefined;
    if (label && !m.has(e.id)) m.set(e.id, [{ from: "0000-01-01", to: null, label }]);
  }
  return m;
}

export const inPeriods = (periods: Period[] | undefined, key: string) =>
  (periods ?? []).some(p => p.from <= key && (p.to === null || key <= p.to));
// 해당 일자가 속한 기간 (휴직 표시명 조회용)
export const periodAt = (periods: Period[] | undefined, key: string) =>
  (periods ?? []).find(p => p.from <= key && (p.to === null || key <= p.to));
// 휴직 기간 표시명 ("휴직"·"육휴"), 휴직 기간이 아니면 null
export const loaLabelAt = (periods: Period[] | undefined, key: string): string | null => {
  const p = periodAt(periods, key);
  return p ? p.label ?? "휴직" : null;
};
export const overlapsPeriods = (periods: Period[] | undefined, from: string, to: string) =>
  (periods ?? []).some(p => p.from <= to && (p.to === null || p.to >= from));

export const empName = (e: Employee) => e.username || e.name || "(이름없음)";

// PostgREST 기본 1000행 제한을 넘는 조회용 페이지 반복
export async function fetchAllPages<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> },
): Promise<{ data: T[]; error: string | null }> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await build().range(off, off + PAGE - 1);
    if (error) return { data: out, error: error.message };
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return { data: out, error: null };
  }
}
