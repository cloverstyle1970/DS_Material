"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import DraggableModal from "@/components/common/DraggableModal";
import {
  DOW_KR, LEAVE_SELECT, addDays, dateKey, empName, expandLeave, parseKey, ymd,
  type Employee, type LeaveRow,
} from "./attendanceShared";
import { downloadTemplate, parseRosterFile, type ParseResult } from "./dutyRosterExcel";
import DutyChangePanel, { type SwapCheck } from "./DutyChangePanel";
import {
  DUTY_KINDS, DUTY_RULES, OVERTIME_SELECT, ROSTER_SELECT, consecutiveDuties, weekStart,
  type DutyKind, type OvertimeRow, type RosterRow,
} from "./workHoursCalc";

const KIND_CLS: Record<DutyKind, string> = {
  평일당직:     "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-200",
  휴일당직:     "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-200",
  고장대기:     "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200",
  휴일고장대기: "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-200",
  야간점검:     "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};
const LEAVE_CLS = "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200";
const OT_CLS = "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200";
const KIND_SHORT: Record<DutyKind, string> = { 평일당직: "평당", 휴일당직: "휴당", 고장대기: "고대", 휴일고장대기: "휴고", 야간점검: "야점" };

const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

// 월 근무표 등록 (주52시간 관리 > 근무표 등록 탭). 저장 후 onChanged 로 상위 근무시간 재계산.
// canEdit=false(조회 권한만): 근무표 보기 + 근무변경요청만 가능
export default function DutyRosterEditor({ candidates, userId, me, canEdit, checkSwap, onChanged }: {
  candidates: Employee[];
  userId: number | null;
  me: { id: number; name: string };
  canEdit: boolean;
  checkSwap: (from: RosterRow, to: RosterRow) => SwapCheck;
  onChanged: () => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [overtime, setOvertime] = useState<OvertimeRow[]>([]);
  const [showActual, setShowActual] = useState(true); // 승인 연차·잔업 함께 표시
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null); // 추가 중인 일자
  const [editing, setEditing] = useState<RosterRow | null>(null); // 수정 중인 근무
  const [upload, setUpload] = useState<ParseResult | null>(null); // 엑셀·PDF 업로드 미리보기
  const fileRef = useRef<HTMLInputElement>(null);

  const from = ymd(year, month, 1);
  const to = ymd(year, month, lastDay(year, month));

  // setState 는 await 이후에만 호출
  const load = useCallback(async () => {
    const [rRes, hRes, lRes, oRes] = await Promise.all([
      supabase.from("work_duty_roster").select(ROSTER_SELECT).gte("duty_date", from).lte("duty_date", to).order("id"),
      supabase.from("public_holidays").select("date,name").gte("date", from).lte("date", to),
      supabase.from("leave_requests").select(LEAVE_SELECT).eq("approval_status", "approved"),
      supabase.from("overtime_reports").select(OVERTIME_SELECT).eq("approval_status", "approved")
        .gte("start_at", `${from}T00:00:00+09:00`).lte("start_at", `${to}T23:59:59+09:00`),
    ]);
    if (rRes.error) alert(`근무표 불러오기 실패: ${rRes.error.message}`);
    setRoster((rRes.data ?? []) as RosterRow[]);
    setLeaves((lRes.data ?? []) as LeaveRow[]);
    setOvertime((oRes.data ?? []) as OvertimeRow[]);
    setHolidays(new Map(((hRes.data ?? []) as { date: string; name: string }[]).map(h => [h.date, h.name])));
    setLoading(false);
  }, [from, to]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => new Map(candidates.map(e => [e.id, e])), [candidates]);

  // 일자별 승인 연차계(사용일만, 휴일 제외) · 승인 잔업보고서(시작일 기준) — 주52시간 계산과 같은 기준
  const actual = useMemo(() => {
    const isOffDay = (key: string) => { const w = parseKey(key).getDay(); return w === 0 || w === 6 || holidays.has(key); };
    const leaveMap = new Map<string, { id: number; label: string }[]>();
    for (const r of leaves) {
      if (!byId.has(r.author_id)) continue;
      for (const { date, amount } of expandLeave(r, isOffDay)) {
        if (date < from || date > to || amount <= 0) continue;
        leaveMap.set(date, [...(leaveMap.get(date) ?? []), { id: r.author_id, label: `${r.leave_type}${amount < 1 ? "½" : ""}` }]);
      }
    }
    const byName = new Map(candidates.map(e => [empName(e), e.id]));
    const otMap = new Map<string, { id: number; hours: number; no: string }[]>();
    for (const r of overtime) {
      const date = dateKey(new Date(r.start_at));
      const hours = Number(r.is_holiday ? r.work_hours : r.overtime_hours) || 0;
      for (const w of r.workers ?? []) {
        const id = byName.get(w.trim());
        if (id != null) otMap.set(date, [...(otMap.get(date) ?? []), { id, hours, no: r.report_no }]);
      }
    }
    return { leaveMap, otMap };
  }, [leaves, overtime, holidays, byId, candidates, from, to]);
  const byDate = useMemo(() => {
    const m = new Map<string, RosterRow[]>();
    for (const r of roster) m.set(r.duty_date, [...(m.get(r.duty_date) ?? []), r]);
    return m;
  }, [roster]);

  function move(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear()); setMonth(d.getMonth() + 1);
    setLoading(true);
  }

  async function afterWrite() {
    await load();
    onChanged();
  }

  async function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const res = await parseRosterFile(file, { year, month }, candidates, async (y, m) => {
        const { data } = await supabase.from("public_holidays").select("date")
          .gte("date", ymd(y, m, 1)).lte("date", ymd(y, m, lastDay(y, m)));
        return new Set(((data ?? []) as { date: string }[]).map(h => h.date));
      });
      setUpload(res);
    } catch (e) {
      alert(`파일을 읽을 수 없습니다: ${e instanceof Error ? e.message : e}`);
    }
    setBusy(false);
  }

  // 업로드 저장: replace=해당 월 근무표 전체 교체, 아니면 기존에 추가(중복 무시)
  async function saveUpload(res: ParseResult, replace: boolean) {
    const f = ymd(res.year, res.month, 1);
    const t = ymd(res.year, res.month, lastDay(res.year, res.month));
    setBusy(true);
    const ids = [...new Set(res.entries.map(e => e.account_id))];
    const { data: near } = await supabase.from("work_duty_roster").select(ROSTER_SELECT)
      .in("account_id", ids).gte("duty_date", addDays(f, -1)).lte("duty_date", addDays(t, 1));
    const kept = ((near ?? []) as RosterRow[]).filter(r => !replace || r.duty_date.slice(0, 10) < f || r.duty_date.slice(0, 10) > t);
    const bad = consecutiveDuties([...kept, ...res.entries], ids);
    if (bad.length) {
      setBusy(false);
      alert(`당직 다음날 근무 배정이 있어 저장할 수 없습니다.\n${bad.map(b => `${res.entries.find(e => e.account_id === b.accountId)?.name ?? `#${b.accountId}`} ${b.first.slice(5)}·${b.second.slice(5)}`).join("\n")}`);
      return;
    }
    if (replace) {
      const { error } = await supabase.from("work_duty_roster").delete().gte("duty_date", f).lte("duty_date", t);
      if (error) { alert(`기존 근무표 삭제 실패: ${error.message}`); setBusy(false); return; }
    }
    const { error } = await supabase.from("work_duty_roster").upsert(
      res.entries.map(e => ({ duty_date: e.duty_date, account_id: e.account_id, duty_type: e.duty_type, created_by: userId })),
      { onConflict: "duty_date,account_id,duty_type", ignoreDuplicates: true });
    setBusy(false);
    if (error) { alert(`저장 실패: ${error.message}`); return; }
    setUpload(null);
    if (res.year !== year || res.month !== month) {
      setYear(res.year); setMonth(res.month); setLoading(true); // 이동한 월은 effect 가 다시 불러옴
      onChanged();
    } else {
      afterWrite();
    }
  }

  async function clearMonth() {
    if (!roster.length) return;
    if (!confirm(`${year}년 ${month}월 근무표 ${roster.length}건을 모두 삭제할까요?\n삭제하면 이 달 당직·대기 시간은 0으로 계산됩니다.`)) return;
    setBusy(true);
    const { error } = await supabase.from("work_duty_roster").delete().gte("duty_date", from).lte("duty_date", to);
    if (error) alert(`삭제 실패: ${error.message}`);
    setBusy(false);
    afterWrite();
  }

  // 당직 후 연속근무 검사: 대상 사원들의 앞뒤 하루 근무를 DB 에서 확인 (월 경계 포함). 위반 문구 반환
  async function consecutiveViolations(date: string, kind: DutyKind, ids: number[], excludeId?: number): Promise<string[]> {
    if (!ids.length) return [];
    const { data } = await supabase.from("work_duty_roster").select(ROSTER_SELECT)
      .in("account_id", ids).gte("duty_date", addDays(date, -1)).lte("duty_date", addDays(date, 1));
    const rows = ((data ?? []) as RosterRow[]).filter(r => r.id !== excludeId);
    const all = [...rows, ...ids.map(id => ({ account_id: id, duty_date: date, duty_type: kind }))];
    return consecutiveDuties(all, ids, [date]).map(c => {
      const e = byId.get(c.accountId);
      return `${e ? empName(e) : `#${c.accountId}`} ${c.first.slice(5)}·${c.second.slice(5)}`;
    });
  }

  async function updateEntry(r: RosterRow, patch: Pick<RosterRow, "duty_date" | "account_id" | "duty_type" | "note">) {
    const bad = await consecutiveViolations(patch.duty_date, patch.duty_type, [patch.account_id], r.id);
    if (bad.length) { alert(`당직 다음날에는 당직·파주대기를 배정할 수 없습니다.\n${bad.join("\n")}`); return; }
    const { error } = await supabase.from("work_duty_roster").update(patch).eq("id", r.id);
    if (error) {
      alert(error.code === "23505" ? "같은 날 같은 구분에 이미 등록된 사원입니다." : `수정 실패: ${error.message}`);
      return;
    }
    setEditing(null);
    afterWrite();
  }

  async function removeEntry(r: RosterRow) {
    const { error } = await supabase.from("work_duty_roster").delete().eq("id", r.id);
    if (error) { alert(`삭제 실패: ${error.message}`); return; }
    afterWrite();
  }

  async function addEntries(date: string, kind: DutyKind, ids: number[], note: string) {
    const bad = await consecutiveViolations(date, kind, ids);
    if (bad.length) { alert(`당직 다음날에는 당직·파주대기를 배정할 수 없습니다.\n${bad.join("\n")}`); return; }
    const { error } = await supabase.from("work_duty_roster").upsert(
      ids.map(id => ({ duty_date: date, account_id: id, duty_type: kind, note: note.trim() || null, created_by: userId })),
      { onConflict: "duty_date,account_id,duty_type", ignoreDuplicates: true });
    if (error) { alert(`저장 실패: ${error.message}`); return; }
    setAdding(null);
    afterWrite();
  }

  const isOff = (key: string) => { const w = parseKey(key).getDay(); return w === 0 || w === 6 || holidays.has(key); };
  const weeks: string[] = [];
  for (let k = weekStart(from); k <= to; k = addDays(k, 7)) weeks.push(k);
  const counts = DUTY_KINDS.map(k => ({ k, n: roster.filter(r => r.duty_type === k).length }));
  const btnCls = "px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40";

  return (
    <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
      <DutyChangePanel me={me} employees={candidates} checkSwap={checkSwap} onApplied={afterWrite} />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={() => move(-1)} className={btnCls}>◀</button>
        <span className="px-2 text-sm font-bold text-gray-900 dark:text-white min-w-[100px] text-center">{year}년 {month}월</span>
        <button onClick={() => move(1)} className={btnCls}>▶</button>
        <span className={`ml-2 px-2 py-0.5 rounded text-xs font-semibold ${roster.length
          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
          : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
          {roster.length ? `근무표 ${roster.length}건 등록` : "근무표 미등록 — 이 달 당직·대기 시간 0"}
        </span>
        <div className="flex-1" />
        {canEdit && <>
        <button onClick={() => downloadTemplate(year, month)} className={btnCls}>⤓ 엑셀 양식</button>
        <button onClick={() => fileRef.current?.click()} disabled={busy || loading}
          className="px-2 py-1.5 rounded bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-40">⤒ 엑셀·PDF 업로드</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
        <button onClick={clearMonth} disabled={busy || loading || !roster.length}
          className="px-2 py-1.5 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-40">월 근무표 삭제</button>
        </>}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[11px] text-gray-600 dark:text-gray-300">
        {counts.map(({ k, n }) => (
          <span key={k}><span className={`px-1 rounded font-semibold ${KIND_CLS[k]}`}>{KIND_SHORT[k]}</span> {k} {DUTY_RULES[k].time} {DUTY_RULES[k].hours}H · {n}건</span>
        ))}
        <label className="flex items-center gap-1 ml-auto">
          <input type="checkbox" checked={showActual} onChange={e => setShowActual(e.target.checked)} />
          승인 연차·잔업 함께 보기
          <span className={`px-1 rounded ${LEAVE_CLS}`}>연차</span>
          <span className={`px-1 rounded ${OT_CLS}`}>잔업</span>
          <span className="px-1 rounded ring-1 ring-red-500 text-red-600 dark:text-red-400">연차 중 근무 배정</span>
        </label>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-500">불러오는 중…</div>
      ) : (
        <div className="grid grid-cols-7 border-l border-t border-gray-200 dark:border-gray-600 text-xs">
          {[...DOW_KR].map((w, i) => (
            <div key={w} className={`border-r border-b border-gray-200 dark:border-gray-600 py-1 text-center font-semibold bg-gray-100 dark:bg-gray-700
              ${i === 0 ? "text-red-600 dark:text-red-400" : i === 6 ? "text-blue-600 dark:text-blue-400" : "text-gray-700 dark:text-gray-200"}`}>{w}</div>
          ))}
          {weeks.flatMap(sun => Array.from({ length: 7 }, (_, i) => {
            const key = addDays(sun, i);
            const inMonth = key >= from && key <= to;
            if (!inMonth) return <div key={key} className="border-r border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40" />;
            const holiday = holidays.get(key);
            const off = isOff(key);
            return (
              <div key={key} className={`border-r border-b border-gray-200 dark:border-gray-600 min-h-[96px] p-1.5 flex flex-col gap-1
                ${off ? "bg-red-50 dark:bg-red-900/20" : "bg-white dark:bg-gray-800"}`}>
                <div className="flex items-center gap-1">
                  <span className={`font-semibold ${i === 0 || holiday ? "text-red-600 dark:text-red-400" : i === 6 ? "text-blue-600 dark:text-blue-400" : "text-gray-700 dark:text-gray-200"}`}>
                    {parseKey(key).getDate()}
                  </span>
                  {holiday && <span className="truncate text-[10px] text-red-500 dark:text-red-400">{holiday}</span>}
                  {canEdit && <button onClick={() => setAdding(key)} disabled={busy}
                    className="ml-auto px-1 rounded text-[11px] text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30">＋</button>}
                </div>
                {(byDate.get(key) ?? []).map(r => {
                  const emp = byId.get(r.account_id);
                  const onLeave = actual.leaveMap.get(key)?.find(l => l.id === r.account_id);
                  return (
                    <span key={r.id} onClick={canEdit ? () => setEditing(r) : undefined}
                      title={`${r.duty_type}${r.note ? ` - ${r.note}` : ""}${onLeave ? `\n⚠ 같은 날 ${onLeave.label} (연차계 승인)` : ""}${canEdit ? "\n클릭하여 수정" : ""}`}
                      className={`group/chip flex items-center gap-1 rounded px-1 py-0.5 text-[11px] ${canEdit ? "cursor-pointer hover:brightness-95" : ""} ${KIND_CLS[r.duty_type]} ${onLeave ? "ring-1 ring-red-500" : ""} ${r.account_id === me.id ? "outline outline-1 outline-indigo-500" : ""}`}>
                      <b>{KIND_SHORT[r.duty_type]}</b>
                      <span className="truncate">{emp ? empName(emp) : `#${r.account_id}`}</span>
                      {canEdit && <button onClick={e => { e.stopPropagation(); removeEntry(r); }} title="삭제"
                        className="ml-auto opacity-50 hover:opacity-100">✕</button>}
                    </span>
                  );
                })}
                {showActual && (actual.leaveMap.get(key) ?? []).map((l, j) => (
                  <span key={`l${j}`} title="연차계 승인" className={`truncate rounded px-1 text-[10px] ${LEAVE_CLS}`}>
                    {l.label} {byId.get(l.id) ? empName(byId.get(l.id)!) : ""}
                  </span>
                ))}
                {showActual && (actual.otMap.get(key) ?? []).map((o, j) => (
                  <span key={`o${j}`} title={`잔업보고서 승인 ${o.no}`} className={`truncate rounded px-1 text-[10px] ${OT_CLS}`}>
                    잔업 {byId.get(o.id) ? empName(byId.get(o.id)!) : ""} {o.hours}H
                  </span>
                ))}
              </div>
            );
          }))}
        </div>
      )}

      {upload && (
        <UploadPreviewModal
          res={upload}
          candidates={candidates}
          busy={busy}
          onClose={() => setUpload(null)}
          onSave={replace => saveUpload(upload, replace)}
        />
      )}

      {editing && (
        <EditDutyModal
          entry={editing}
          candidates={candidates}
          monthFrom={from}
          monthTo={to}
          onClose={() => setEditing(null)}
          onSave={patch => updateEntry(editing, patch)}
          onDelete={() => { setEditing(null); removeEntry(editing); }}
        />
      )}

      {adding && (
        <AddDutyModal
          date={adding}
          off={isOff(adding)}
          candidates={candidates}
          existing={(byDate.get(adding) ?? [])}
          onClose={() => setAdding(null)}
          onSave={(kind, ids, note) => addEntries(adding, kind, ids, note)}
        />
      )}
    </div>
  );
}

function AddDutyModal({ date, off, candidates, existing, onClose, onSave }: {
  date: string;
  off: boolean;
  candidates: Employee[];
  existing: RosterRow[];
  onClose: () => void;
  onSave: (kind: DutyKind, ids: number[], note: string) => void;
}) {
  const [kind, setKind] = useState<DutyKind>(off ? "휴일당직" : "평일당직");
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const taken = new Set(existing.filter(r => r.duty_type === kind).map(r => r.account_id));
  const q = search.trim();
  const list = candidates.filter(e => !q || empName(e).includes(q) || (e.dept ?? "").includes(q));
  const d = parseKey(date);
  const kinds = DUTY_KINDS;

  return (
    <DraggableModal open onClose={onClose} panelClassName="w-full max-w-md max-h-[90vh]"
      header={
        <div className="flex items-center w-full">
          <span className="font-bold text-gray-900 dark:text-white">{d.getMonth() + 1}/{d.getDate()}({DOW_KR[d.getDay()]}) 근무 추가</span>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">✕</button>
        </div>
      }>
      <div className="p-4 space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-1.5">
          {kinds.map(k => (
            <button key={k} onClick={() => setKind(k)}
              className={`py-2 rounded border text-xs font-semibold ${kind === k
                ? `border-blue-600 ring-2 ring-blue-500/40 ${KIND_CLS[k]}`
                : "border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"}`}>
              {k}<div className="font-normal text-[10px]">{DUTY_RULES[k].time} · {DUTY_RULES[k].hours}H</div>
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="성명·부서 검색"
          className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
        <div className="max-h-56 overflow-auto rounded border border-gray-200 dark:border-gray-600 divide-y divide-gray-100 dark:divide-gray-700">
          {list.map(e => {
            const isTaken = taken.has(e.id);
            return (
              <label key={e.id} className={`flex items-center gap-2 px-2 py-1.5 ${isTaken ? "opacity-40" : "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/60"}`}>
                <input type="checkbox" disabled={isTaken} checked={selected.includes(e.id)}
                  onChange={ev => setSelected(s => ev.target.checked ? [...s, e.id] : s.filter(x => x !== e.id))} />
                <span className="font-semibold text-gray-900 dark:text-gray-100">{empName(e)}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{e.dept ?? "-"}</span>
                {isTaken && <span className="ml-auto text-[10px] text-gray-500">등록됨</span>}
              </label>
            );
          })}
        </div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="비고 (선택)"
          className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
        <div className="flex gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 self-center">{selected.length}명 선택</span>
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-xs text-gray-700 dark:text-gray-200">취소</button>
          <button disabled={!selected.length || saving} onClick={() => { setSaving(true); onSave(kind, selected, note); }}
            className="px-3 py-1.5 rounded bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">저장</button>
        </div>
      </div>
    </DraggableModal>
  );
}

function UploadPreviewModal({ res, candidates, busy, onClose, onSave }: {
  res: ParseResult;
  candidates: Employee[];
  busy: boolean;
  onClose: () => void;
  onSave: (replace: boolean) => void;
}) {
  const [replace, setReplace] = useState(true);
  // 당직 다음날 근무(당직·파주대기) 배정 — 파일 안에서 확인, 저장 시 DB 와 합쳐 다시 확인
  const violations = consecutiveDuties(res.entries, [...new Set(res.entries.map(e => e.account_id))]);
  const byId = new Map(candidates.map(e => [e.id, e]));
  const byDate = new Map<string, ParseResult["entries"]>();
  for (const e of res.entries) byDate.set(e.duty_date, [...(byDate.get(e.duty_date) ?? []), e]);
  const dates = [...byDate.keys()].sort();

  return (
    <DraggableModal open onClose={onClose} panelClassName="w-full max-w-2xl max-h-[90vh]"
      header={
        <div className="flex items-center w-full">
          <span className="font-bold text-gray-900 dark:text-white">근무표 확인 — {res.year}년 {res.month}월</span>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">✕</button>
        </div>
      }>
      <div className="p-4 space-y-3 text-sm overflow-auto max-h-[calc(90vh-60px)]">
        <div className="flex flex-wrap gap-2 text-xs">
          {DUTY_KINDS.map(k => (
            <span key={k} className={`px-2 py-0.5 rounded font-semibold ${KIND_CLS[k]}`}>
              {k} {res.entries.filter(e => e.duty_type === k).length}건
            </span>
          ))}
          <span className="px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold">합계 {res.entries.length}건</span>
        </div>
        {!!res.ignored.length && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            저장하지 않는 열: {res.ignored.join(", ")} (야간점검 시간은 잔업보고서로 반영됩니다)
          </p>
        )}
        {!!violations.length && (
            <div className="px-3 py-2 rounded border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-xs text-red-700 dark:text-red-300 space-y-0.5">
              <b>⛔ 당직 다음날 근무 배정 {violations.length}건 — 근무표를 고친 뒤 다시 업로드하세요 (저장 불가)</b>
              {violations.map((x, i) => <div key={i}>{res.entries.find(e => e.account_id === x.accountId)?.name} {x.first.slice(5)}·{x.second.slice(5)}</div>)}
            </div>
        )}
        {!!res.errors.length && (
          <div className="px-3 py-2 rounded border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-xs text-red-700 dark:text-red-300 space-y-0.5">
            <b>확인 필요 {res.errors.length}건 (해당 항목은 저장되지 않음)</b>
            {res.errors.map((er, i) => <div key={i}>{er}</div>)}
          </div>
        )}
        <div className="max-h-72 overflow-auto rounded border border-gray-200 dark:border-gray-600">
          <table className="w-full text-xs">
            <tbody>
              {dates.map(dk => {
                const d = parseKey(dk);
                return (
                  <tr key={dk} className="border-b border-gray-100 dark:border-gray-700">
                    <td className={`px-2 py-1 whitespace-nowrap font-semibold ${d.getDay() === 0 ? "text-red-600 dark:text-red-400" : d.getDay() === 6 ? "text-blue-600 dark:text-blue-400" : "text-gray-700 dark:text-gray-200"}`}>
                      {d.getMonth() + 1}/{d.getDate()}({DOW_KR[d.getDay()]})
                    </td>
                    <td className="px-2 py-1 flex flex-wrap gap-1">
                      {byDate.get(dk)!.map((e, i) => {
                        const emp = byId.get(e.account_id);
                        return (
                          <span key={i} title={e.source} className={`px-1 rounded ${KIND_CLS[e.duty_type]}`}>
                            <b>{KIND_SHORT[e.duty_type]}</b> {emp ? empName(emp) : e.name}
                          </span>
                        );
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-1 text-xs text-gray-700 dark:text-gray-200">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={replace} onChange={() => setReplace(true)} />
            {res.month}월 근무표를 이 파일 내용으로 <b>교체</b> (기존 등록분 삭제)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={!replace} onChange={() => setReplace(false)} />
            기존 등록분에 <b>추가</b> (중복은 건너뜀)
          </label>
        </div>
        <div className="flex gap-2">
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-xs text-gray-700 dark:text-gray-200">취소</button>
          <button disabled={!res.entries.length || busy || !!violations.length} onClick={() => onSave(replace)}
            className="px-3 py-1.5 rounded bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {res.entries.length}건 저장
          </button>
        </div>
      </div>
    </DraggableModal>
  );
}

function EditDutyModal({ entry, candidates, monthFrom, monthTo, onClose, onSave, onDelete }: {
  entry: RosterRow;
  candidates: Employee[];
  monthFrom: string;
  monthTo: string;
  onClose: () => void;
  onSave: (patch: Pick<RosterRow, "duty_date" | "account_id" | "duty_type" | "note">) => void;
  onDelete: () => void;
}) {
  const [kind, setKind] = useState<DutyKind>(entry.duty_type);
  const [accountId, setAccountId] = useState(entry.account_id);
  const [date, setDate] = useState(entry.duty_date.slice(0, 10));
  const [note, setNote] = useState(entry.note ?? "");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const q = search.trim();
  const list = candidates.filter(e => e.id === accountId || !q || empName(e).includes(q) || (e.dept ?? "").includes(q));
  const valid = date >= monthFrom && date <= monthTo;
  const inputCls = "w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100";

  return (
    <DraggableModal open onClose={onClose} panelClassName="w-full max-w-md max-h-[90vh]"
      header={
        <div className="flex items-center w-full">
          <span className="font-bold text-gray-900 dark:text-white">근무 수정</span>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">✕</button>
        </div>
      }>
      <div className="p-4 space-y-3 text-sm">
        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">날짜</label>
          <input type="date" value={date} min={monthFrom} max={monthTo} onChange={e => setDate(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {DUTY_KINDS.map(k => (
            <button key={k} onClick={() => setKind(k)}
              className={`py-2 rounded border text-xs font-semibold ${kind === k
                ? `border-blue-600 ring-2 ring-blue-500/40 ${KIND_CLS[k]}`
                : "border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"}`}>
              {k}<div className="font-normal text-[10px]">{DUTY_RULES[k].time} · {DUTY_RULES[k].hours}H</div>
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="근무자 검색 (성명·부서)" className={inputCls} />
        <div className="max-h-48 overflow-auto rounded border border-gray-200 dark:border-gray-600 divide-y divide-gray-100 dark:divide-gray-700">
          {list.map(e => (
            <label key={e.id} className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/60">
              <input type="radio" name="duty-edit-emp" checked={accountId === e.id} onChange={() => setAccountId(e.id)} />
              <span className="font-semibold text-gray-900 dark:text-gray-100">{empName(e)}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{e.dept ?? "-"}</span>
            </label>
          ))}
        </div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="비고 (선택)" className={inputCls} />
        <div className="flex gap-2">
          <button onClick={() => { if (confirm("이 근무를 삭제할까요?")) onDelete(); }}
            className="px-3 py-1.5 rounded border border-red-300 dark:border-red-700 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30">삭제</button>
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-xs text-gray-700 dark:text-gray-200">취소</button>
          <button disabled={!valid || saving}
            onClick={() => { setSaving(true); onSave({ duty_date: date, account_id: accountId, duty_type: kind, note: note.trim() || null }); }}
            className="px-3 py-1.5 rounded bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">저장</button>
        </div>
      </div>
    </DraggableModal>
  );
}
