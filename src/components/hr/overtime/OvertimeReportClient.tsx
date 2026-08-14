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
type WorkReason = (typeof WORK_REASONS)[number];

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

const emptyForm = (): Omit<OvertimeReport, "id" | "report_no" | "author_id" | "created_at" | "updated_at" | "submitted_at" | "approved_at" | "rejected_at"> => ({
  site_name: "",
  work_instructor: "",
  work_instructor_id: null,
  work_reasons: [],
  work_reason_etc: "",
  work_elevator: "",
  start_at: "",
  end_at: "",
  is_holiday: false,
  holiday_type: null,
  work_hours: null,
  holiday_hours: null,
  overtime_hours: null,
  workers: [""],
  work_content: "",
  work_result: "",
  note: "",
  approver_id: null,
  approval_status: "draft",
  reject_reason: null,
});

const inputCls = "w-full px-2 py-1 text-xs font-medium text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 placeholder:text-gray-400 dark:placeholder:text-gray-500";
const labelCls = "text-xs text-gray-500 dark:text-gray-400 mb-1 block";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft:    { label: "작성중",   cls: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
    pending:  { label: "결재 요청", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
    approved: { label: "승인완료", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
    rejected: { label: "반려",     cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  };
  const s = map[status] ?? { label: status, cls: "bg-gray-100 text-gray-500" };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>;
}

export default function OvertimeReportClient() {
  const { user } = useAuth();
  const canCreate = user ? (isAdmin(user) || hasMenuPermission(user, OT_MENU_HREF, "create")) : false;
  const isManager = user ? (isAdmin(user) || hasMenuPermission(user, OT_MENU_HREF, "update")) : false;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [myReports, setMyReports] = useState<OvertimeReport[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null); // null = 새 보고서
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [otResult, setOtResult] = useState<OvertimeResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [rejectModal, setRejectModal] = useState<{ id: number; reportNo: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    const PAGE = 500;
    const rows: OvertimeReport[] = [];
    for (let off = 0; ; off += PAGE) {
      let q = supabase
        .from("overtime_reports")
        .select("*")
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
      const { data } = await supabase
        .from("accounts")
        .select("id, username, dept, status")
        .order("username");
      setAccounts((data as Account[] | null) ?? []);
    })();
  }, []);

  useEffect(() => { load(); }, [load]);
  useReloadOnActivate(load);

  // 날짜/시간이 바뀔 때 자동 계산
  useEffect(() => {
    if (!form.start_at || !form.end_at) { setOtResult(null); return; }
    const s = new Date(form.start_at);
    const e = new Date(form.end_at);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) { setOtResult(null); return; }
    const result = calcOvertimeResult(s, e, form.is_holiday);
    setOtResult(result);
    setForm(f => ({
      ...f,
      work_hours:     result.workHours,
      holiday_hours:  result.holidayHours,
      overtime_hours: result.overtimeHours,
    }));
  }, [form.start_at, form.end_at, form.is_holiday]);

  // 시작일 변경 시 휴일 자동 감지
  function handleStartChange(val: string) {
    setForm(f => {
      const next = { ...f, start_at: val };
      if (val) {
        const d = new Date(val);
        if (!isNaN(d.getTime())) {
          const { isHoliday, holidayType } = detectHoliday(d);
          next.is_holiday  = isHoliday;
          next.holiday_type = holidayType;
        }
      }
      return next;
    });
  }

  function openNew() {
    const today = new Date().toISOString().slice(0, 16);
    const detected = detectHoliday(new Date());
    setForm({
      ...emptyForm(),
      start_at:     today,
      is_holiday:   detected.isHoliday,
      holiday_type: detected.holidayType,
    });
    setEditingId(null);
    setOtResult(null);
    setShowForm(true);
  }

  function openEdit(r: OvertimeReport) {
    setForm({
      site_name:         r.site_name,
      work_instructor:   r.work_instructor ?? "",
      work_instructor_id: r.work_instructor_id,
      work_reasons:      r.work_reasons,
      work_reason_etc:   r.work_reason_etc ?? "",
      work_elevator:     r.work_elevator ?? "",
      start_at:          r.start_at ? r.start_at.slice(0, 16) : "",
      end_at:            r.end_at   ? r.end_at.slice(0, 16)   : "",
      is_holiday:        r.is_holiday,
      holiday_type:      r.holiday_type,
      work_hours:        r.work_hours,
      holiday_hours:     r.holiday_hours,
      overtime_hours:    r.overtime_hours,
      workers:           r.workers.length ? r.workers : [""],
      work_content:      r.work_content ?? "",
      work_result:       r.work_result ?? "",
      note:              r.note ?? "",
      approver_id:       r.approver_id,
      approval_status:   r.approval_status,
      reject_reason:     r.reject_reason,
    });
    setEditingId(r.id);
    setOtResult(null);
    setShowForm(true);
  }

  async function save(submitForApproval = false) {
    if (!user) return;
    if (!form.site_name.trim()) { alert("현장명을 입력해주세요."); return; }
    if (!form.start_at || !form.end_at) { alert("작업일시를 입력해주세요."); return; }
    if (submitForApproval && !form.approver_id) { alert("결재 승인자를 지정해주세요."); return; }
    setSaving(true);
    try {
      const payload = {
        author_id:          user.id,
        site_name:          form.site_name.trim(),
        work_instructor:    form.work_instructor?.trim() || null,
        work_instructor_id: form.work_instructor_id,
        work_reasons:       form.work_reasons,
        work_reason_etc:    form.work_reason_etc?.trim() || null,
        work_elevator:      form.work_elevator?.trim() || null,
        start_at:           new Date(form.start_at).toISOString(),
        end_at:             new Date(form.end_at).toISOString(),
        is_holiday:         form.is_holiday,
        holiday_type:       form.holiday_type || null,
        work_hours:         form.work_hours,
        holiday_hours:      form.holiday_hours,
        overtime_hours:     form.overtime_hours,
        workers:            form.workers.filter(w => w.trim()),
        work_content:       form.work_content?.trim() || null,
        work_result:        form.work_result?.trim() || null,
        note:               form.note?.trim() || null,
        approver_id:        form.approver_id,
        approval_status:    submitForApproval ? "pending" : "draft",
        submitted_at:       submitForApproval ? new Date().toISOString() : null,
      };

      if (editingId === null) {
        // 신규: 문서번호 채번
        const { data: noData, error: noErr } = await supabase.rpc("next_ot_no");
        if (noErr) throw new Error("문서번호 채번 실패: " + noErr.message);
        const { data: inserted, error: insErr } = await supabase
          .from("overtime_reports")
          .insert({ ...payload, report_no: noData })
          .select("id, report_no")
          .single();
        if (insErr) throw insErr;
        if (submitForApproval && form.approver_id) {
          const authorAcc = accounts.find(a => a.id === user.id);
          notifyOvertimeApprovalRequest({
            approverId: form.approver_id,
            authorName: authorAcc?.username ?? user.name,
            reportNo:   noData,
            reportId:   (inserted as { id: number }).id,
            siteName:   form.site_name,
            startAt:    form.start_at,
          }).catch(console.warn);
        }
      } else {
        const { error: updErr } = await supabase
          .from("overtime_reports")
          .update(payload)
          .eq("id", editingId);
        if (updErr) throw updErr;
        const rep = myReports.find(r => r.id === editingId);
        if (submitForApproval && form.approver_id && rep) {
          const authorAcc = accounts.find(a => a.id === user.id);
          notifyOvertimeApprovalRequest({
            approverId: form.approver_id,
            authorName: authorAcc?.username ?? user.name,
            reportNo:   rep.report_no,
            reportId:   editingId,
            siteName:   form.site_name,
            startAt:    form.start_at,
          }).catch(console.warn);
        }
      }
      await load();
      setShowForm(false);
    } catch (e: unknown) {
      alert("저장 실패: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  async function approve(r: OvertimeReport) {
    if (!user) return;
    if (!confirm("승인하시겠습니까?")) return;
    const { error } = await supabase
      .from("overtime_reports")
      .update({ approval_status: "approved", approved_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) { alert("승인 실패: " + error.message); return; }
    const approverAcc = accounts.find(a => a.id === user.id);
    notifyOvertimeApproved({
      authorId:     r.author_id,
      approverName: approverAcc?.username ?? user.name,
      reportNo:     r.report_no,
      reportId:     r.id,
    }).catch(console.warn);
    await load();
  }

  async function reject() {
    if (!rejectModal || !user) return;
    if (!rejectReason.trim()) { alert("반려 사유를 입력해주세요."); return; }
    const { error } = await supabase
      .from("overtime_reports")
      .update({
        approval_status: "rejected",
        rejected_at: new Date().toISOString(),
        reject_reason: rejectReason.trim(),
      })
      .eq("id", rejectModal.id);
    if (error) { alert("반려 실패: " + error.message); return; }
    const rep = myReports.find(r => r.id === rejectModal.id);
    const approverAcc = accounts.find(a => a.id === user.id);
    if (rep) {
      notifyOvertimeRejected({
        authorId:     rep.author_id,
        approverName: approverAcc?.username ?? user.name,
        reportNo:     rep.report_no,
        reportId:     rep.id,
        reason:       rejectReason.trim(),
      }).catch(console.warn);
    }
    setRejectModal(null);
    setRejectReason("");
    await load();
  }

  function canEditReport(r: OvertimeReport) {
    if (!user) return false;
    if (isManager) return true;
    return r.author_id === user.id && r.approval_status !== "approved";
  }

  function canApproveReport(r: OvertimeReport) {
    if (!user) return false;
    return r.approver_id === user.id && r.approval_status === "pending";
  }

  const startDate = form.start_at ? new Date(form.start_at) : null;

  // 작업자 배열 조작
  function setWorker(idx: number, val: string) {
    setForm(f => {
      const w = [...f.workers];
      w[idx] = val;
      return { ...f, workers: w };
    });
  }
  function addWorker() { setForm(f => ({ ...f, workers: [...f.workers, ""] })); }
  function removeWorker(idx: number) {
    setForm(f => {
      const w = f.workers.filter((_, i) => i !== idx);
      return { ...f, workers: w.length ? w : [""] };
    });
  }

  const activeAccounts = useMemo(() => accounts.filter(a => a.status !== "퇴직"), [accounts]);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-100">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h1 className="text-base font-bold">잔업보고서</h1>
        {canCreate && !showForm && (
          <button onClick={openNew}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium">
            + 새 보고서
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {/* ── 작성/수정 폼 ── */}
        {showForm && (
          <div className="p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
              {/* 폼 헤더 */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                <span className="text-sm font-bold">
                  {editingId === null ? "잔업보고서 작성" : "잔업보고서 수정"}
                </span>
                <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
              </div>

              <div className="p-4 space-y-5">
                {/* 결재 + 현장/지시자 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>결재 승인자</label>
                    <select
                      value={form.approver_id ?? ""}
                      onChange={e => setForm(f => ({ ...f, approver_id: e.target.value ? Number(e.target.value) : null }))}
                      className={inputCls}>
                      <option value="">승인자 선택</option>
                      {activeAccounts.map(a => (
                        <option key={a.id} value={a.id}>{a.username}{a.dept ? ` (${a.dept})` : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>현장명 <span className="text-red-500">*</span></label>
                    <input
                      type="text" value={form.site_name}
                      onChange={e => setForm(f => ({ ...f, site_name: e.target.value }))}
                      placeholder="현장명 입력" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>작업지시자</label>
                    <select
                      value={form.work_instructor_id ?? ""}
                      onChange={e => {
                        const id = e.target.value ? Number(e.target.value) : null;
                        const name = id ? (accounts.find(a => a.id === id)?.username ?? "") : "";
                        setForm(f => ({ ...f, work_instructor_id: id, work_instructor: name }));
                      }}
                      className={inputCls}>
                      <option value="">선택 (또는 직접 입력)</option>
                      {activeAccounts.map(a => (
                        <option key={a.id} value={a.id}>{a.username}{a.dept ? ` (${a.dept})` : ""}</option>
                      ))}
                    </select>
                    {!form.work_instructor_id && (
                      <input
                        type="text" value={form.work_instructor ?? ""}
                        onChange={e => setForm(f => ({ ...f, work_instructor: e.target.value }))}
                        placeholder="직접 입력" className={`${inputCls} mt-1`} />
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>작업호기</label>
                    <input
                      type="text" value={form.work_elevator ?? ""}
                      onChange={e => setForm(f => ({ ...f, work_elevator: e.target.value }))}
                      placeholder="예: 1호기, 2·3호기" className={inputCls} />
                  </div>
                </div>

                {/* 작업사유 */}
                <div>
                  <label className={labelCls}>작업사유</label>
                  <div className="flex flex-wrap gap-3">
                    {WORK_REASONS.map(r => (
                      <label key={r} className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.work_reasons.includes(r)}
                          onChange={e => {
                            setForm(f => ({
                              ...f,
                              work_reasons: e.target.checked
                                ? [...f.work_reasons, r]
                                : f.work_reasons.filter(x => x !== r),
                            }));
                          }}
                          className="rounded accent-blue-600" />
                        {r}
                      </label>
                    ))}
                  </div>
                  {form.work_reasons.includes("기타") && (
                    <input
                      type="text" value={form.work_reason_etc ?? ""}
                      onChange={e => setForm(f => ({ ...f, work_reason_etc: e.target.value }))}
                      placeholder="기타 사유 입력" className={`${inputCls} mt-2`} />
                  )}
                </div>

                {/* 작업일시 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={labelCls + " mb-0"}>작업일시 <span className="text-red-500">*</span></label>
                    {otResult && (
                      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                        {otResult.display}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-gray-400 mb-0.5 block">시작 일시</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="datetime-local" value={form.start_at}
                          onChange={e => handleStartChange(e.target.value)}
                          className={inputCls} />
                        {startDate && (
                          <span className="text-xs text-gray-500 whitespace-nowrap">
                            ({dayOfWeekKr(startDate)})
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400 mb-0.5 block">종료 일시</label>
                      <input
                        type="datetime-local" value={form.end_at}
                        onChange={e => setForm(f => ({ ...f, end_at: e.target.value }))}
                        className={inputCls} />
                    </div>
                  </div>
                  {/* 휴일 설정 */}
                  <div className="flex items-center gap-3 mt-2">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="checkbox" checked={form.is_holiday}
                        onChange={e => setForm(f => ({ ...f, is_holiday: e.target.checked, holiday_type: e.target.checked ? (f.holiday_type || "공휴일") : null }))}
                        className="rounded accent-blue-600" />
                      휴일근무
                    </label>
                    {form.is_holiday && (
                      <select
                        value={form.holiday_type ?? "공휴일"}
                        onChange={e => setForm(f => ({ ...f, holiday_type: e.target.value }))}
                        className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 focus:outline-none">
                        <option>토요일</option>
                        <option>일요일</option>
                        <option>공휴일</option>
                      </select>
                    )}
                  </div>
                </div>

                {/* 작업자명 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={labelCls + " mb-0"}>작업자명</label>
                    <button onClick={addWorker} className="text-xs text-blue-600 hover:underline">+ 추가</button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {form.workers.map((w, i) => (
                      <div key={i} className="flex gap-1">
                        <input
                          type="text" value={w}
                          onChange={e => setWorker(i, e.target.value)}
                          placeholder={`작업자 ${i + 1}`}
                          className={inputCls} />
                        {form.workers.length > 1 && (
                          <button onClick={() => removeWorker(i)} className="text-gray-400 hover:text-red-500 text-base leading-none px-0.5">×</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 작업내용 */}
                <div>
                  <label className={labelCls}>작업내용 <span className="text-[11px] text-gray-400">(점검 및 수리 경우 호기별 기록)</span></label>
                  <textarea
                    value={form.work_content ?? ""}
                    onChange={e => setForm(f => ({ ...f, work_content: e.target.value }))}
                    rows={5} placeholder="작업내용 입력"
                    className={`${inputCls} resize-y`} />
                </div>

                {/* 작업결과 */}
                <div>
                  <label className={labelCls}>작업결과</label>
                  <textarea
                    value={form.work_result ?? ""}
                    onChange={e => setForm(f => ({ ...f, work_result: e.target.value }))}
                    rows={3} placeholder="작업결과 입력"
                    className={`${inputCls} resize-y`} />
                </div>

                {/* 비고 */}
                <div>
                  <label className={labelCls}>비고</label>
                  <textarea
                    value={form.note ?? ""}
                    onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                    rows={2} className={`${inputCls} resize-y`} />
                </div>

                {/* 반려 사유 표시 */}
                {form.approval_status === "rejected" && form.reject_reason && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded p-3">
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium">반려 사유</p>
                    <p className="text-xs mt-1">{form.reject_reason}</p>
                  </div>
                )}

                {/* 저장 버튼 */}
                <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                  <button onClick={() => save(false)} disabled={saving}
                    className="px-4 py-1.5 text-xs bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded font-medium disabled:opacity-50">
                    {saving ? "저장중…" : "임시저장"}
                  </button>
                  <button onClick={() => save(true)} disabled={saving}
                    className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-50">
                    {saving ? "제출중…" : "결재 요청"}
                  </button>
                  <button onClick={() => setShowForm(false)}
                    className="ml-auto px-4 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 목록 ── */}
        {!showForm && (
          <div className="p-4">
            {myReports.length === 0 ? (
              <div className="text-center text-sm text-gray-400 py-16">등록된 잔업보고서가 없습니다.</div>
            ) : (
              <div className="space-y-3">
                {myReports.map(r => {
                  const authorAcc = accounts.find(a => a.id === r.author_id);
                  const approverAcc = accounts.find(a => a.id === r.approver_id);
                  const s = new Date(r.start_at);
                  const e = new Date(r.end_at);
                  return (
                    <div key={r.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono text-gray-500">{r.report_no}</span>
                            <StatusBadge status={r.approval_status} />
                            {r.is_holiday && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                                {r.holiday_type ?? "휴일"}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm font-medium">{r.site_name}</p>
                          <div className="mt-0.5 text-xs text-gray-500 space-y-0.5">
                            <p>
                              {s.toLocaleDateString("ko-KR")} {s.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                              {" ~ "}
                              {e.toLocaleDateString("ko-KR")} {e.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                            {r.work_hours != null && (
                              <p className="text-blue-600 dark:text-blue-400 font-medium">
                                {calcOvertimeResult(s, e, r.is_holiday).display}
                              </p>
                            )}
                            <p>작업사유: {r.work_reasons.join(", ") || "-"}{r.work_reason_etc ? ` / ${r.work_reason_etc}` : ""}</p>
                            {r.work_elevator && <p>호기: {r.work_elevator}</p>}
                            {authorAcc && <p>작성자: {authorAcc.username}</p>}
                            {approverAcc && <p>승인자: {approverAcc.username}</p>}
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
            <h3 className="text-sm font-bold mb-3">반려 사유 입력</h3>
            <p className="text-xs text-gray-500 mb-2">{rejectModal.reportNo}</p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={4} placeholder="반려 사유를 입력하세요"
              className={`${inputCls} resize-none`} />
            <div className="flex gap-2 mt-3">
              <button onClick={reject}
                className="flex-1 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded font-medium">
                반려 처리
              </button>
              <button onClick={() => setRejectModal(null)}
                className="flex-1 py-1.5 text-xs bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 rounded">
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
