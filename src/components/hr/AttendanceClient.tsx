"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import {
  STATUS_DEFS, STATUS_MAP, EMPLOYEE_SELECT, LEAVE_SELECT, STATUS_HISTORY_TYPES,
  excludedRankSet, expandLeave, normalizeEmploymentDates, buildEmploymentPeriods, buildLoaPeriods,
  inPeriods, overlapsPeriods, empName, ymd, dateKey, pad2, addDays,
  type Kind, type Employee, type Rank, type LeaveRow, type AttendanceRecord, type StatusEvent,
} from "./attendanceShared";
import { DUTY_RULES, OVERTIME_SELECT, ROSTER_SELECT, overnightEffect, type OvertimeRow, type RosterRow } from "./workHoursCalc";

export const ATTENDANCE_MENU_HREF = "/hr/attendance";

const KIND_CLS: Record<Kind, string> = {
  leave:  "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200",
  off:    "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-200",
  absent: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200",
  late:   "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200",
  early:  "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200",
  work:   "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-200",
  extra:  "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-200",
  etc:    "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
};

const DUTY_REST_CLS = "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-200";

interface LeaveDay { type: string; amount: number; requestNo: string; }
interface CellInfo {
  leaves: LeaveDay[];          // 연차계 승인 건 (잠금)
  record: AttendanceRecord | null; // 수기 등록
  restReason: string | null;   // 휴무 사유 (주52시간 관리와 같은 규칙: 당직 다음날 퇴근, 야간 잔업 06시 이후 종료) — "휴무" 표시
  holidayWork: string[];       // 휴일 근무 (승인 잔업보고서·근무표 휴일당직/휴일고장대기) — "휴근" 표시
}

const fmtDays = (n: number) => (n === 0 ? "" : n % 1 === 0 ? String(n) : n.toFixed(1));

interface Summary {
  required: number; present: number; leave: number; off: number; loa: number; absent: number;
  late: number; early: number; work: number; etc: number;
}

export default function AttendanceClient() {
  const { user } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [deptFilter, setDeptFilter] = useState("");
  const [search, setSearch] = useState("");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map());
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [overtime, setOvertime] = useState<OvertimeRow[]>([]);
  const [statusEvents, setStatusEvents] = useState<StatusEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ emp: Employee; date: string; top: number; left: number } | null>(null);

  const canRead  = hasMenuPermission(user, ATTENDANCE_MENU_HREF, "read");
  const canWrite = hasMenuPermission(user, ATTENDANCE_MENU_HREF, "create") || hasMenuPermission(user, ATTENDANCE_MENU_HREF, "update");

  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStart = ymd(year, month, 1);
  const monthEnd   = ymd(year, month, daysInMonth);

  // setState 는 모두 await 이후에 호출 (effect 내 동기 setState 금지 규칙). 로딩 표시는 월 이동 시 켠다.
  const load = useCallback(async () => {
    const [accRes, rankRes, holRes, leaveRes, recRes, histRes, rosterRes, otRes] = await Promise.all([
      supabase.from("accounts").select(EMPLOYEE_SELECT),
      supabase.from("ranks").select("name,sort_order"),
      supabase.from("public_holidays").select("date,name").gte("date", monthStart).lte("date", monthEnd),
      supabase.from("leave_requests")
        .select(LEAVE_SELECT)
        .eq("approval_status", "approved"),
      supabase.from("attendance_records").select("id,account_id,work_date,status,note")
        .gte("work_date", monthStart).lte("work_date", monthEnd),
      supabase.from("user_status_history").select("user_id,status_type,event_date")
        .in("status_type", STATUS_HISTORY_TYPES).order("event_date"),
      // 전월 말일 당직 → 1일 퇴근까지 보도록 하루 앞부터
      supabase.from("work_duty_roster").select(ROSTER_SELECT)
        .gte("duty_date", addDays(monthStart, -1)).lte("duty_date", monthEnd),
      supabase.from("overtime_reports").select(OVERTIME_SELECT).eq("approval_status", "approved")
        .gte("start_at", `${addDays(monthStart, -1)}T00:00:00+09:00`).lte("start_at", `${monthEnd}T23:59:59+09:00`), // 전월 말일 야간 잔업 포함
    ]);
    const err = accRes.error || rankRes.error || holRes.error || leaveRes.error || recRes.error || histRes.error || rosterRes.error || otRes.error;
    setError(err ? err.message : null);
    setEmployees(((accRes.data ?? []) as Employee[]).map(normalizeEmploymentDates));
    setRanks((rankRes.data ?? []) as Rank[]);
    setHolidays(new Map(((holRes.data ?? []) as { date: string; name: string }[]).map(h => [h.date, h.name])));
    setLeaves((leaveRes.data ?? []) as LeaveRow[]);
    setRecords((recRes.data ?? []) as AttendanceRecord[]);
    setStatusEvents((histRes.data ?? []) as StatusEvent[]);
    setRoster((rosterRes.data ?? []) as RosterRow[]);
    setOvertime((otRes.data ?? []) as OvertimeRow[]);
    setLoading(false);
  }, [monthStart, monthEnd]);

  // 월 변경 시 Supabase 재조회 (외부 시스템 동기화 — setState 는 await 이후에만 발생)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canRead) load(); }, [load, canRead]);
  useReloadOnActivate(() => { if (canRead) load(); });

  // ── 일자 정보 ──
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    const key = ymd(year, month, d);
    const dow = new Date(year, month - 1, d).getDay();
    const holiday = holidays.get(key) ?? null;
    return { d, key, dow, holiday, off: dow === 0 || dow === 6 || !!holiday };
  }), [year, month, daysInMonth, holidays]);

  // 공휴일은 해당 월만 조회하므로, 월 밖 날짜는 주말만 판정 (월 밖 사용량은 화면에 쓰이지 않음)
  const isOffDay = useCallback((key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    return dow === 0 || dow === 6 || holidays.has(key);
  }, [holidays]);

  // ── 대상 사원: 전무 이상 제외, 재직기간이 해당 월과 겹치는 사원 ──
  const excludedRanks = useMemo(() => excludedRankSet(ranks), [ranks]);

  const employmentPeriods = useMemo(() => buildEmploymentPeriods(employees, statusEvents), [statusEvents, employees]);

  const inEmployment = useCallback((e: Employee, key: string) =>
    inPeriods(employmentPeriods.get(e.id), key), [employmentPeriods]);

  const targetEmployees = useMemo(() => employees
    .filter(e => !(e.rank && excludedRanks.has(e.rank)))
    .filter(e => overlapsPeriods(employmentPeriods.get(e.id), monthStart, monthEnd))
    .sort((a, b) => empName(a).localeCompare(empName(b), "ko")),
  [employees, excludedRanks, employmentPeriods, monthStart, monthEnd]);

  const deptOptions = useMemo(
    () => Array.from(new Set(targetEmployees.map(e => e.dept ?? "(미지정)"))),
    [targetEmployees]);

  const visibleEmployees = useMemo(() => {
    const q = search.trim();
    return targetEmployees.filter(e =>
      (!deptFilter || (e.dept ?? "(미지정)") === deptFilter) &&
      (!q || empName(e).includes(q)));
  }, [targetEmployees, deptFilter, search]);

  // ── 셀 데이터: account_id → date → CellInfo ──
  const cells = useMemo(() => {
    const m = new Map<number, Map<string, CellInfo>>();
    const get = (id: number, date: string) => {
      let row = m.get(id);
      if (!row) { row = new Map(); m.set(id, row); }
      let c = row.get(date);
      if (!c) { c = { leaves: [], record: null, restReason: null, holidayWork: [] }; row.set(date, c); }
      return c;
    };
    for (const r of leaves) {
      for (const { date, amount } of expandLeave(r, isOffDay)) {
        if (date < monthStart || date > monthEnd) continue;
        get(r.author_id, date).leaves.push({ type: r.leave_type, amount, requestNo: r.request_no });
      }
    }
    for (const rec of records) get(rec.account_id, rec.work_date).record = rec;
    for (const r of roster) {
      if (!DUTY_RULES[r.duty_type]?.restNextDay) continue;
      const next = addDays(r.duty_date.slice(0, 10), 1);
      if (next < monthStart || next > monthEnd) continue;
      const [, m, d] = r.duty_date.slice(0, 10).split("-").map(Number);
      get(r.account_id, next).restReason = `${m}/${d} ${r.duty_type} 후 퇴근 (근무표)`;
    }
    const nameToId = new Map(employees.map(e => [empName(e), e.id]));
    for (const r of overtime) {
      const night = overnightEffect(r.start_at, r.end_at);
      if (night?.effect !== "rest" || night.endDay < monthStart || night.endDay > monthEnd) continue;
      for (const w of r.workers ?? []) {
        const id = nameToId.get(w.trim());
        if (id != null) get(id, night.endDay).restReason ??= `야간 잔업 ${night.endHm} 종료 휴무 (${r.report_no})`;
      }
    }
    // 휴일 근무: 토·일·공휴일의 근무표 휴일당직·휴일고장대기, 승인 잔업보고서 작업자
    for (const r of roster) {
      const date = r.duty_date.slice(0, 10);
      if (date < monthStart || !isOffDay(date)) continue;
      get(r.account_id, date).holidayWork.push(`${r.duty_type} (근무표)`);
    }
    const byName = new Map(employees.map(e => [empName(e), e.id]));
    for (const r of overtime) {
      const date = dateKey(new Date(r.start_at));
      if (date < monthStart || date > monthEnd || !isOffDay(date)) continue;
      const hours = Number(r.work_hours) || 0;
      for (const w of r.workers ?? []) {
        const id = byName.get(w.trim());
        if (id != null) get(id, date).holidayWork.push(`휴일 잔업 ${hours}H (${r.report_no})`);
      }
    }
    return m;
  }, [leaves, records, roster, overtime, employees, isOffDay, monthStart, monthEnd]);

  const loaPeriods = useMemo(() => buildLoaPeriods(employees, statusEvents), [statusEvents, employees]);

  const onLoa = useCallback((e: Employee, key: string) =>
    inPeriods(loaPeriods.get(e.id), key), [loaPeriods]);

  const summarize = useCallback((e: Employee): Summary => {
    const s: Summary = { required: 0, present: 0, leave: 0, off: 0, loa: 0, absent: 0, late: 0, early: 0, work: 0, etc: 0 };
    const row = cells.get(e.id);
    for (const day of days) {
      if (!inEmployment(e, day.key)) continue;
      if (onLoa(e, day.key)) { if (!day.off) s.loa++; continue; } // 휴직일은 소정근무일에서 제외
      if (!day.off) s.required++;
      const c = row?.get(day.key);
      if (!c) continue;
      const entries: { kind: Kind; amount: number }[] = c.leaves.length
        ? c.leaves.filter(l => l.amount > 0).map(l => ({ kind: STATUS_MAP[l.type]?.kind ?? "etc", amount: l.amount }))
        : c.record ? [{ kind: STATUS_MAP[c.record.status]?.kind ?? "etc", amount: c.record.status === "반차" ? 0.5 : 1 }] : [];
      for (const { kind, amount } of entries) {
        switch (kind) {
          case "leave":  if (!day.off) s.leave += amount; break;
          case "off":    if (!day.off) s.off += amount; break;
          case "absent": if (!day.off) s.absent += amount; break;
          case "late":   s.late++; break;
          case "early":  s.early++; break;
          case "work":   s.work++; break;
          case "extra":  break; // 특근은 합계 표시하지 않음
          default:       s.etc++;
        }
      }
    }
    s.present = Math.max(0, s.required - s.leave - s.off - s.absent);
    return s;
  }, [cells, days, inEmployment, onLoa]);

  function moveMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setEditing(null);
    setLoading(true);
  }

  function openCell(ev: React.MouseEvent, emp: Employee, date: string) {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const width = 300;
    setEditing({
      emp, date,
      top: Math.min(rect.bottom + 4, window.innerHeight - 340),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
    });
  }

  async function saveRecord(emp: Employee, date: string, status: string, note: string) {
    if (!user) return;
    const { error } = await supabase.from("attendance_records").upsert({
      account_id: emp.id, work_date: date, status, note: note.trim() || null,
      created_by: user.id, updated_at: new Date().toISOString(),
    }, { onConflict: "account_id,work_date" });
    if (error) { alert(`저장 실패: ${error.message}`); return; }
    setEditing(null);
    load();
  }

  async function deleteRecord(rec: AttendanceRecord) {
    const { error } = await supabase.from("attendance_records").delete().eq("id", rec.id);
    if (error) { alert(`삭제 실패: ${error.message}`); return; }
    setEditing(null);
    load();
  }

  function printMonth() {
    const w = window.open("", "_blank", "width=1200,height=800");
    if (!w) { alert("팝업이 차단되었습니다. 팝업을 허용해 주세요."); return; }
    const esc = (v: string) => v.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
    const dayHead = days.map(d =>
      `<th class="${d.off ? "off" : ""}">${d.d}<br/><span>${"일월화수목금토"[d.dow]}</span></th>`).join("");
    const body = visibleEmployees.map((e, i) => {
      const row = cells.get(e.id);
      const tds = days.map(d => {
        if (!inEmployment(e, d.key)) return `<td class="na"></td>`;
        if (onLoa(e, d.key)) return `<td class="loa">휴직</td>`;
        const c = row?.get(d.key);
        let t = "";
        const realLeave = c?.leaves.some(l => l.amount > 0);
        if (d.off && c?.holidayWork.length && !c.record && !realLeave) t = "휴근";
        else if (c?.leaves.length) t = c.leaves.map(l => (STATUS_MAP[l.type]?.short ?? l.type[0]) + (l.amount > 0 && l.amount < 1 ? "½" : "")).join("");
        else if (c?.record) t = STATUS_MAP[c.record.status]?.short ?? c.record.status[0];
        else if (c?.restReason && !d.off) t = "휴무";
        return `<td class="${d.off ? "off" : ""}">${esc(t)}</td>`;
      }).join("");
      const s = summarize(e);
      return `<tr><td>${i + 1}</td><td class="nm">${esc(empName(e))}</td>${tds}` +
        [s.required, s.present, s.leave, s.off, s.loa, s.absent, s.late, s.early, s.work].map(v => `<td class="sum">${fmtDays(v)}</td>`).join("") + `</tr>`;
    }).join("");
    const legend = STATUS_DEFS.map(s => `${s.short}:${s.key}`).join(" · ");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>근태현황 ${year}-${pad2(month)}</title>
<style>
@page { size: A4 landscape; margin: 8mm; }
body { font-family: 'Malgun Gothic','맑은 고딕',sans-serif; color:#000; margin:0; }
h1 { font-size: 14pt; text-align:center; margin: 0 0 2mm; }
.meta { display:flex; justify-content:space-between; font-size:8pt; margin-bottom:2mm; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 7pt; }
th, td { border: 1px solid #555; text-align:center; padding: 1px 0; height: 14px; overflow:hidden; white-space:nowrap; }
th { background:#eee; font-weight:bold; } th span { font-weight:normal; }
.off { background:#f8c8c8; } .na { background: repeating-linear-gradient(45deg,#fff,#fff 2px,#ddd 2px,#ddd 3px); }
.loa { background:#e5e7eb; font-size:6pt; color:#444; } .nm { font-weight:bold; } .sum { background:#fafafa; font-weight:bold; }
col.c-no { width: 18px; } col.c-nm { width: 44px; } col.c-sum { width: 22px; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style></head><body>
<h1>${year}년 ${month}월 근태현황</h1>
<div class="meta"><span>${esc(legend)} · ½:반일</span><span>출력: ${esc(dateKey(new Date()))}</span></div>
<table><colgroup><col class="c-no"/><col class="c-nm"/>${days.map(() => "<col/>").join("")}${"<col class=\"c-sum\"/>".repeat(9)}</colgroup>
<thead><tr><th>No</th><th>성명</th>${dayHead}<th>소정</th><th>출근</th><th>연차</th><th>휴가</th><th>휴직</th><th>결근</th><th>지각</th><th>조퇴</th><th>출장<br/>교육</th></tr></thead>
<tbody>${body}</tbody></table>
<script>window.onload = () => { window.print(); };</script>
</body></html>`);
    w.document.close();
  }

  // ── 렌더 ──
  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  if (!canRead) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">근태현황 메뉴 권한이 필요합니다.</div>
      </div>
    );
  }

  const todayKey = dateKey(new Date());
  const editCell = editing ? cells.get(editing.emp.id)?.get(editing.date) : undefined;

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-50 dark:bg-gray-900">
      {/* 헤더 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">근태현황</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          월별 근태 등록·관리 · 연차계 승인 건 자동 반영 · 직급 전무 이상 제외
        </p>
      </div>

      {/* 툴바 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button onClick={() => moveMonth(-1)} className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">◀</button>
          <span className="px-3 text-sm font-bold text-gray-900 dark:text-white min-w-[110px] text-center">{year}년 {month}월</span>
          <button onClick={() => moveMonth(1)} className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">▶</button>
          <button onClick={() => { moveMonth((now.getFullYear() - year) * 12 + (now.getMonth() + 1 - month)); }}
            className="ml-1 px-2.5 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">이번달</button>
        </div>
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
          className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100">
          <option value="">전체 부서</option>
          {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="성명 검색"
          className="px-2 py-1.5 w-32 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
        <span className="text-xs text-gray-500 dark:text-gray-400">{visibleEmployees.length}명</span>
        <div className="flex-1" />
        <button onClick={printMonth} disabled={loading}
          className="px-3 py-1.5 rounded bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-semibold disabled:opacity-50">🖨 인쇄</button>
      </div>

      {/* 범례 */}
      <div className="px-6 py-2 flex flex-wrap gap-1.5 text-[11px] text-gray-600 dark:text-gray-300">
        {STATUS_DEFS.map(s => (
          <span key={s.key} className={`px-1.5 py-0.5 rounded ${KIND_CLS[s.kind]}`}>{s.short} {s.key}</span>
        ))}
        <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300">휴직</span>
        <span className={`px-1.5 py-0.5 rounded ${DUTY_REST_CLS}`}>휴무 당직 후 퇴근·야간 잔업</span>
        <span className={`px-1.5 py-0.5 rounded ${KIND_CLS.extra}`}>휴근 휴일 근무</span>
        <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">휴일 (토·일·공휴일·대체휴일)</span>
        {!canWrite && <span className="ml-2 text-gray-400">· 조회 전용</span>}
      </div>

      {error && <div className="mx-6 mb-2 px-3 py-2 rounded bg-red-50 dark:bg-red-900/30 text-xs text-red-700 dark:text-red-300">불러오기 오류: {error}</div>}

      {/* 매트릭스 */}
      <div className="flex-1 min-h-0 overflow-auto px-6 pb-6">
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-500">불러오는 중…</div>
        ) : visibleEmployees.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">대상 사원이 없습니다.</div>
        ) : (
          <table className="border-separate border-spacing-0 text-xs bg-white dark:bg-gray-800">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 px-2 py-1.5 text-center text-gray-700 dark:text-gray-200 min-w-[90px]">성명</th>
                {days.map(d => (
                  <th key={d.key} title={d.holiday ?? undefined}
                    className={`border border-gray-200 dark:border-gray-600 w-8 min-w-[32px] py-1 font-semibold
                      ${d.key === todayKey ? "bg-yellow-100 dark:bg-yellow-900/40" : d.off ? "bg-red-200 dark:bg-red-900/60" : "bg-gray-100 dark:bg-gray-700"}
                      ${d.dow === 0 || d.holiday ? "text-red-600 dark:text-red-400" : d.dow === 6 ? "text-blue-600 dark:text-blue-400" : "text-gray-700 dark:text-gray-200"}`}>
                    <div>{d.d}</div>
                    <div className="text-[10px] font-normal">{"일월화수목금토"[d.dow]}</div>
                  </th>
                ))}
                {["소정", "출근", "연차", "휴가", "휴직", "결근", "지각", "조퇴", "출장·교육", "기타"].map(h => (
                  <th key={h} className="border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 px-1.5 py-1 text-gray-700 dark:text-gray-200 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.map(e => {
                const row = cells.get(e.id);
                const s = summarize(e);
                return (
                  <tr key={e.id} className="group">
                    <td className="sticky left-0 z-10 bg-white dark:bg-gray-800 group-hover:bg-gray-50 dark:group-hover:bg-gray-700/60 border border-gray-200 dark:border-gray-600 px-2 py-1 text-center whitespace-nowrap">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{empName(e)}</span>
                      {e.status && e.status !== "재직" && (
                        <span className="ml-1 px-1 rounded bg-amber-100 dark:bg-amber-900/50 text-[10px] text-amber-700 dark:text-amber-300">{e.status}</span>
                      )}
                    </td>
                    {days.map(d => {
                      const active = inEmployment(e, d.key);
                      if (active && onLoa(e, d.key)) {
                        return (
                          <td key={d.key} title="휴직" className="border border-gray-200 dark:border-gray-600 text-center p-0 h-9 bg-slate-200 dark:bg-slate-700/60">
                            <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">휴직</span>
                          </td>
                        );
                      }
                      const c = row?.get(d.key);
                      // 휴근: 휴일 근무가 있으면 (실사용 연차·수기 등록이 없을 때) 휴일에 걸친 연차 표시보다 우선
                      const holidayWork = d.off && !!c?.holidayWork.length && !c.record && !c.leaves.some(l => l.amount > 0);
                      const leave = holidayWork ? undefined : c?.leaves[0];
                      const def = leave ? STATUS_MAP[leave.type] : c?.record ? STATUS_MAP[c.record.status] : undefined;
                      const restReason = !leave && !c?.record && !d.off ? c?.restReason ?? null : null;
                      const label = leave
                        ? (def?.short ?? leave.type[0]) + (leave.amount > 0 && leave.amount < 1 ? "½" : "")
                        : c?.record ? (def?.short ?? c.record.status[0]) : holidayWork ? "휴근" : restReason ? "휴무" : "";
                      const title = leave
                        ? c!.leaves.map(l => `${l.type} ${l.amount ? `${l.amount}일` : "(휴일·미공제)"} (${l.requestNo})`).join("\n") + "\n연차계 승인 건"
                        : c?.record ? `${c.record.status}${c.record.note ? ` - ${c.record.note}` : ""}`
                        : holidayWork ? `휴일 근무\n${c!.holidayWork.join("\n")}`
                        : restReason ? `휴무 — ${restReason}` : d.holiday ?? undefined;
                      const clickable = active && (canWrite || !!leave || !!c?.record);
                      return (
                        <td key={d.key} title={title}
                          onClick={clickable ? ev => openCell(ev, e, d.key) : undefined}
                          className={`border border-gray-200 dark:border-gray-600 text-center p-0 h-9
                            ${!active ? "bg-gray-100 dark:bg-gray-900 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(128,128,128,0.15)_3px,rgba(128,128,128,0.15)_4px)]"
                              : d.off ? "bg-red-100 dark:bg-red-900/40" : ""}
                            ${clickable ? "cursor-pointer hover:outline hover:outline-2 hover:outline-blue-400 hover:-outline-offset-2" : ""}`}>
                          {label && (
                            <span className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-0.5 rounded text-[11px] font-bold
                              ${holidayWork ? KIND_CLS.extra : restReason ? DUTY_REST_CLS : KIND_CLS[def?.kind ?? "etc"]} ${leave && leave.amount === 0 ? "opacity-50" : ""}
                              ${c?.record?.note && !leave ? "underline decoration-dotted" : ""}`}>
                              {label}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    {[s.required, s.present, s.leave, s.off, s.loa, s.absent, s.late, s.early, s.work, s.etc].map((v, i) => (
                      <td key={i} className={`border border-gray-200 dark:border-gray-600 px-1.5 text-center font-semibold whitespace-nowrap
                        ${i === 1 ? "text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/40" : "text-gray-700 dark:text-gray-300"}
                        ${i === 5 && v > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                        {fmtDays(v)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && typeof document !== "undefined" && createPortal(
        <CellEditor
          emp={editing.emp}
          date={editing.date}
          top={editing.top}
          left={editing.left}
          cell={editCell}
          canWrite={canWrite}
          onClose={() => setEditing(null)}
          onSave={(status, note) => saveRecord(editing.emp, editing.date, status, note)}
          onDelete={rec => deleteRecord(rec)}
        />,
        document.body,
      )}
    </div>
  );
}

// ── 셀 편집 팝오버 ───────────────────────────────────────────
function CellEditor({ emp, date, top, left, cell, canWrite, onClose, onSave, onDelete }: {
  emp: Employee;
  date: string;
  top: number;
  left: number;
  cell: CellInfo | undefined;
  canWrite: boolean;
  onClose: () => void;
  onSave: (status: string, note: string) => void;
  onDelete: (rec: AttendanceRecord) => void;
}) {
  const record = cell?.record ?? null;
  const locked = !!cell?.leaves.length;
  const [status, setStatus] = useState(record?.status ?? "");
  const [note, setNote] = useState(record?.note ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [y, m, d] = date.split("-").map(Number);
  const dow = "일월화수목금토"[new Date(y, m - 1, d).getDay()];

  return (
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div style={{ top, left, width: 300 }}
        className="fixed z-[9999] rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-xl p-3 text-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-gray-900 dark:text-white">{empName(emp)} <span className="font-normal text-gray-500 dark:text-gray-400">· {m}/{d}({dow})</span></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">✕</button>
        </div>

        {locked ? (
          <div className="space-y-1.5">
            {cell!.leaves.map((l, i) => (
              <div key={i} className="px-2 py-1.5 rounded bg-blue-50 dark:bg-blue-900/30 text-xs text-blue-800 dark:text-blue-200">
                <b>{l.type}</b> {l.amount ? `${l.amount}일` : "휴일(미공제)"} · {l.requestNo}
              </div>
            ))}
            <p className="text-xs text-gray-500 dark:text-gray-400">연차계 승인 건입니다. 수정·취소는 연차계에서 하세요.</p>
          </div>
        ) : !canWrite ? (
          <div className="text-xs text-gray-700 dark:text-gray-300">
            {record ? <><b>{record.status}</b>{record.note && <> · {record.note}</>}</> : "등록된 근태가 없습니다."}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-1 mb-2">
              {STATUS_DEFS.map(s => (
                <button key={s.key} onClick={() => setStatus(s.key)}
                  className={`py-1.5 rounded text-xs font-semibold border
                    ${status === s.key ? "border-blue-600 ring-2 ring-blue-500/40 " + KIND_CLS[s.kind] : "border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"}`}>
                  {s.key}
                </button>
              ))}
            </div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="비고 (선택)"
              onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing && status) { setSaving(true); onSave(status, note); } }}
              className="w-full px-2 py-1.5 mb-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
            <div className="flex gap-2">
              {record && (
                <button onClick={() => { if (confirm("이 근태 기록을 삭제할까요?")) { setSaving(true); onDelete(record); } }} disabled={saving}
                  className="px-3 py-1.5 rounded border border-red-300 dark:border-red-700 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50">삭제</button>
              )}
              <div className="flex-1" />
              <button onClick={onClose} className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-xs text-gray-700 dark:text-gray-200">취소</button>
              <button onClick={() => { setSaving(true); onSave(status, note); }} disabled={!status || saving}
                className="px-3 py-1.5 rounded bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">저장</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
