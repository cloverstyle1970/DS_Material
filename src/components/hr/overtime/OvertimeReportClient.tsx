"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  calcOvertimeResult,
  detectHoliday,
  dayOfWeekKr,
  OvertimeResult,
} from "./overtimeCalc";
import {
  notifyOvertimeApprovalRequest,
  notifyOvertimeApproved,
  notifyOvertimeRejected,
} from "./overtimeNotify";

export const OT_MENU_HREF = "/hr/overtime-report";

const WORK_REASONS = ["점검", "공사", "수리·부품교체", "상주", "조출", "기타"] as const;

interface Account {
  id: number;
  username: string;
  dept: string | null;
  status: string | null;
}

interface OvertimeReport {
  id: number;
  report_no: string;
  author_id: number;
  site_name: string;
  work_instructor: string | null;
  work_instructor_id: number | null;
  work_reasons: string[];
  work_reason_etc: string | null;
  work_elevator: string | null;
  start_at: string;
  end_at: string;
  is_holiday: boolean;
  holiday_type: string | null;
  work_hours: number | null;
  holiday_hours: number | null;
  overtime_hours: number | null;
  workers: string[];
  work_content: string | null;
  work_result: string | null;
  note: string | null;
  approver_id: number | null;
  approval_status: string;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
}

// datetime-local(YYYY-MM-DDTHH:mm) → 각 파트 분해
function parseDT(val: string) {
  if (!val) return { yr: "", mo: "", dy: "", hr: "", mi: "", dow: "" };
  const d = new Date(val);
  if (isNaN(d.getTime())) return { yr: "", mo: "", dy: "", hr: "", mi: "", dow: "" };
  return {
    yr:  String(d.getFullYear()).slice(2),
    mo:  String(d.getMonth() + 1).padStart(2, "0"),
    dy:  String(d.getDate()).padStart(2, "0"),
    hr:  String(d.getHours()).padStart(2, "0"),
    mi:  String(d.getMinutes()).padStart(2, "0"),
    dow: dayOfWeekKr(d),
  };
}

// 숫자 파트들 → datetime-local string
function buildDT(yr: string, mo: string, dy: string, hr: string, mi: string): string {
  if (!yr || !mo || !dy || !hr || !mi) return "";
  const full = `20${yr.padStart(2,"0")}-${mo.padStart(2,"0")}-${dy.padStart(2,"0")}T${hr.padStart(2,"0")}:${mi.padStart(2,"0")}`;
  return isNaN(new Date(full).getTime()) ? "" : full;
}

// 문서 스타일 인라인 입력 (날짜 파트용)
const partInput = "w-10 border-0 border-b border-gray-500 dark:border-gray-400 text-center text-sm bg-transparent focus:outline-none focus:border-blue-500 placeholder:text-gray-300 dark:placeholder:text-gray-600";
const cellInput = "w-full border-0 bg-transparent text-sm focus:outline-none focus:bg-blue-50 dark:focus:bg-blue-900/20 px-1 py-0.5";
const cellTArea = "w-full border-0 bg-transparent text-sm focus:outline-none focus:bg-blue-50 dark:focus:bg-blue-900/20 px-1 py-1 resize-none";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft:    { label: "작성중",    cls: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
    pending:  { label: "결재 요청", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
    approved: { label: "승인완료",  cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
    rejected: { label: "반려",      cls: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300" },
  };
  const s = map[status] ?? { label: status, cls: "bg-gray-100 text-gray-500" };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>;
}

// ── 문서 양식 컴포넌트 ─────────────────────────────────────────────
interface FormState {
  site_name: string;
  work_instructor: string;
  work_instructor_id: number | null;
  work_reasons: string[];
  work_reason_etc: string;
  work_elevator: string;
  // 날짜 파트 (시작)
  s_yr: string; s_mo: string; s_dy: string; s_hr: string; s_mi: string;
  // 날짜 파트 (종료)
  e_yr: string; e_mo: string; e_dy: string; e_hr: string; e_mi: string;
  is_holiday: boolean;
  holiday_type: string;
  workers: string[];
  work_content: string;
  work_result: string;
  note: string;
  approver_id: number | null;
  // 계산 결과
  work_hours: number | null;
  holiday_hours: number | null;
  overtime_hours: number | null;
}

function makeEmptyForm(): FormState {
  const now = new Date();
  return {
    site_name: "", work_instructor: "", work_instructor_id: null,
    work_reasons: [], work_reason_etc: "", work_elevator: "",
    s_yr: String(now.getFullYear()).slice(2),
    s_mo: String(now.getMonth()+1).padStart(2,"0"),
    s_dy: String(now.getDate()).padStart(2,"0"),
    s_hr: "07", s_mi: "00",
    e_yr: String(now.getFullYear()).slice(2),
    e_mo: String(now.getMonth()+1).padStart(2,"0"),
    e_dy: String(now.getDate()).padStart(2,"0"),
    e_hr: "16", e_mi: "00",
    is_holiday: false, holiday_type: "",
    workers: Array(8).fill(""),
    work_content: "", work_result: "", note: "",
    approver_id: null,
    work_hours: null, holiday_hours: null, overtime_hours: null,
  };
}

function reportToForm(r: OvertimeReport): FormState {
  const sp = parseDT(r.start_at ? r.start_at.slice(0,16) : "");
  const ep = parseDT(r.end_at   ? r.end_at.slice(0,16)   : "");
  const workers = [...r.workers];
  while (workers.length < 8) workers.push("");
  return {
    site_name: r.site_name,
    work_instructor: r.work_instructor ?? "",
    work_instructor_id: r.work_instructor_id,
    work_reasons: r.work_reasons,
    work_reason_etc: r.work_reason_etc ?? "",
    work_elevator: r.work_elevator ?? "",
    s_yr: sp.yr, s_mo: sp.mo, s_dy: sp.dy, s_hr: sp.hr, s_mi: sp.mi,
    e_yr: ep.yr, e_mo: ep.mo, e_dy: ep.dy, e_hr: ep.hr, e_mi: ep.mi,
    is_holiday: r.is_holiday,
    holiday_type: r.holiday_type ?? "",
    workers,
    work_content: r.work_content ?? "",
    work_result: r.work_result ?? "",
    note: r.note ?? "",
    approver_id: r.approver_id,
    work_hours: r.work_hours,
    holiday_hours: r.holiday_hours,
    overtime_hours: r.overtime_hours,
  };
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────
export default function OvertimeReportClient() {
  const { user } = useAuth();
  const canCreate = user ? (isAdmin(user) || hasMenuPermission(user, OT_MENU_HREF, "create")) : false;
  const isManager = user ? (isAdmin(user) || hasMenuPermission(user, OT_MENU_HREF, "update")) : false;

  const [accounts, setAccounts]   = useState<Account[]>([]);
  const [myReports, setMyReports] = useState<OvertimeReport[]>([]);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [form, setForm]           = useState<FormState>(makeEmptyForm());
  const [otResult, setOtResult]   = useState<OvertimeResult | null>(null);
  const [saving, setSaving]       = useState(false);
  const [rejectModal, setRejectModal] = useState<{ id: number; reportNo: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    const PAGE = 500;
    const rows: OvertimeReport[] = [];
    for (let off = 0; ; off += PAGE) {
      let q = supabase
        .from("overtime_reports").select("*")
        .order("created_at", { ascending: false })
        .range(off, off + PAGE - 1);
      if (!isManager) q = q.eq("author_id", user.id);
      const { data } = await q;
      const batch = (data as OvertimeReport[] | null) ?? [];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
    setMyReports(rows);
  }, [user, isManager]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("accounts").select("id,username,dept,status").order("username");
      setAccounts((data as Account[] | null) ?? []);
    })();
  }, []);
  useEffect(() => { load(); }, [load]);
  useReloadOnActivate(load);

  // 날짜 파트 변경 시 휴일 자동 감지 + 시간 계산
  const startDT = buildDT(form.s_yr, form.s_mo, form.s_dy, form.s_hr, form.s_mi);
  const endDT   = buildDT(form.e_yr, form.e_mo, form.e_dy, form.e_hr, form.e_mi);

  useEffect(() => {
    if (!startDT || !endDT) { setOtResult(null); return; }
    const s = new Date(startDT), e = new Date(endDT);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) { setOtResult(null); return; }
    const result = calcOvertimeResult(s, e, form.is_holiday);
    setOtResult(result);
    setForm(f => ({ ...f, work_hours: result.workHours, holiday_hours: result.holidayHours, overtime_hours: result.overtimeHours }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDT, endDT, form.is_holiday]);

  // 시작일 변경 시 휴일 자동 감지
  function detectFromStart(yr: string, mo: string, dy: string) {
    const full = `20${yr}-${mo}-${dy}`;
    const d = new Date(full);
    if (!isNaN(d.getTime())) {
      const { isHoliday, holidayType } = detectHoliday(d);
      setForm(f => ({ ...f, is_holiday: isHoliday, holiday_type: holidayType }));
    }
  }

  const f = form;
  const sf = (patch: Partial<FormState>) => setForm(prev => ({ ...prev, ...patch }));

  const startDow = startDT ? dayOfWeekKr(new Date(startDT)) : "";
  const endDow   = endDT   ? dayOfWeekKr(new Date(endDT))   : "";

  const activeAccounts = useMemo(() => accounts.filter(a => a.status !== "퇴직"), [accounts]);
  const approverAcc    = accounts.find(a => a.id === f.approver_id);
  const todayStr = new Date().toLocaleDateString("ko-KR");
  const authorAcc = accounts.find(a => a.id === user?.id);

  function openNew() {
    const ef = makeEmptyForm();
    const now = new Date();
    const { isHoliday, holidayType } = detectHoliday(now);
    sf({ ...ef, is_holiday: isHoliday, holiday_type: holidayType });
    setOtResult(null);
    setEditingId("new");
  }

  function openEdit(r: OvertimeReport) {
    setForm(reportToForm(r));
    setOtResult(null);
    setEditingId(r.id);
  }

  async function save(submitForApproval: boolean) {
    if (!user) return;
    if (!f.site_name.trim()) { alert("현장명을 입력해주세요."); return; }
    if (!startDT || !endDT)  { alert("작업일시를 입력해주세요."); return; }
    if (submitForApproval && !f.approver_id) { alert("결재 승인자를 지정해주세요."); return; }
    setSaving(true);
    try {
      const payload = {
        author_id:          user.id,
        site_name:          f.site_name.trim(),
        work_instructor:    f.work_instructor_id ? (accounts.find(a=>a.id===f.work_instructor_id)?.username ?? f.work_instructor.trim()) : f.work_instructor.trim() || null,
        work_instructor_id: f.work_instructor_id,
        work_reasons:       f.work_reasons,
        work_reason_etc:    f.work_reason_etc.trim() || null,
        work_elevator:      f.work_elevator.trim() || null,
        start_at:           new Date(startDT).toISOString(),
        end_at:             new Date(endDT).toISOString(),
        is_holiday:         f.is_holiday,
        holiday_type:       f.holiday_type || null,
        work_hours:         f.work_hours,
        holiday_hours:      f.holiday_hours,
        overtime_hours:     f.overtime_hours,
        workers:            f.workers.filter(w => w.trim()),
        work_content:       f.work_content.trim() || null,
        work_result:        f.work_result.trim() || null,
        note:               f.note.trim() || null,
        approver_id:        f.approver_id,
        approval_status:    submitForApproval ? "pending" : "draft",
        submitted_at:       submitForApproval ? new Date().toISOString() : null,
      };

      if (editingId === "new") {
        const { data: noData, error: noErr } = await supabase.rpc("next_ot_no");
        if (noErr) throw new Error("문서번호 채번 실패: " + noErr.message);
        const { data: inserted, error: insErr } = await supabase
          .from("overtime_reports").insert({ ...payload, report_no: noData }).select("id,report_no").single();
        if (insErr) throw insErr;
        if (submitForApproval && f.approver_id) {
          notifyOvertimeApprovalRequest({
            approverId: f.approver_id, authorName: authorAcc?.username ?? user.name,
            reportNo: noData, reportId: (inserted as { id: number }).id,
            siteName: f.site_name, startAt: startDT,
          }).catch(console.warn);
        }
      } else {
        const { error } = await supabase.from("overtime_reports").update(payload).eq("id", editingId!);
        if (error) throw error;
        const rep = myReports.find(r => r.id === editingId);
        if (submitForApproval && f.approver_id && rep) {
          notifyOvertimeApprovalRequest({
            approverId: f.approver_id, authorName: authorAcc?.username ?? user.name,
            reportNo: rep.report_no, reportId: rep.id,
            siteName: f.site_name, startAt: startDT,
          }).catch(console.warn);
        }
      }
      await load();
      setEditingId(null);
    } catch (e: unknown) {
      alert("저장 실패: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  async function approve(r: OvertimeReport) {
    if (!user || !confirm("승인하시겠습니까?")) return;
    const { error } = await supabase.from("overtime_reports")
      .update({ approval_status: "approved", approved_at: new Date().toISOString() }).eq("id", r.id);
    if (error) { alert("승인 실패: " + error.message); return; }
    notifyOvertimeApproved({ authorId: r.author_id, approverName: authorAcc?.username ?? user.name, reportNo: r.report_no, reportId: r.id }).catch(console.warn);
    await load();
  }

  async function reject() {
    if (!rejectModal || !user) return;
    if (!rejectReason.trim()) { alert("반려 사유를 입력해주세요."); return; }
    const { error } = await supabase.from("overtime_reports")
      .update({ approval_status: "rejected", rejected_at: new Date().toISOString(), reject_reason: rejectReason.trim() })
      .eq("id", rejectModal.id);
    if (error) { alert("반려 실패: " + error.message); return; }
    const rep = myReports.find(r => r.id === rejectModal.id);
    if (rep) {
      notifyOvertimeRejected({ authorId: rep.author_id, approverName: authorAcc?.username ?? user.name, reportNo: rep.report_no, reportId: rep.id, reason: rejectReason.trim() }).catch(console.warn);
    }
    setRejectModal(null); setRejectReason(""); await load();
  }

  const canEditReport = (r: OvertimeReport) =>
    user && (isManager || (r.author_id === user.id && r.approval_status !== "approved"));
  const canApproveReport = (r: OvertimeReport) =>
    user && r.approver_id === user.id && r.approval_status === "pending";

  // ── 렌더 ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-gray-100 dark:bg-gray-900 text-sm">
      {/* 상단 툴바 */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h1 className="text-base font-bold text-gray-800 dark:text-gray-100">잔업보고서</h1>
        <div className="flex gap-2">
          {editingId !== null ? (
            <>
              <button onClick={() => save(false)} disabled={saving}
                className="px-3 py-1.5 text-xs bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 rounded font-medium disabled:opacity-50">
                {saving ? "저장중…" : "임시저장"}
              </button>
              <button onClick={() => save(true)} disabled={saving}
                className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-50">
                {saving ? "제출중…" : "결재 요청"}
              </button>
              <button onClick={() => setEditingId(null)}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                목록으로
              </button>
            </>
          ) : canCreate && (
            <button onClick={openNew}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium">
              + 새 보고서
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* ══════════════ 문서 양식 뷰 ══════════════ */}
        {editingId !== null && (
          <div className="p-4 flex justify-center">
            <div className="w-full max-w-4xl bg-white dark:bg-gray-800 shadow-lg border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
              style={{ fontFamily: "'Malgun Gothic', '맑은 고딕', sans-serif" }}>

              {/* ── 제목 + 결재란 ── */}
              <div className="flex items-stretch border-b border-gray-400 dark:border-gray-500">
                {/* 제목 영역 */}
                <div className="flex-1 px-8 py-5">
                  <h2 className="text-3xl font-black tracking-widest underline">잔업보고서</h2>
                  <p className="mt-3 text-sm">
                    아래와 같이 시간외 근로(잔업) 사유가 발생하였기에 보고서를 제출합니다.
                  </p>
                </div>
                {/* 결재란 */}
                <div className="border-l border-gray-400 dark:border-gray-500">
                  {/* 직책 헤더 */}
                  <div className="flex">
                    {["담당", "팀장", "임원", "대표", "대표"].map((role, i) => (
                      <div key={i} className={`w-16 text-center text-xs py-1 font-medium ${i < 4 ? "border-r border-gray-400 dark:border-gray-500" : ""}`}>
                        {role}
                      </div>
                    ))}
                  </div>
                  {/* 서명 공간 */}
                  <div className="flex border-t border-gray-400 dark:border-gray-500">
                    {["담당", "팀장", "임원", "대표", "대표"].map((role, i) => (
                      <div key={i} className={`w-16 h-14 flex items-center justify-center text-xs text-gray-400 ${i < 4 ? "border-r border-gray-400 dark:border-gray-500" : ""}`}>
                        {i === 0 && approverAcc && (
                          <span className="text-[10px] text-gray-600 dark:text-gray-300 text-center leading-tight px-1">
                            {approverAcc.username}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* 날짜 라인 */}
                  <div className="flex border-t border-gray-400 dark:border-gray-500">
                    {[0,1,2,3,4].map(i => (
                      <div key={i} className={`w-16 text-center text-[10px] py-0.5 text-gray-400 ${i < 4 ? "border-r border-gray-400 dark:border-gray-500" : ""}`}>
                        /
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── 결재 승인자 선택 (문서 외부 보조 필드) ── */}
              <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-950/20 border-b border-blue-200 dark:border-blue-800 text-xs">
                <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">결재 승인자:</span>
                <select
                  value={f.approver_id ?? ""}
                  onChange={e => sf({ approver_id: e.target.value ? Number(e.target.value) : null })}
                  className="flex-1 max-w-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400 text-xs">
                  <option value="">승인자 선택</option>
                  {activeAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.username}{a.dept ? ` (${a.dept})` : ""}</option>
                  ))}
                </select>
                {otResult && (
                  <span className="ml-auto font-semibold text-blue-700 dark:text-blue-300">{otResult.display}</span>
                )}
              </div>

              {/* ── 폼 테이블 ── */}
              <table className="w-full border-collapse text-sm">
                <colgroup>
                  <col style={{ width: "90px" }} />
                  <col />
                  <col style={{ width: "90px" }} />
                  <col />
                </colgroup>
                <tbody>

                  {/* 현장명 + 작업지시자 */}
                  <tr className="border-b border-gray-400 dark:border-gray-500">
                    <td className="border-r border-gray-400 dark:border-gray-500 px-2 py-2 font-bold text-center bg-gray-50 dark:bg-gray-700/50 text-xs whitespace-nowrap">
                      현 장 명
                    </td>
                    <td className="border-r border-gray-400 dark:border-gray-500 px-1 py-1">
                      <input type="text" value={f.site_name} onChange={e => sf({ site_name: e.target.value })}
                        placeholder="현장명 입력" className={cellInput} />
                    </td>
                    <td className="border-r border-gray-400 dark:border-gray-500 px-2 py-2 font-bold text-center bg-gray-50 dark:bg-gray-700/50 text-xs whitespace-nowrap">
                      작업지시자
                    </td>
                    <td className="px-1 py-1">
                      <select
                        value={f.work_instructor_id ?? ""}
                        onChange={e => {
                          const id = e.target.value ? Number(e.target.value) : null;
                          const name = id ? (accounts.find(a=>a.id===id)?.username ?? "") : "";
                          sf({ work_instructor_id: id, work_instructor: name });
                        }}
                        className={`${cellInput} cursor-pointer`}>
                        <option value="">직접 입력</option>
                        {activeAccounts.map(a => (
                          <option key={a.id} value={a.id}>{a.username}{a.dept ? ` (${a.dept})` : ""}</option>
                        ))}
                      </select>
                      {!f.work_instructor_id && (
                        <input type="text" value={f.work_instructor}
                          onChange={e => sf({ work_instructor: e.target.value })}
                          placeholder="이름 직접 입력" className={cellInput} />
                      )}
                    </td>
                  </tr>

                  {/* 작업사유 */}
                  <tr className="border-b border-gray-400 dark:border-gray-500">
                    <td className="border-r border-gray-400 dark:border-gray-500 px-2 py-2 font-bold text-center bg-gray-50 dark:bg-gray-700/50 text-xs">
                      작업사유
                    </td>
                    <td colSpan={3} className="px-3 py-2">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {WORK_REASONS.map(r => (
                          <label key={r} className="flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" checked={f.work_reasons.includes(r)}
                              onChange={e => sf({ work_reasons: e.target.checked ? [...f.work_reasons, r] : f.work_reasons.filter(x=>x!==r) })}
                              className="accent-gray-700 dark:accent-gray-300" />
                            {r}(
                            {f.work_reasons.includes(r) ? "✔" : "  "}
                            )
                          </label>
                        ))}
                        {f.work_reasons.includes("기타") && (
                          <input type="text" value={f.work_reason_etc}
                            onChange={e => sf({ work_reason_etc: e.target.value })}
                            placeholder="기타 내용" className="border-b border-gray-400 bg-transparent focus:outline-none text-sm w-32 px-1" />
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* 작업호기 */}
                  <tr className="border-b border-gray-400 dark:border-gray-500">
                    <td className="border-r border-gray-400 dark:border-gray-500 px-2 py-2 font-bold text-center bg-gray-50 dark:bg-gray-700/50 text-xs">
                      작업호기
                    </td>
                    <td colSpan={3} className="px-1 py-1">
                      <input type="text" value={f.work_elevator}
                        onChange={e => sf({ work_elevator: e.target.value })}
                        placeholder="예: 1호기, 2·3호기" className={cellInput} />
                    </td>
                  </tr>

                  {/* 작업일시 시작 */}
                  <tr className="border-b border-gray-300 dark:border-gray-600">
                    <td rowSpan={2} className="border-r border-gray-400 dark:border-gray-500 px-2 py-2 font-bold text-center bg-gray-50 dark:bg-gray-700/50 text-xs align-middle">
                      작업일시
                    </td>
                    <td colSpan={2} className="border-r border-gray-400 dark:border-gray-500 px-3 py-2">
                      <div className="flex items-center gap-1 text-sm flex-wrap">
                        <span>20</span>
                        <input type="text" value={f.s_yr} maxLength={2} placeholder="YY"
                          onChange={e => { sf({ s_yr: e.target.value }); detectFromStart(e.target.value, f.s_mo, f.s_dy); }}
                          className={`${partInput} w-8`} />
                        <span>년</span>
                        <input type="text" value={f.s_mo} maxLength={2} placeholder="MM"
                          onChange={e => { sf({ s_mo: e.target.value }); detectFromStart(f.s_yr, e.target.value, f.s_dy); }}
                          className={`${partInput} w-8`} />
                        <span>월</span>
                        <input type="text" value={f.s_dy} maxLength={2} placeholder="DD"
                          onChange={e => { sf({ s_dy: e.target.value }); detectFromStart(f.s_yr, f.s_mo, e.target.value); }}
                          className={`${partInput} w-8`} />
                        <span>일(</span>
                        <span className="w-5 text-center font-medium text-blue-700 dark:text-blue-300">
                          {startDow || "?"}
                        </span>
                        <span>요일)</span>
                        <input type="text" value={f.s_hr} maxLength={2} placeholder="HH"
                          onChange={e => sf({ s_hr: e.target.value })}
                          className={`${partInput} w-8`} />
                        <span>시</span>
                        <input type="text" value={f.s_mi} maxLength={2} placeholder="mm"
                          onChange={e => sf({ s_mi: e.target.value })}
                          className={`${partInput} w-8`} />
                        <span>분부터</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {otResult ? (
                        <span className="text-sm font-bold text-blue-700 dark:text-blue-300">
                          ( {otResult.display} )
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">( &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; HR)</span>
                      )}
                    </td>
                  </tr>

                  {/* 작업일시 종료 */}
                  <tr className="border-b border-gray-400 dark:border-gray-500">
                    <td colSpan={2} className="border-r border-gray-400 dark:border-gray-500 px-3 py-2">
                      <div className="flex items-center gap-1 text-sm flex-wrap">
                        <span>20</span>
                        <input type="text" value={f.e_yr} maxLength={2} placeholder="YY"
                          onChange={e => sf({ e_yr: e.target.value })}
                          className={`${partInput} w-8`} />
                        <span>년</span>
                        <input type="text" value={f.e_mo} maxLength={2} placeholder="MM"
                          onChange={e => sf({ e_mo: e.target.value })}
                          className={`${partInput} w-8`} />
                        <span>월</span>
                        <input type="text" value={f.e_dy} maxLength={2} placeholder="DD"
                          onChange={e => sf({ e_dy: e.target.value })}
                          className={`${partInput} w-8`} />
                        <span>일(</span>
                        <span className="w-5 text-center font-medium text-blue-700 dark:text-blue-300">
                          {endDow || "?"}
                        </span>
                        <span>요일)</span>
                        <input type="text" value={f.e_hr} maxLength={2} placeholder="HH"
                          onChange={e => sf({ e_hr: e.target.value })}
                          className={`${partInput} w-8`} />
                        <span>시</span>
                        <input type="text" value={f.e_mi} maxLength={2} placeholder="mm"
                          onChange={e => sf({ e_mi: e.target.value })}
                          className={`${partInput} w-8`} />
                        <span>분부터</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {/* 휴일 체크 */}
                      <label className="flex items-center gap-1 text-xs cursor-pointer">
                        <input type="checkbox" checked={f.is_holiday}
                          onChange={e => sf({ is_holiday: e.target.checked, holiday_type: e.target.checked ? (f.holiday_type || "공휴일") : "" })}
                          className="accent-orange-500" />
                        <span>휴일</span>
                        {f.is_holiday && (
                          <select value={f.holiday_type}
                            onChange={e => sf({ holiday_type: e.target.value })}
                            className="ml-1 text-xs border-b border-gray-400 bg-transparent focus:outline-none">
                            <option>토요일</option><option>일요일</option><option>공휴일</option>
                          </select>
                        )}
                      </label>
                    </td>
                  </tr>

                  {/* 작업자명 */}
                  <tr className="border-b border-gray-400 dark:border-gray-500">
                    <td className="border-r border-gray-400 dark:border-gray-500 px-2 py-2 font-bold text-center bg-gray-50 dark:bg-gray-700/50 text-xs">
                      작업자명
                    </td>
                    <td colSpan={3} className="px-2 py-2">
                      <div className="grid grid-cols-4 sm:grid-cols-8 gap-1">
                        {f.workers.map((w, i) => (
                          <input key={i} type="text" value={w}
                            onChange={e => {
                              const ws = [...f.workers]; ws[i] = e.target.value; sf({ workers: ws });
                            }}
                            placeholder={`작업자${i+1}`}
                            className="border-b border-gray-400 bg-transparent text-sm text-center focus:outline-none focus:border-blue-500 px-1 py-0.5 w-full placeholder:text-gray-300 dark:placeholder:text-gray-600" />
                        ))}
                      </div>
                    </td>
                  </tr>

                  {/* 비고 */}
                  <tr className="border-b border-gray-400 dark:border-gray-500">
                    <td className="border-r border-gray-400 dark:border-gray-500 px-2 py-2 font-bold text-center bg-gray-50 dark:bg-gray-700/50 text-xs">
                      비 고
                    </td>
                    <td colSpan={3} className="px-1 py-1">
                      <input type="text" value={f.note}
                        onChange={e => sf({ note: e.target.value })}
                        className={cellInput} />
                    </td>
                  </tr>

                  {/* 작성자 + 작성일자 */}
                  <tr className="border-b border-gray-400 dark:border-gray-500">
                    <td className="border-r border-gray-400 dark:border-gray-500 px-2 py-2 font-bold text-center bg-gray-50 dark:bg-gray-700/50 text-xs">
                      작 성 자
                    </td>
                    <td className="border-r border-gray-400 dark:border-gray-500 px-3 py-2 text-sm">
                      {authorAcc?.username ?? user?.name ?? ""}
                    </td>
                    <td className="border-r border-gray-400 dark:border-gray-500 px-2 py-2 font-bold text-center bg-gray-50 dark:bg-gray-700/50 text-xs whitespace-nowrap">
                      작성일자
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">
                      {todayStr}
                    </td>
                  </tr>

                  {/* 작업내용 */}
                  <tr className="border-b border-gray-400 dark:border-gray-500">
                    <td colSpan={4} className="px-3 pt-2 pb-0">
                      <p className="text-xs font-bold mb-1">※ 작업내용(점검 및 수리 경우 호기별 기록)</p>
                      <textarea value={f.work_content}
                        onChange={e => sf({ work_content: e.target.value })}
                        rows={8} placeholder="작업내용을 입력하세요…"
                        className={`${cellTArea} min-h-[180px]`} />
                    </td>
                  </tr>

                  {/* 작업결과 */}
                  <tr>
                    <td colSpan={4} className="px-3 pt-2 pb-3">
                      <p className="text-xs font-bold mb-1">※ 작업결과</p>
                      <textarea value={f.work_result}
                        onChange={e => sf({ work_result: e.target.value })}
                        rows={5} placeholder="작업결과를 입력하세요…"
                        className={`${cellTArea} min-h-[100px]`} />
                    </td>
                  </tr>

                </tbody>
              </table>

              {/* 회사명 */}
              <div className="border-t border-gray-400 dark:border-gray-500 px-4 py-2 text-right text-sm font-bold text-gray-600 dark:text-gray-400">
                주식회사 대솔E/L
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ 목록 뷰 ══════════════ */}
        {editingId === null && (
          <div className="p-4">
            {myReports.length === 0 ? (
              <div className="text-center text-sm text-gray-400 py-16">등록된 잔업보고서가 없습니다.</div>
            ) : (
              <div className="space-y-3">
                {myReports.map(r => {
                  const author   = accounts.find(a => a.id === r.author_id);
                  const approver = accounts.find(a => a.id === r.approver_id);
                  const s = new Date(r.start_at), e = new Date(r.end_at);
                  const ot = calcOvertimeResult(s, e, r.is_holiday);
                  return (
                    <div key={r.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono text-gray-400">{r.report_no}</span>
                            <StatusBadge status={r.approval_status} />
                            {r.is_holiday && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                                {r.holiday_type ?? "휴일"}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 font-medium">{r.site_name}</p>
                          <div className="mt-0.5 text-xs text-gray-500 space-y-0.5">
                            <p>
                              {s.toLocaleDateString("ko-KR")} {s.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}
                              {" ~ "}
                              {e.toLocaleDateString("ko-KR")} {e.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}
                            </p>
                            <p className="text-blue-600 dark:text-blue-400 font-medium">{ot.display}</p>
                            <p>작업사유: {r.work_reasons.join(", ") || "-"}</p>
                            {author   && <p>작성자: {author.username}</p>}
                            {approver && <p>승인자: {approver.username}</p>}
                          </div>
                          {r.approval_status === "rejected" && r.reject_reason && (
                            <p className="mt-1 text-xs text-red-500">반려: {r.reject_reason}</p>
                          )}
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          {canEditReport(r) && (
                            <button onClick={() => openEdit(r)}
                              className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded">
                              수정
                            </button>
                          )}
                          {canApproveReport(r) && (
                            <>
                              <button onClick={() => approve(r)}
                                className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded">
                                승인
                              </button>
                              <button onClick={() => { setRejectModal({ id: r.id, reportNo: r.report_no }); setRejectReason(""); }}
                                className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded">
                                반려
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 반려 모달 */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-80">
            <h3 className="text-sm font-bold mb-2">반려 사유 입력</h3>
            <p className="text-xs text-gray-400 mb-2">{rejectModal.reportNo}</p>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              rows={4} placeholder="반려 사유를 입력하세요"
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-700 focus:outline-none resize-none" />
            <div className="flex gap-2 mt-3">
              <button onClick={reject} className="flex-1 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded font-medium">반려 처리</button>
              <button onClick={() => setRejectModal(null)} className="flex-1 py-1.5 text-xs bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 rounded">취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
