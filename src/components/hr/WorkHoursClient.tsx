"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import DraggableModal from "@/components/common/DraggableModal";
import DutyRosterEditor from "./DutyRosterEditor";
import {
  STATUS_TYPE_SELECT, rowToStatusDef, statusMapOf, EMPLOYEE_SELECT, LEAVE_SELECT, STATUS_HISTORY_TYPES, DOW_KR,
  excludedRankSet, expandLeave, normalizeEmploymentDates, buildEmploymentPeriods, buildLoaPeriods,
  inPeriods, overlapsPeriods, empName, ymd, addDays, parseKey, dateKey, fetchAllPages,
  type Employee, type Rank, type StatusDef, type StatusTypeRow, type LeaveRow, type AttendanceRecord, type StatusEvent,
} from "./attendanceShared";
import {
  WEEK_WARN_HOURS, WEEK_LIMIT_HOURS, DUTY_RULES, OVERTIME_SELECT, ROSTER_SELECT, rosterToEntries,
  deptSchedule, buildDailyHours, leaveDeduction, recordDeduction, weekStart, weeksOfPeriod, hoursLevel, fmtH,
  type OvertimeRow, type RosterRow, type DayHours, type DutyKind,
} from "./workHoursCalc";

export const WORK_HOURS_MENU_HREF = "/hr/work-hours";

type Unit = "month" | "quarter" | "year";

const LEVEL_CLS = {
  ok:   "",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  over: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200",
};

interface Totals { regular: number; overtime: number; duty: number; total: number; }
const sumDays = (row: Map<string, DayHours> | undefined, from: string, to: string): Totals => {
  const t = { regular: 0, overtime: 0, duty: 0, total: 0 };
  if (!row) return t;
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const d = row.get(k);
    if (!d) continue;
    t.regular += d.regular; t.overtime += d.overtime; t.duty += d.duty; t.total += d.total;
  }
  return t;
};
const weekTotal = (row: Map<string, DayHours> | undefined, sun: string) => sumDays(row, sun, addDays(sun, 6)).total;
const shortMd = (key: string) => { const d = parseKey(key); return `${d.getMonth() + 1}/${d.getDate()}`; };
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
// 일자 칸 표시: 근무시간이 있으면 시간, 없으면 사유(휴무·휴직·연차 등) 약칭
function dayLabel(d: DayHours | undefined): { text: string; cls: string } {
  if (!d) return { text: "", cls: "" };
  if (d.total > 0) {
    const special = d.notes.some(n => n.includes("13시 출근"));
    return { text: fmtH(d.total), cls: `font-semibold ${special ? "text-amber-700 dark:text-amber-300" : d.overtime || d.duty ? "text-blue-700 dark:text-blue-300" : "text-gray-800 dark:text-gray-200"}` };
  }
  const n = d.notes[0] ?? "";
  if (n.includes("휴무") || n.includes("퇴근")) return { text: "휴무", cls: "text-[10px] text-gray-500 dark:text-gray-400" };
  if (n === "휴직") return { text: "휴직", cls: "text-[10px] text-slate-500 dark:text-slate-400" };
  if (n === "재직 기간 외") return { text: "", cls: "" };
  const leave = n.match(/^(\S+) [\d.]+일|^(\S+) \(근태\)/);
  if (leave) return { text: (leave[1] ?? leave[2]).slice(0, 2), cls: "text-[10px] text-purple-700 dark:text-purple-300" };
  return { text: "", cls: "" };
}

const quarterRange = (y: number, q: number): [string, string] => {
  const m0 = (q - 1) * 3 + 1;
  return [ymd(y, m0, 1), ymd(y, m0 + 2, lastDay(y, m0 + 2))];
};

export default function WorkHoursClient() {
  const { user } = useAuth();
  const now = new Date();
  const [unit, setUnit] = useState<Unit>("month");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [deptFilter, setDeptFilter] = useState("");
  const [search, setSearch] = useState("");
  const [onlyIssue, setOnlyIssue] = useState(false);
  const [detail, setDetail] = useState<{ emp: Employee; year: number; month: number } | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map());
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [statusDefs, setStatusDefs] = useState<StatusDef[]>([]);
  const [statusEvents, setStatusEvents] = useState<StatusEvent[]>([]);
  const [overtime, setOvertime] = useState<OvertimeRow[]>([]);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [tab, setTab] = useState<"hours" | "roster">("hours");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 시스템 관리자 전용 (사이드바 adminOnly + 권한그룹 트리 미노출)
  const canRead = !!user && isAdmin(user);
  const [today] = useState(() => dateKey(new Date())); // 이후 일자는 내역에 "예정" 표시 (계산 규칙은 같음)

  // 연 단위로 조회 (주가 연도를 걸치므로 앞뒤 1주 여유)
  const loadFrom = weekStart(ymd(year, 1, 1));
  const loadTo   = addDays(weekStart(ymd(year, 12, 31)), 6);

  // setState 는 모두 await 이후에 호출. 로딩 표시는 연도 이동 시 켠다.
  const load = useCallback(async () => {
    const [accRes, rankRes, holRes, leaveRes, histRes, recRes, otRes, rosterRes, typeRes] = await Promise.all([
      supabase.from("accounts").select(EMPLOYEE_SELECT),
      supabase.from("ranks").select("name,sort_order"),
      supabase.from("public_holidays").select("date,name").gte("date", loadFrom).lte("date", loadTo),
      supabase.from("leave_requests").select(LEAVE_SELECT).eq("approval_status", "approved"),
      supabase.from("user_status_history").select("user_id,status_type,event_date")
        .in("status_type", STATUS_HISTORY_TYPES).order("event_date"),
      fetchAllPages<AttendanceRecord>(() => supabase.from("attendance_records")
        .select("id,account_id,work_date,status,note").gte("work_date", loadFrom).lte("work_date", loadTo).order("id")),
      fetchAllPages<OvertimeRow>(() => supabase.from("overtime_reports").select(OVERTIME_SELECT)
        .eq("approval_status", "approved")
        .gte("start_at", `${loadFrom}T00:00:00+09:00`).lte("start_at", `${loadTo}T23:59:59+09:00`).order("id")),
      fetchAllPages<RosterRow>(() => supabase.from("work_duty_roster").select(ROSTER_SELECT)
        .gte("duty_date", addDays(loadFrom, -1)).lte("duty_date", loadTo).order("id")),
      supabase.from("attendance_status_types").select(STATUS_TYPE_SELECT),
    ]);
    const err = accRes.error?.message || rankRes.error?.message || holRes.error?.message || leaveRes.error?.message
      || histRes.error?.message || recRes.error || otRes.error || rosterRes.error || typeRes.error?.message;
    setError(err || null);
    setEmployees(((accRes.data ?? []) as Employee[]).map(normalizeEmploymentDates));
    setRanks((rankRes.data ?? []) as Rank[]);
    setHolidays(new Map(((holRes.data ?? []) as { date: string; name: string }[]).map(h => [h.date, h.name])));
    setLeaves((leaveRes.data ?? []) as LeaveRow[]);
    setStatusEvents((histRes.data ?? []) as StatusEvent[]);
    setRecords(recRes.data);
    setOvertime(otRes.data);
    setRoster(rosterRes.data);
    setStatusDefs(((typeRes.data ?? []) as StatusTypeRow[]).map(rowToStatusDef));
    setLoading(false);
  }, [loadFrom, loadTo]);

  // 연도 변경 시 Supabase 재조회 (외부 시스템 동기화 — setState 는 await 이후에만 발생)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canRead) load(); }, [load, canRead]);
  useReloadOnActivate(() => { if (canRead) load(); });

  const isOffDay = useCallback((key: string) => {
    const dow = parseKey(key).getDay();
    return dow === 0 || dow === 6 || holidays.has(key);
  }, [holidays]);

  // ── 조회 기간 ──
  const [periodFrom, periodTo] = useMemo((): [string, string] => {
    if (unit === "month") return [ymd(year, month, 1), ymd(year, month, lastDay(year, month))];
    if (unit === "quarter") return quarterRange(year, quarter);
    return [ymd(year, 1, 1), ymd(year, 12, 31)];
  }, [unit, year, month, quarter]);
  const periodWeeks = useMemo(() => weeksOfPeriod(periodFrom, periodTo), [periodFrom, periodTo]);
  // 월별 보기 열: 1~말일 + 토요일(주마감) 다음마다 그 주(일~토) 합계. 말일이 토요일이 아니면 마지막 주 합계를 끝에.
  type MonthCol = { kind: "day"; key: string; d: number; dow: number; holiday: string | null; off: boolean } | { kind: "week"; sun: string };
  const monthCols = useMemo((): MonthCol[] => {
    if (unit !== "month") return [];
    const cols: MonthCol[] = [];
    const last = lastDay(year, month);
    for (let d = 1; d <= last; d++) {
      const key = ymd(year, month, d);
      const dow = parseKey(key).getDay();
      const holiday = holidays.get(key) ?? null;
      cols.push({ kind: "day", key, d, dow, holiday, off: dow === 0 || dow === 6 || !!holiday });
      if (dow === 6 || d === last) cols.push({ kind: "week", sun: weekStart(key) });
    }
    return cols;
  }, [unit, year, month, holidays]);

  // 연별 보기에서 분기별 주평균도 함께 검토
  const periodQuarters = useMemo(() => (unit === "year" ? [1, 2, 3, 4] : []), [unit]);
  const periodMonths = useMemo(() => {
    if (unit === "month") return [];
    const m0 = unit === "quarter" ? (quarter - 1) * 3 + 1 : 1;
    return Array.from({ length: unit === "quarter" ? 3 : 12 }, (_, i) => m0 + i);
  }, [unit, quarter]);

  // ── 대상 사원 ──
  const excludedRanks = useMemo(() => excludedRankSet(ranks), [ranks]);
  const employmentPeriods = useMemo(() => buildEmploymentPeriods(employees, statusEvents), [employees, statusEvents]);
  const loaPeriods = useMemo(() => buildLoaPeriods(employees, statusEvents), [employees, statusEvents]);
  const yearEmployees = useMemo(() => employees
    .filter(e => !(e.rank && excludedRanks.has(e.rank)))
    .filter(e => overlapsPeriods(employmentPeriods.get(e.id), loadFrom, loadTo))
    .sort((a, b) => empName(a).localeCompare(empName(b), "ko")),
  [employees, excludedRanks, employmentPeriods, loadFrom, loadTo]);

  // ── 근무 공제 (연차계 승인 + 근태 수기) ──
  const statusMap = useMemo(() => statusMapOf(statusDefs), [statusDefs]);
  const leaveUse = useMemo(() => {
    const m = new Map<number, Map<string, { amount: number; label: string }[]>>();
    const push = (id: number, date: string, amount: number, label: string) => {
      let row = m.get(id);
      if (!row) { row = new Map(); m.set(id, row); }
      row.set(date, [...(row.get(date) ?? []), { amount, label }]);
    };
    const leaveDays = new Set<string>();
    for (const r of leaves) {
      const kind = statusMap[r.leave_type]?.kind;
      for (const { date, amount } of expandLeave(r, isOffDay)) {
        if (date < loadFrom || date > loadTo || amount <= 0) continue;
        leaveDays.add(`${r.author_id}|${date}`);
        if (leaveDeduction(kind)) push(r.author_id, date, amount, `${r.leave_type} ${amount}일 (${r.request_no})`);
      }
    }
    // 근태현황과 동일하게 연차계 건이 있는 날은 수기 등록 무시
    for (const rec of records) {
      if (leaveDays.has(`${rec.account_id}|${rec.work_date}`)) continue;
      const amount = recordDeduction(statusMap[rec.status]);
      if (amount > 0) push(rec.account_id, rec.work_date, amount, `${rec.status} (근태)`);
    }
    return m;
  }, [leaves, records, statusMap, isOffDay, loadFrom, loadTo]);

  const daily = useMemo(() => buildDailyHours({
    employees: yearEmployees, from: loadFrom, to: loadTo, today, isOffDay,
    employed: (e, k) => inPeriods(employmentPeriods.get(e.id), k),
    onLoa: (e, k) => inPeriods(loaPeriods.get(e.id), k),
    leaveUse, overtime, duty: rosterToEntries(roster),
  }), [yearEmployees, loadFrom, loadTo, today, isOffDay, employmentPeriods, loaPeriods, leaveUse, overtime, roster]);

  // ── 행 요약 ──
  const rows = useMemo(() => yearEmployees
    .filter(e => overlapsPeriods(employmentPeriods.get(e.id), periodFrom, periodTo))
    .map(e => {
      const row = daily.get(e.id);
      const weeks = periodWeeks.map(sun => ({ sun, total: weekTotal(row, sun) }));
      const months = periodMonths.map(m => ({ m, ...sumDays(row, ymd(year, m, 1), ymd(year, m, lastDay(year, m))) }));
      const totals = sumDays(row, periodFrom, periodTo);
      // 주평균: 기간에 귀속된 주 중 재직 기간과 겹치는 주의 평균 (입·퇴사 전후 주 제외)
      const weekAvg = (from: string, to: string) => {
        const ws = weeksOfPeriod(from, to).filter(sun => overlapsPeriods(employmentPeriods.get(e.id), sun, addDays(sun, 6)));
        const avg = ws.length ? ws.reduce((t, sun) => t + weekTotal(row, sun), 0) / ws.length : 0;
        return { avg: Math.round(avg * 10) / 10, weeks: ws.length };
      };
      const periodAvg = weekAvg(periodFrom, periodTo);
      const quarterAvgs = periodQuarters.map(q => ({ q, ...weekAvg(...quarterRange(year, q)) }));
      return {
        emp: e, weeks, months, totals, periodAvg, quarterAvgs,
        avgOver: [periodAvg, ...quarterAvgs].some(a => a.avg > WEEK_WARN_HOURS),
        warnWeeks: weeks.filter(w => hoursLevel(w.total) === "warn").length,
        overWeeks: weeks.filter(w => hoursLevel(w.total) === "over").length,
      };
    }), [yearEmployees, employmentPeriods, periodFrom, periodTo, daily, periodWeeks, periodMonths, periodQuarters, year]);

  const deptOptions = useMemo(() => Array.from(new Set(rows.map(r => r.emp.dept ?? "(미지정)"))), [rows]);
  const visibleRows = useMemo(() => {
    const q = search.trim();
    return rows.filter(r =>
      (!deptFilter || (r.emp.dept ?? "(미지정)") === deptFilter) &&
      (!q || empName(r.emp).includes(q)) &&
      (!onlyIssue || r.warnWeeks + r.overWeeks > 0 || r.avgOver));
  }, [rows, deptFilter, search, onlyIssue]);
  const avgOverRows = rows.filter(r => r.avgOver);
  const avgOverCount = avgOverRows.length;
  // 경고 문구용: 사원별 초과한 평균값 (연별은 연·분기 중 최댓값)
  const maxAvg = (r: (typeof rows)[number]) => Math.max(r.periodAvg.avg, ...r.quarterAvgs.map(a => a.avg));

  function move(delta: number) {
    let y = year, m = month, q = quarter;
    if (unit === "month") { const d = new Date(year, month - 1 + delta, 1); y = d.getFullYear(); m = d.getMonth() + 1; }
    else if (unit === "quarter") { q = quarter + delta; if (q < 1) { q = 4; y--; } if (q > 4) { q = 1; y++; } }
    else y = year + delta;
    if (y !== year) setLoading(true);
    setYear(y); setMonth(m); setQuarter(q);
  }

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  if (!canRead) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">시스템 관리자만 이용할 수 있습니다.</div>
      </div>
    );
  }

  const periodLabel = unit === "month" ? `${year}년 ${month}월` : unit === "quarter" ? `${year}년 ${quarter}분기` : `${year}년`;
  const btnCls = "px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700";
  const thCls = "border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 px-2 py-1.5 text-center text-gray-700 dark:text-gray-200 whitespace-nowrap";
  const tdCls = "border border-gray-200 dark:border-gray-600 px-2 py-1.5 text-center whitespace-nowrap text-gray-800 dark:text-gray-200";

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-50 dark:bg-gray-900">
      {/* 헤더 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">주52시간 관리</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          정규근무 + 승인 잔업보고서 + 근무표 당직·고장대기 · 주(일~토) {WEEK_WARN_HOURS}H 초과 경고 · {WEEK_LIMIT_HOURS}H(연장 12H 포함) 초과 위반 · 직급 전무 이상 제외
        </p>
      </div>

      {/* 탭 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 flex gap-1">
        {([["hours", "⏱️ 근무시간 현황"], ["roster", "🗓 근무표 등록"]] as ["hours" | "roster", string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${tab === t
              ? "border-blue-600 text-blue-700 dark:text-blue-300 font-semibold"
              : "border-transparent text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "roster" ? (
        <DutyRosterEditor candidates={yearEmployees} userId={user.id ?? null} onChanged={load} />
      ) : (<>
      {/* 툴바 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
          {([["month", "월별"], ["quarter", "분기별"], ["year", "연별"]] as [Unit, string][]).map(([u, label]) => (
            <button key={u} onClick={() => setUnit(u)}
              className={`px-3 py-1.5 text-sm ${unit === u ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 font-semibold" : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => move(-1)} className={btnCls}>◀</button>
          <span className="px-3 text-sm font-bold text-gray-900 dark:text-white min-w-[110px] text-center">{periodLabel}</span>
          <button onClick={() => move(1)} className={btnCls}>▶</button>
        </div>
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
          className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100">
          <option value="">전체 부서</option>
          {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="성명 검색"
          className="px-2 py-1.5 w-32 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
        <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={onlyIssue} onChange={e => setOnlyIssue(e.target.checked)} />
          초과자만
        </label>
        <div className="flex-1" />
        <span className="text-xs text-gray-600 dark:text-gray-300">대상 {rows.length}명</span>
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${LEVEL_CLS.over}`}>주평균 {WEEK_WARN_HOURS}H 초과 {avgOverCount}명</span>
      </div>

      {/* 기준 안내 */}
      <div className="px-6 py-2 text-[11px] text-gray-600 dark:text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
        <span>소정: 공사팀 07:00~16:00(8H) · 상주팀 08:30~18:30(9H) · 일반 08:30~17:30(8H)</span>
        {(Object.keys(DUTY_RULES) as DutyKind[]).map(k => (
          <span key={k}>{k} {DUTY_RULES[k].time} {DUTY_RULES[k].hours}H{DUTY_RULES[k].restNextDay ? "·익일퇴근" : ""}</span>
        ))}
        <span>잔업 익일 03시 이후 종료 시 종료일 13시 출근 · 06시 이후 종료 시 휴무</span>
      </div>

      {!loading && avgOverCount > 0 && (
        <div className="mx-6 mb-2 px-3 py-2 rounded border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-xs text-red-700 dark:text-red-300">
          <b>⚠ 주평균 {WEEK_WARN_HOURS}시간 초과 경고 ({avgOverCount}명)</b>
          <span className="ml-2">{avgOverRows.map(r => `${empName(r.emp)} ${fmtH(maxAvg(r))}H`).join(" · ")}</span>
        </div>
      )}
      {error && <div className="mx-6 mb-2 px-3 py-2 rounded bg-red-50 dark:bg-red-900/30 text-xs text-red-700 dark:text-red-300">불러오기 오류: {error}</div>}

      {/* 표 */}
      <div className="flex-1 min-h-0 overflow-auto px-6 pb-6">
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-500">불러오는 중…</div>
        ) : visibleRows.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">대상 사원이 없습니다.</div>
        ) : (
          <table className="border-separate border-spacing-0 text-xs bg-white dark:bg-gray-800">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className={`${thCls} sticky left-0 z-30 min-w-[80px]`}>성명</th>
                {unit === "month"
                  ? monthCols.map(c => c.kind === "day" ? (
                      <th key={c.key} title={c.holiday ?? undefined}
                        className={`border border-gray-200 dark:border-gray-600 w-9 min-w-[36px] py-1 font-semibold
                          ${c.off ? "bg-red-200 dark:bg-red-900/60" : "bg-gray-100 dark:bg-gray-700"}
                          ${c.dow === 0 || c.holiday ? "text-red-600 dark:text-red-400" : c.dow === 6 ? "text-blue-600 dark:text-blue-400" : "text-gray-700 dark:text-gray-200"}`}>
                        <div>{c.d}</div>
                        <div className="text-[10px] font-normal">{DOW_KR[c.dow]}</div>
                      </th>
                    ) : (
                      <th key={`w-${c.sun}`} className={`${thCls} bg-gray-200 dark:bg-gray-600`}>
                        <div>주계</div>
                        <div className="text-[10px] font-normal">{shortMd(c.sun)}~{shortMd(addDays(c.sun, 6))}</div>
                      </th>
                    ))
                  : periodMonths.map(m => <th key={m} className={thCls}>{m}월</th>)}
                {["정규", "잔업", "당직", "합계",
                  unit === "year" ? "연 주평균" : "주평균", ...periodQuarters.map(q => `${q}분기 주평균`)].map(h => (
                  <th key={h} className={thCls}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(r => (
                <tr key={r.emp.id} className="group">
                  <td className={`${tdCls} sticky left-0 z-10 bg-white dark:bg-gray-800 group-hover:bg-gray-50 dark:group-hover:bg-gray-700/60`}>
                    <button onClick={() => setDetail({ emp: r.emp, year, month: unit === "month" ? month : periodMonths[0] })}
                      className="font-semibold text-blue-700 dark:text-blue-300 hover:underline">
                      {empName(r.emp)}
                    </button>
                    {r.avgOver && (
                      <span title={`주평균 ${WEEK_WARN_HOURS}시간 초과`} className="ml-1 px-1 rounded bg-red-600 text-[10px] font-bold text-white">⚠ 초과</span>
                    )}
                  </td>
                  {unit === "month"
                    ? monthCols.map(c => {
                        const row = daily.get(r.emp.id);
                        if (c.kind === "week") {
                          const wk = weekTotal(row, c.sun);
                          return (
                            <td key={`w-${c.sun}`} className={`${tdCls} font-bold ${LEVEL_CLS[hoursLevel(wk)] || "bg-gray-100 dark:bg-gray-700/60"}`}>
                              {fmtH(wk) || 0}
                            </td>
                          );
                        }
                        const d = row?.get(c.key);
                        const label = dayLabel(d);
                        return (
                          <td key={c.key} title={[c.holiday, ...(d?.notes ?? [])].filter(Boolean).join("\n") || undefined}
                            onClick={() => setDetail({ emp: r.emp, year, month })}
                            className={`border border-gray-200 dark:border-gray-600 text-center p-0 h-9 cursor-pointer
                              hover:outline hover:outline-2 hover:outline-blue-400 hover:-outline-offset-2
                              ${c.off ? "bg-red-100 dark:bg-red-900/40" : ""}`}>
                            <span className={`text-[11px] ${label.cls}`}>{label.text}</span>
                          </td>
                        );
                      })
                    : r.months.map(m => (
                        <td key={m.m} className={`${tdCls} cursor-pointer hover:outline hover:outline-2 hover:outline-blue-400 hover:-outline-offset-2`}
                          onClick={() => setDetail({ emp: r.emp, year, month: m.m })}>
                          {fmtH(m.total)}
                        </td>
                      ))}
                  <td className={tdCls}>{fmtH(r.totals.regular)}</td>
                  <td className={tdCls}>{fmtH(r.totals.overtime)}</td>
                  <td className={tdCls}>{fmtH(r.totals.duty)}</td>
                  <td className={`${tdCls} font-bold`}>{fmtH(r.totals.total)}</td>
                  <td title={`${r.periodAvg.weeks}주 평균`}
                    className={`${tdCls} font-bold ${r.periodAvg.avg > WEEK_WARN_HOURS ? LEVEL_CLS.over : "bg-gray-50 dark:bg-gray-700/40"}`}>
                    {r.periodAvg.avg > WEEK_WARN_HOURS && "⚠ "}{fmtH(r.periodAvg.avg)}
                  </td>
                  {r.quarterAvgs.map(a => (
                    <td key={a.q} title={`${a.q}분기 ${a.weeks}주 평균`}
                      className={`${tdCls} font-bold ${a.avg > WEEK_WARN_HOURS ? LEVEL_CLS.over : "bg-gray-50 dark:bg-gray-700/40"}`}>
                      {a.avg > WEEK_WARN_HOURS && "⚠ "}{fmtH(a.avg)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </>)}

      {detail && (
        <DetailModal
          emp={detail.emp}
          year={detail.year}
          month={detail.month}
          row={daily.get(detail.emp.id)}
          holidays={holidays}
          inLoadedYear={detail.year === year}
          onMonth={(y, m) => setDetail({ ...detail, year: y, month: m })}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

// ── 사원 일자별 상세 ──────────────────────────────────────────
function DetailModal({ emp, year, month, row, holidays, inLoadedYear, onMonth, onClose }: {
  emp: Employee;
  year: number;
  month: number;
  row: Map<string, DayHours> | undefined;
  holidays: Map<string, string>;
  inLoadedYear: boolean;
  onMonth: (y: number, m: number) => void;
  onClose: () => void;
}) {
  const sched = deptSchedule(emp.dept);
  const from = ymd(year, month, 1);
  const to = ymd(year, month, lastDay(year, month));
  // 월에 걸친 주 전체를 보여 주간 합계가 정확히 보이게 한다
  const viewFrom = weekStart(from);
  const viewTo = addDays(weekStart(to), 6);
  const weeks: string[] = [];
  for (let k = viewFrom; k <= viewTo; k = addDays(k, 7)) weeks.push(k);
  const monthTotals = sumDays(row, from, to);
  const monthWeeks = weeksOfPeriod(from, to);
  const monthWeekAvg = monthWeeks.length ? monthWeeks.reduce((t, sun) => t + weekTotal(row, sun), 0) / monthWeeks.length : 0;

  const move = (delta: number) => { const d = new Date(year, month - 1 + delta, 1); onMonth(d.getFullYear(), d.getMonth() + 1); };
  const canMove = (delta: number) => new Date(year, month - 1 + delta, 1).getFullYear() === year;

  const cellCls = "border-r border-b border-gray-200 dark:border-gray-600 min-w-0";

  return (
    <DraggableModal open onClose={onClose} panelClassName="w-full max-w-5xl max-h-[90vh]"
      header={
        <div className="flex items-center gap-2 w-full">
          <span className="font-bold text-gray-900 dark:text-white">{empName(emp)}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{emp.dept ?? "-"} · {sched.label} {sched.time} ({sched.hours}H)</span>
          <div className="flex-1" />
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">✕</button>
        </div>
      }>
      <div className="p-4 overflow-auto max-h-[calc(90vh-60px)] text-xs">
        <div className="flex items-center gap-2 mb-3">
          <button disabled={!canMove(-1)} onClick={() => move(-1)} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 disabled:opacity-30">◀</button>
          <span className="font-bold text-sm text-gray-900 dark:text-white">{year}년 {month}월</span>
          <button disabled={!canMove(1)} onClick={() => move(1)} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 disabled:opacity-30">▶</button>
          <span className="ml-auto text-gray-600 dark:text-gray-300">
            월 합계 <b className="text-gray-900 dark:text-white">{fmtH(monthTotals.total) || 0}H</b>
            {" "}(정규 {fmtH(monthTotals.regular) || 0} · 잔업 {fmtH(monthTotals.overtime) || 0} · 당직 {fmtH(monthTotals.duty) || 0})
            {" "}· 주평균 <b className={monthWeekAvg > WEEK_WARN_HOURS ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}>
              {fmtH(Math.round(monthWeekAvg * 10) / 10) || 0}H
            </b> ({monthWeeks.length}주)
            {monthWeekAvg > WEEK_WARN_HOURS && (
              <span className="ml-1 px-1 rounded bg-red-600 text-[10px] font-bold text-white">⚠ {WEEK_WARN_HOURS}H 초과</span>
            )}
          </span>
        </div>
        {!inLoadedYear ? (
          <div className="py-8 text-center text-gray-500">조회 연도 밖입니다.</div>
        ) : (
          <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_88px] border-l border-t border-gray-200 dark:border-gray-600">
            {[...DOW_KR].map((w, i) => (
              <div key={w} className={`${cellCls} py-1 text-center font-semibold bg-gray-100 dark:bg-gray-700
                ${i === 0 ? "text-red-600 dark:text-red-400" : i === 6 ? "text-blue-600 dark:text-blue-400" : "text-gray-700 dark:text-gray-200"}`}>{w}</div>
            ))}
            <div className={`${cellCls} py-1 text-center font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200`}>주간 합계</div>
            {weeks.map(sun => {
              const wk = weekTotal(row, sun);
              const level = hoursLevel(wk);
              return [
                ...Array.from({ length: 7 }, (_, i) => {
                  const k = addDays(sun, i);
                  const d = row?.get(k);
                  const dt = parseKey(k);
                  const holiday = holidays.get(k);
                  const off = i === 0 || i === 6 || !!holiday;
                  const outside = k < from || k > to;
                  // 시간 내역(잔업·당직)은 숫자로 표시하므로 그 외 사유만 배지로
                  const badges = (d?.notes ?? []).filter(n => !/^잔업 [\d.]+H \(|당직 [\d.]+H|고장대기 [\d.]+H/.test(n));
                  return (
                    <div key={k} title={[holiday, ...(d?.notes ?? [])].filter(Boolean).join("\n") || undefined}
                      className={`${cellCls} min-h-[92px] p-1.5 flex flex-col gap-0.5
                        ${off ? "bg-red-50 dark:bg-red-900/20" : "bg-white dark:bg-gray-800"} ${outside ? "opacity-40" : ""}`}>
                      <div className="flex items-baseline gap-1">
                        <span className={`font-semibold ${i === 0 || holiday ? "text-red-600 dark:text-red-400" : i === 6 ? "text-blue-600 dark:text-blue-400" : "text-gray-700 dark:text-gray-200"}`}>
                          {outside ? `${dt.getMonth() + 1}/${dt.getDate()}` : dt.getDate()}
                        </span>
                        {holiday && <span className="truncate text-[10px] text-red-500 dark:text-red-400">{holiday}</span>}
                      </div>
                      {!!d?.total && <div className="text-base font-bold text-gray-900 dark:text-white leading-tight">{fmtH(d.total)}<span className="text-[10px] font-normal text-gray-500">H</span></div>}
                      <div className="text-[10px] leading-snug text-gray-600 dark:text-gray-300">
                        {!!d?.regular && <div>정규 {fmtH(d.regular)}</div>}
                        {!!d?.overtime && <div className="text-blue-700 dark:text-blue-300">잔업 {fmtH(d.overtime)}</div>}
                        {!!d?.duty && <div className="text-purple-700 dark:text-purple-300">당직 {fmtH(d.duty)}</div>}
                      </div>
                      {badges.map((n, j) => (
                        <span key={j} className="truncate rounded px-1 text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{n}</span>
                      ))}
                    </div>
                  );
                }),
                <div key={`${sun}-w`} className={`${cellCls} p-1.5 flex flex-col items-center justify-center gap-0.5 ${LEVEL_CLS[level] || "bg-gray-50 dark:bg-gray-700/40 text-gray-800 dark:text-gray-200"}`}>
                  <span className="text-base font-bold">{fmtH(wk) || 0}H</span>
                  {level === "over" && <span className="text-[10px] font-semibold">{WEEK_LIMIT_HOURS}H 초과</span>}
                  {level === "warn" && <span className="text-[10px] font-semibold">{WEEK_WARN_HOURS}H 초과</span>}
                </div>,
              ];
            })}
          </div>
        )}
      </div>
    </DraggableModal>
  );
}
