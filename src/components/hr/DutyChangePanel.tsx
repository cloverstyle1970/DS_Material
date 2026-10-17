"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { insertNotification } from "@/lib/notify";
import DraggableModal from "@/components/common/DraggableModal";
import { DOW_KR, dateKey, empName, parseKey, type Employee } from "./attendanceShared";
import { DUTY_RULES, ROSTER_SELECT, WEEK_LIMIT_HOURS, WEEK_WARN_HOURS, fmtH, type DutyKind, type RosterRow } from "./workHoursCalc";

// 근무변경 요청: 요청자 근무 ↔ 대상자 근무 맞교환.
// 요청 → 대상자 승인 → 시스템관리자(FINAL_APPROVER_NAME) 최종 승인 → 근무표(work_duty_roster) 반영.
// 요청 전 두 사람의 변경 후 일정으로 ① 해당 주(일~토) 64H 이하 ② 해당 분기 주평균 52H 이하
// ③ 당직 다음날 근무(당직·파주대기) 없음 을 검토한다.
export const FINAL_APPROVER_NAME = "황진한";
const LINK = "/hr/work-hours";

type Status = "pending_peer" | "pending_admin" | "approved" | "rejected" | "canceled";
const STATUS_LABEL: Record<Status, string> = {
  pending_peer: "대상자 승인 대기", pending_admin: "최종 승인 대기", approved: "변경 완료", rejected: "반려", canceled: "취소",
};
const STATUS_CLS: Record<Status, string> = {
  pending_peer:  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  pending_admin: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200",
  approved:      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200",
  rejected:      "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200",
  canceled:      "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
};

interface ChangeRequest {
  id: number;
  requester_id: number;
  target_id: number;
  from_roster_id: number | null;
  to_roster_id: number | null;
  from_date: string;
  from_type: DutyKind;
  to_date: string;
  to_type: DutyKind;
  reason: string | null;
  status: Status;
  check_result: SwapCheck | null;
  reject_reason: string | null;
  created_at: string;
}
const REQ_SELECT = "id,requester_id,target_id,from_roster_id,to_roster_id,from_date,from_type,to_date,to_type,reason,status,check_result,reject_reason,created_at";

export interface SwapCheck {
  ok: boolean;
  message?: string; // 검토 불가 사유
  weeks: { name: string; week: string; before: number; after: number }[];       // 주 합계 (64H 한도)
  avgs: { name: string; quarter: string; before: number; after: number }[];     // 분기 주평균 (52H 한도)
  consecutive?: string[];                                                        // 당직 연속근무 (불가)
}
const failText = (c: SwapCheck) => [
  ...c.weeks.filter(w => w.after > WEEK_LIMIT_HOURS).map(w => `${w.name} 주 ${w.week} ${fmtH(w.after)}H (64H 초과)`),
  ...(c.avgs ?? []).filter(a => a.after > WEEK_WARN_HOURS).map(a => `${a.name} ${a.quarter} 주평균 ${fmtH(a.after)}H (52H 초과)`),
  ...(c.consecutive ?? []).map(t => `${t} (당직 다음날 근무 불가)`),
].join("\n");

const md = (key: string) => { const d = parseKey(key.slice(0, 10)); return `${d.getMonth() + 1}/${d.getDate()}(${DOW_KR[d.getDay()]})`; };
const dutyText = (date: string, type: string) => `${md(date)} ${type}`;

export default function DutyChangePanel({ me, employees, checkSwap, onApplied }: {
  me: { id: number; name: string };
  employees: Employee[];
  checkSwap: (from: RosterRow, to: RosterRow) => SwapCheck;
  onApplied: () => void;
}) {
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const byId = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
  const nameOf = (id: number) => { const e = byId.get(id); return e ? empName(e) : `#${id}`; };
  const approver = useMemo(() => employees.find(e => empName(e) === FINAL_APPROVER_NAME) ?? null, [employees]);
  const isApprover = approver?.id === me.id;

  // setState 는 await 이후에만 호출
  const load = useCallback(async () => {
    let q = supabase.from("duty_change_requests").select(REQ_SELECT).order("id", { ascending: false }).limit(100);
    if (!isApprover) q = q.or(`requester_id.eq.${me.id},target_id.eq.${me.id}`);
    const { data } = await q;
    setRequests((data ?? []) as ChangeRequest[]);
  }, [me.id, isApprover]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const notify = (userId: number, title: string, message: string, refId: number) =>
    insertNotification({ userId, type: "duty_change", title, message, link: LINK, refType: "duty_change_request", refId }).catch(console.warn);

  async function setStatus(r: ChangeRequest, patch: Record<string, unknown>) {
    const { error } = await supabase.from("duty_change_requests").update(patch).eq("id", r.id).eq("status", r.status);
    if (error) { alert(`처리 실패: ${error.message}`); return false; }
    return true;
  }

  async function peerDecide(r: ChangeRequest, approve: boolean) {
    const reason = approve ? null : prompt("반려 사유를 입력하세요.")?.trim();
    if (!approve && !reason) return;
    setBusyId(r.id);
    const ok = await setStatus(r, approve
      ? { status: "pending_admin", peer_decided_at: new Date().toISOString() }
      : { status: "rejected", peer_decided_at: new Date().toISOString(), reject_reason: reason });
    if (ok) {
      const desc = `${nameOf(r.requester_id)} ${dutyText(r.from_date, r.from_type)} ↔ ${nameOf(r.target_id)} ${dutyText(r.to_date, r.to_type)}`;
      if (approve) {
        notify(r.requester_id, "근무변경 — 대상자 승인", `${nameOf(r.target_id)}님이 승인했습니다. 최종 승인 대기 중입니다.`, r.id);
        if (approver) notify(approver.id, "근무변경 최종 승인 요청", desc, r.id);
      } else {
        notify(r.requester_id, "근무변경 — 반려", `${nameOf(r.target_id)}님이 반려했습니다: ${reason}`, r.id);
      }
    }
    setBusyId(null);
    load();
  }

  async function finalDecide(r: ChangeRequest, approve: boolean) {
    setBusyId(r.id);
    try {
      if (!approve) {
        const reason = prompt("반려 사유를 입력하세요.")?.trim();
        if (!reason) return;
        if (await setStatus(r, { status: "rejected", admin_id: me.id, admin_decided_at: new Date().toISOString(), reject_reason: reason })) {
          for (const uid of [r.requester_id, r.target_id]) notify(uid, "근무변경 — 최종 반려", `${me.name}: ${reason}`, r.id);
        }
        return;
      }
      // 근무표가 요청 이후 바뀌지 않았는지 확인
      const { data } = await supabase.from("work_duty_roster").select(ROSTER_SELECT).in("id", [r.from_roster_id ?? -1, r.to_roster_id ?? -1]);
      const rows = (data ?? []) as RosterRow[];
      const from = rows.find(x => x.id === r.from_roster_id);
      const to = rows.find(x => x.id === r.to_roster_id);
      if (!from || !to || from.account_id !== r.requester_id || to.account_id !== r.target_id
        || from.duty_date.slice(0, 10) !== r.from_date || to.duty_date.slice(0, 10) !== r.to_date) {
        alert("요청 이후 근무표가 바뀌어 변경할 수 없습니다. 반려 후 다시 요청하도록 안내해 주세요.");
        return;
      }
      const check = checkSwap(from, to);
      if (!check.ok && !confirm(`현재 기준으로 다시 검토하니 근무시간 한도를 넘습니다.\n${check.message ?? failText(check)}\n\n그래도 승인할까요?`)) return;
      if (!confirm(`근무표를 변경합니다.\n${nameOf(r.requester_id)} ${dutyText(r.from_date, r.from_type)} → ${nameOf(r.target_id)}\n${nameOf(r.target_id)} ${dutyText(r.to_date, r.to_type)} → ${nameOf(r.requester_id)}`)) return;
      // 맞교환: 같은 날 같은 구분 중복(UNIQUE) 시 실패
      const e1 = (await supabase.from("work_duty_roster").update({ account_id: r.target_id }).eq("id", from.id)).error;
      if (e1) { alert(`근무표 변경 실패: ${e1.code === "23505" ? "대상자가 같은 날 같은 근무에 이미 배정되어 있습니다." : e1.message}`); return; }
      const e2 = (await supabase.from("work_duty_roster").update({ account_id: r.requester_id }).eq("id", to.id)).error;
      if (e2) {
        await supabase.from("work_duty_roster").update({ account_id: r.requester_id }).eq("id", from.id); // 되돌림
        alert(`근무표 변경 실패: ${e2.code === "23505" ? "요청자가 같은 날 같은 근무에 이미 배정되어 있습니다." : e2.message}`);
        return;
      }
      await setStatus(r, { status: "approved", admin_id: me.id, admin_decided_at: new Date().toISOString(), check_result: check });
      for (const uid of [r.requester_id, r.target_id]) {
        notify(uid, "근무변경 완료", `${nameOf(r.requester_id)} ${dutyText(r.from_date, r.from_type)} ↔ ${nameOf(r.target_id)} ${dutyText(r.to_date, r.to_type)}`, r.id);
      }
      onApplied();
    } finally {
      setBusyId(null);
      load();
    }
  }

  async function cancel(r: ChangeRequest) {
    if (!confirm("이 근무변경 요청을 취소할까요?")) return;
    setBusyId(r.id);
    if (await setStatus(r, { status: "canceled" }) && r.status === "pending_peer") {
      notify(r.target_id, "근무변경 요청 취소", `${nameOf(r.requester_id)}님이 요청을 취소했습니다.`, r.id);
    }
    setBusyId(null);
    load();
  }

  const pending = requests.filter(r => r.status === "pending_peer" || r.status === "pending_admin");
  const toMe = pending.filter(r => (r.status === "pending_peer" && r.target_id === me.id) || (r.status === "pending_admin" && isApprover));
  const btn = "px-2 py-0.5 rounded text-[11px] font-semibold disabled:opacity-40";

  return (
    <div className="mb-3 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700">
        <span className="text-sm font-bold text-gray-900 dark:text-white">근무변경 요청</span>
        {!!toMe.length && <span className="px-1.5 rounded bg-red-600 text-[11px] font-bold text-white">처리할 요청 {toMe.length}</span>}
        <span className="text-[11px] text-gray-500 dark:text-gray-400">요청 → 대상자 승인 → {FINAL_APPROVER_NAME} 최종 승인 → 근무표 반영 · 주 {WEEK_LIMIT_HOURS}H·분기 주평균 {WEEK_WARN_HOURS}H 초과, 당직 다음날 근무 시 요청 불가</span>
        <div className="flex-1" />
        <button onClick={() => setOpen(true)} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">⇄ 근무변경요청</button>
      </div>
      {requests.length > 0 && (
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-xs">
            <tbody>
              {requests.map(r => {
                const mine = r.requester_id === me.id;
                return (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-200">
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded font-semibold ${STATUS_CLS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      <b>{nameOf(r.requester_id)}</b> {dutyText(r.from_date, r.from_type)} ⇄ <b>{nameOf(r.target_id)}</b> {dutyText(r.to_date, r.to_type)}
                      {r.reason && <span className="text-gray-500 dark:text-gray-400"> · {r.reason}</span>}
                      {r.reject_reason && <span className="text-red-600 dark:text-red-400"> · 반려: {r.reject_reason}</span>}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-right space-x-1">
                      {r.status === "pending_peer" && r.target_id === me.id && <>
                        <button disabled={busyId === r.id} onClick={() => peerDecide(r, true)} className={`${btn} bg-blue-600 text-white`}>승인</button>
                        <button disabled={busyId === r.id} onClick={() => peerDecide(r, false)} className={`${btn} border border-red-300 text-red-600`}>반려</button>
                      </>}
                      {r.status === "pending_admin" && isApprover && <>
                        <button disabled={busyId === r.id} onClick={() => finalDecide(r, true)} className={`${btn} bg-green-600 text-white`}>최종 승인</button>
                        <button disabled={busyId === r.id} onClick={() => finalDecide(r, false)} className={`${btn} border border-red-300 text-red-600`}>반려</button>
                      </>}
                      {mine && (r.status === "pending_peer" || r.status === "pending_admin") && (
                        <button disabled={busyId === r.id} onClick={() => cancel(r)} className={`${btn} border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300`}>취소</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <RequestModal
          me={me}
          employees={employees}
          approverName={approver ? empName(approver) : FINAL_APPROVER_NAME}
          checkSwap={checkSwap}
          onClose={() => setOpen(false)}
          onCreated={async (req) => {
            setOpen(false);
            notify(req.target_id, "근무변경 승인 요청",
              `${me.name}님: ${dutyText(req.from_date, req.from_type)} ⇄ 내 근무 ${dutyText(req.to_date, req.to_type)}`, req.id);
            load();
          }}
        />
      )}
    </div>
  );
}

// ── 요청 작성 팝업 ────────────────────────────────────────────
function RequestModal({ me, employees, approverName, checkSwap, onClose, onCreated }: {
  me: { id: number; name: string };
  employees: Employee[];
  approverName: string;
  checkSwap: (from: RosterRow, to: RosterRow) => SwapCheck;
  onClose: () => void;
  onCreated: (req: ChangeRequest) => void;
}) {
  const today = dateKey(new Date());
  const [myDuties, setMyDuties] = useState<RosterRow[] | null>(null);
  const [fromId, setFromId] = useState<number | null>(null);
  const [toDate, setToDate] = useState("");
  const [dayDuties, setDayDuties] = useState<RosterRow[]>([]);
  const [toId, setToId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [check, setCheck] = useState<SwapCheck | null>(null);
  const [saving, setSaving] = useState(false);

  const byId = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  useEffect(() => {
    let alive = true;
    supabase.from("work_duty_roster").select(ROSTER_SELECT).eq("account_id", me.id).gte("duty_date", today).order("duty_date")
      .then(({ data }) => { if (alive) setMyDuties((data ?? []) as RosterRow[]); });
    return () => { alive = false; };
  }, [me.id, today]);

  useEffect(() => {
    if (!toDate) return;
    let alive = true;
    supabase.from("work_duty_roster").select(ROSTER_SELECT).eq("duty_date", toDate).neq("account_id", me.id)
      .then(({ data }) => { if (alive) { setDayDuties((data ?? []) as RosterRow[]); setToId(null); setCheck(null); } });
    return () => { alive = false; };
  }, [toDate, me.id]);

  const from = myDuties?.find(d => d.id === fromId) ?? null;
  const to = dayDuties.find(d => d.id === toId) ?? null;

  function review() {
    if (!from || !to) return;
    setCheck(checkSwap(from, to));
  }

  async function submit() {
    if (!from || !to || !check?.ok) return;
    const targetName = byId.get(to.account_id) ? empName(byId.get(to.account_id)!) : "";
    if (!confirm(`일정 변경 가능합니다.\n\n내 근무 ${dutyText(from.duty_date, from.duty_type)} ⇄ ${targetName} ${dutyText(to.duty_date, to.duty_type)}\n\n변경을 요청할까요? ${targetName}님에게 승인 요청이 발송됩니다.`)) return;
    setSaving(true);
    const { data, error } = await supabase.from("duty_change_requests").insert({
      requester_id: me.id, target_id: to.account_id,
      from_roster_id: from.id, to_roster_id: to.id,
      from_date: from.duty_date.slice(0, 10), from_type: from.duty_type,
      to_date: to.duty_date.slice(0, 10), to_type: to.duty_type,
      reason: reason.trim() || null, check_result: check,
    }).select(REQ_SELECT).single();
    setSaving(false);
    if (error) { alert(`요청 실패: ${error.message}`); return; }
    alert(`${targetName}님에게 승인 요청을 보냈습니다.\n대상자 승인 후 ${approverName}님의 최종 승인을 받으면 근무표가 변경됩니다.`);
    onCreated(data as ChangeRequest);
  }

  const radioRow = "flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/60";
  const box = "max-h-44 overflow-auto rounded border border-gray-200 dark:border-gray-600 divide-y divide-gray-100 dark:divide-gray-700";

  return (
    <DraggableModal open onClose={onClose} panelClassName="w-full max-w-lg max-h-[90vh]"
      header={
        <div className="flex items-center w-full">
          <span className="font-bold text-gray-900 dark:text-white">근무변경 요청</span>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">✕</button>
        </div>
      }>
      <div className="p-4 space-y-3 text-sm overflow-auto max-h-[calc(90vh-60px)]">
        <div>
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">① 변경할 내 근무 ({me.name})</div>
          {myDuties === null ? <div className="text-xs text-gray-500">불러오는 중…</div>
            : !myDuties.length ? <div className="text-xs text-gray-500">오늘 이후 등록된 내 근무가 없습니다.</div>
            : (
              <div className={box}>
                {myDuties.map(d => (
                  <label key={d.id} className={radioRow}>
                    <input type="radio" name="dc-from" checked={fromId === d.id} onChange={() => { setFromId(d.id); setCheck(null); }} />
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{md(d.duty_date)}</span>
                    <span className="text-gray-700 dark:text-gray-300">{d.duty_type}</span>
                    <span className="ml-auto text-[11px] text-gray-500">{DUTY_RULES[d.duty_type].time} · {DUTY_RULES[d.duty_type].hours}H</span>
                  </label>
                ))}
              </div>
            )}
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">② 바꿀 일자와 그날 근무자</div>
          <input type="date" value={toDate} min={today} onChange={e => setToDate(e.target.value)}
            className="w-full px-2 py-1.5 mb-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
          {toDate && (!dayDuties.length ? <div className="text-xs text-gray-500">그날 근무표에 다른 근무자가 없습니다.</div> : (
            <div className={box}>
              {dayDuties.map(d => {
                const e = byId.get(d.account_id);
                return (
                  <label key={d.id} className={radioRow}>
                    <input type="radio" name="dc-to" checked={toId === d.id} onChange={() => { setToId(d.id); setCheck(null); }} />
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{e ? empName(e) : `#${d.account_id}`}</span>
                    <span className="text-gray-700 dark:text-gray-300">{d.duty_type}</span>
                    <span className="ml-auto text-[11px] text-gray-500">{e?.dept ?? ""}</span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>

        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="변경 사유 (선택)"
          className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />

        {check && (
          <div className={`px-3 py-2 rounded border text-xs ${check.ok
            ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200"
            : "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300"}`}>
            <b>{check.ok ? "✔ 일정 변경 가능" : "✖ 변경 불가"}</b>
            {check.message && <div>{check.message}</div>}
            {!check.ok && !check.message && <div className="whitespace-pre-line">{failText(check)}</div>}
            <table className="mt-1 w-full">
              <tbody>
                {check.weeks.map((w, i) => (
                  <tr key={`w${i}`}>
                    <td className="pr-2">{w.name}</td>
                    <td className="pr-2">주 {w.week}</td>
                    <td className="pr-2 text-right">{fmtH(w.before) || 0}H → <b className={w.after > WEEK_LIMIT_HOURS ? "text-red-600 dark:text-red-400" : ""}>{fmtH(w.after) || 0}H</b> <span className="opacity-60">/ {WEEK_LIMIT_HOURS}H</span></td>
                  </tr>
                ))}
                {check.avgs.map((a, i) => (
                  <tr key={`a${i}`}>
                    <td className="pr-2">{a.name}</td>
                    <td className="pr-2">{a.quarter} 주평균</td>
                    <td className="pr-2 text-right">{fmtH(a.before) || 0}H → <b className={a.after > WEEK_WARN_HOURS ? "text-red-600 dark:text-red-400" : ""}>{fmtH(a.after) || 0}H</b> <span className="opacity-60">/ {WEEK_WARN_HOURS}H</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-2">
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-xs text-gray-700 dark:text-gray-200">닫기</button>
          <button onClick={review} disabled={!from || !to}
            className="px-3 py-1.5 rounded border border-indigo-400 text-xs font-semibold text-indigo-700 dark:text-indigo-300 disabled:opacity-40">근무시간 검토</button>
          <button onClick={submit} disabled={!check?.ok || saving}
            className="px-3 py-1.5 rounded bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">변경 요청</button>
        </div>
      </div>
    </DraggableModal>
  );
}
