"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { calcOvertimeResult, detectHoliday, dayOfWeekKr, OvertimeResult } from "./overtimeCalc";
import { notifyOvertimeApprovalRequest, notifyOvertimeApproved, notifyOvertimeRejected } from "./overtimeNotify";

export const OT_MENU_HREF = "/hr/overtime-report";
const WORK_REASONS = ["점검", "공사", "수리·부품교체", "상주", "조출", "기타"] as const;

interface Account { id: number; username: string; dept: string | null; status: string | null; }
interface OvertimeReport {
  id: number; report_no: string; author_id: number; site_name: string;
  work_instructor: string | null; work_instructor_id: number | null;
  work_reasons: string[]; work_reason_etc: string | null; work_elevator: string | null;
  start_at: string; end_at: string; is_holiday: boolean; holiday_type: string | null;
  work_hours: number | null; holiday_hours: number | null; overtime_hours: number | null;
  workers: string[]; worker_notes: string[]; work_content: string | null; work_result: string | null; note: string | null;
  approver_id: number | null; approval_status: string;
  submitted_at: string | null; approved_at: string | null; rejected_at: string | null; reject_reason: string | null;
  created_at: string; updated_at: string;
}
interface FormState {
  site_name: string; work_instructor: string; work_instructor_id: number | null;
  work_reasons: string[]; work_reason_etc: string; work_elevator: string;
  s_yr: string; s_mo: string; s_dy: string; s_hr: string; s_mi: string;
  e_yr: string; e_mo: string; e_dy: string; e_hr: string; e_mi: string;
  is_holiday: boolean; holiday_type: string;
  workers: string[]; worker_notes: string[]; work_content: string; work_result: string; note: string;
  approver_id: number | null;
  work_hours: number | null; holiday_hours: number | null; overtime_hours: number | null;
}

function parseDT(val: string) {
  if (!val) return { yr: "", mo: "", dy: "", hr: "", mi: "" };
  const d = new Date(val);
  if (isNaN(d.getTime())) return { yr: "", mo: "", dy: "", hr: "", mi: "" };
  return {
    yr: String(d.getFullYear()).slice(2),
    mo: String(d.getMonth() + 1).padStart(2, "0"),
    dy: String(d.getDate()).padStart(2, "0"),
    hr: String(d.getHours()).padStart(2, "0"),
    mi: String(d.getMinutes()).padStart(2, "0"),
  };
}
function buildDT(yr: string, mo: string, dy: string, hr: string, mi: string): string {
  if (!yr || !mo || !dy || !hr || !mi) return "";
  const s = `20${yr.padStart(2,"0")}-${mo.padStart(2,"0")}-${dy.padStart(2,"0")}T${hr.padStart(2,"0")}:${mi.padStart(2,"0")}`;
  return isNaN(new Date(s).getTime()) ? "" : s;
}

function makeEmptyForm(): FormState {
  const n = new Date();
  return {
    site_name: "", work_instructor: "", work_instructor_id: null,
    work_reasons: [], work_reason_etc: "", work_elevator: "",
    s_yr: String(n.getFullYear()).slice(2), s_mo: String(n.getMonth()+1).padStart(2,"0"), s_dy: String(n.getDate()).padStart(2,"0"), s_hr: "", s_mi: "",
    e_yr: String(n.getFullYear()).slice(2), e_mo: String(n.getMonth()+1).padStart(2,"0"), e_dy: String(n.getDate()).padStart(2,"0"), e_hr: "", e_mi: "",
    is_holiday: false, holiday_type: "",
    workers: Array(10).fill(""), worker_notes: Array(10).fill(""), work_content: "", work_result: "", note: "",
    approver_id: null, work_hours: null, holiday_hours: null, overtime_hours: null,
  };
}
function reportToForm(r: OvertimeReport): FormState {
  const sp = parseDT(r.start_at?.slice(0,16) ?? "");
  const ep = parseDT(r.end_at?.slice(0,16) ?? "");
  const ws = [...r.workers]; while (ws.length < 10) ws.push("");
  return {
    site_name: r.site_name, work_instructor: r.work_instructor ?? "", work_instructor_id: r.work_instructor_id,
    work_reasons: r.work_reasons, work_reason_etc: r.work_reason_etc ?? "", work_elevator: r.work_elevator ?? "",
    s_yr: sp.yr, s_mo: sp.mo, s_dy: sp.dy, s_hr: sp.hr, s_mi: sp.mi,
    e_yr: ep.yr, e_mo: ep.mo, e_dy: ep.dy, e_hr: ep.hr, e_mi: ep.mi,
    is_holiday: r.is_holiday, holiday_type: r.holiday_type ?? "",
    workers: ws,
    worker_notes: (() => { const ns=[...(r.worker_notes??[])]; while(ns.length<10) ns.push(""); return ns; })(),
    work_content: r.work_content ?? "", work_result: r.work_result ?? "", note: r.note ?? "",
    approver_id: r.approver_id, work_hours: r.work_hours, holiday_hours: r.holiday_hours, overtime_hours: r.overtime_hours,
  };
}

// ── 작업자 검색 인풋 ──────────────────────────────────────────────
function WorkerSearchInput({ value, onChange, accounts, placeholder, cellStyle }: {
  value: string;
  onChange: (v: string) => void;
  accounts: Account[];
  placeholder?: string;
  cellStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropRect, setDropRect] = useState<{ top: number; left: number } | null>(null);

  const suggestions = useMemo(() => {
    const q = value.trim();
    const list = q
      ? accounts.filter(a => a.username.includes(q) || (a.dept ?? "").includes(q))
      : accounts;
    return list.slice(0, 10);
  }, [value, accounts]);

  function updatePos() {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropRect({ top: r.bottom + 2, left: r.left });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && suggestions.length === 1) {
      e.preventDefault();
      onChange(suggestions[0].username);
      setOpen(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => { updatePos(); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={cellStyle}
      />
      {open && dropRect && typeof document !== "undefined" && createPortal(
        <div style={{
          position: "fixed",
          top: dropRect.top,
          left: dropRect.left,
          minWidth: 160,
          zIndex: 9999,
          background: "white",
          border: "1px solid #bbb",
          borderRadius: 4,
          boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
          maxHeight: 220,
          overflowY: "auto",
          fontSize: "9pt",
          fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif",
        }}>
          {suggestions.length === 0 ? (
            <div style={{ padding: "6px 10px", color: "#999" }}>검색 결과 없음</div>
          ) : suggestions.map(a => (
            <div key={a.id}
              onMouseDown={e => { e.preventDefault(); onChange(a.username); setOpen(false); }}
              style={{ padding: "5px 10px", cursor: "pointer", borderBottom: "1px solid #f0f0f0" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#eff6ff")}
              onMouseLeave={e => (e.currentTarget.style.background = "")}>
              {a.username}
              {a.dept ? <span style={{ color: "#888", marginLeft: 4 }}>({a.dept})</span> : null}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, [string, string]> = {
    draft: ["작성중","bg-gray-100 text-gray-600"], pending: ["승인 요청","bg-blue-100 text-blue-700"],
    approved: ["승인완료","bg-green-100 text-green-700"], rejected: ["반려","bg-red-100 text-red-600"],
  };
  const [label, cls] = m[status] ?? [status, "bg-gray-100 text-gray-500"];
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>;
}

// ── 공통 인라인 입력 스타일 ──
const iCell: React.CSSProperties = { width:"100%", border:"none", background:"transparent", fontSize:"10pt", color:"inherit", padding:"1mm 2mm", outline:"none", fontFamily:"inherit" };
const iTArea: React.CSSProperties = { ...iCell, resize:"none", display:"block" };
// 날짜 파트 (밑줄 입력)
const iPart: React.CSSProperties = { border:"none", borderBottom:"1px solid #444", background:"transparent", fontSize:"10pt", textAlign:"center", outline:"none", fontFamily:"inherit" };
// 표 테두리
const bdr = "1px solid #444";

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
  const [printPending, setPrintPending] = useState(false);
  const [rejectModal, setRejectModal]   = useState<{ id: number; reportNo: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [isMobile, setIsMobile]   = useState(false);
  const [mobileStep, setMobileStep] = useState(0);

  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 768); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    const all: OvertimeReport[] = [];
    for (let off = 0; ; off += 500) {
      let q = supabase.from("overtime_reports").select("*").order("created_at",{ascending:false}).range(off, off+499);
      if (!isManager) q = q.eq("author_id", user.id);
      const { data } = await q;
      const b = (data as OvertimeReport[] | null) ?? [];
      all.push(...b); if (b.length < 500) break;
    }
    setMyReports(all);
  }, [user, isManager]);

  useEffect(() => {
    supabase.from("accounts").select("id,username,dept,status").order("username")
      .then(({ data }) => setAccounts((data as Account[] | null) ?? []));
  }, []);
  useEffect(() => { load(); }, [load]);
  useReloadOnActivate(load);

  const f  = form;
  const sf = (p: Partial<FormState>) => setForm(prev => ({ ...prev, ...p }));

  const startDT = buildDT(f.s_yr, f.s_mo, f.s_dy, f.s_hr, f.s_mi);
  const endDT   = buildDT(f.e_yr, f.e_mo, f.e_dy, f.e_hr, f.e_mi);

  useEffect(() => {
    if (!startDT || !endDT) { setOtResult(null); return; }
    const s = new Date(startDT), e = new Date(endDT);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) { setOtResult(null); return; }
    const r = calcOvertimeResult(s, e, f.is_holiday);
    setOtResult(r);
    sf({ work_hours: r.workHours, holiday_hours: r.holidayHours, overtime_hours: r.overtimeHours });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDT, endDT, f.is_holiday]);

  function detectFromStart(yr: string, mo: string, dy: string) {
    const d = new Date(`20${yr}-${mo}-${dy}`);
    if (!isNaN(d.getTime())) {
      const { isHoliday, holidayType } = detectHoliday(d);
      sf({ is_holiday: isHoliday, holiday_type: holidayType });
    }
  }

  function dowFromParts(yr: string, mo: string, dy: string) {
    if (!yr || !mo || !dy) return "";
    const d = new Date(`20${yr.padStart(2,"0")}-${mo.padStart(2,"0")}-${dy.padStart(2,"0")}`);
    return isNaN(d.getTime()) ? "" : dayOfWeekKr(d);
  }
  const startDow = dowFromParts(f.s_yr, f.s_mo, f.s_dy);
  const endDow   = dowFromParts(f.e_yr, f.e_mo, f.e_dy);
  const activeAccounts = useMemo(() => accounts.filter(a => a.status !== "퇴직"), [accounts]);
  const approverAcc    = accounts.find(a => a.id === f.approver_id);
  const authorAcc      = accounts.find(a => a.id === user?.id);
  const todayStr       = new Date().toLocaleDateString("ko-KR");

  function openNew() {
    const now = new Date();
    const { isHoliday, holidayType } = detectHoliday(now);
    setForm({ ...makeEmptyForm(), is_holiday: isHoliday, holiday_type: holidayType });
    setOtResult(null); setEditingId("new"); setMobileStep(0);
  }
  function openEdit(r: OvertimeReport, andPrint = false) {
    setForm(reportToForm(r)); setOtResult(null); setEditingId(r.id); setMobileStep(0);
    if (andPrint) setPrintPending(true);
  }
  useEffect(() => {
    if (!printPending || editingId === null) return;
    const t = setTimeout(() => { window.print(); setPrintPending(false); }, 350);
    return () => clearTimeout(t);
  }, [printPending, editingId]);

  async function save(submitForApproval: boolean) {
    if (!user) return;
    if (!f.site_name.trim()) { alert("현장명을 입력해주세요."); return; }
    if (!startDT || !endDT)  { alert("작업일시를 입력해주세요."); return; }
    if (submitForApproval && !f.approver_id) { alert("잔업 승인자를 지정해주세요."); return; }
    setSaving(true);
    try {
      const instructorName = f.work_instructor_id
        ? (accounts.find(a => a.id === f.work_instructor_id)?.username ?? f.work_instructor.trim())
        : f.work_instructor.trim() || null;
      const payload = {
        author_id: user.id, site_name: f.site_name.trim(),
        work_instructor: instructorName, work_instructor_id: f.work_instructor_id,
        work_reasons: f.work_reasons, work_reason_etc: f.work_reason_etc.trim() || null,
        work_elevator: f.work_elevator.trim() || null,
        start_at: new Date(startDT).toISOString(), end_at: new Date(endDT).toISOString(),
        is_holiday: f.is_holiday, holiday_type: f.holiday_type || null,
        work_hours: f.work_hours, holiday_hours: f.holiday_hours, overtime_hours: f.overtime_hours,
        workers: f.workers.filter(w => w.trim()),
        worker_notes: f.worker_notes,
        work_content: f.work_content.trim() || null, work_result: f.work_result.trim() || null,
        note: f.note.trim() || null, approver_id: f.approver_id,
        approval_status: submitForApproval ? "pending" : "draft",
        submitted_at: submitForApproval ? new Date().toISOString() : null,
      };
      if (editingId === "new") {
        const { data: no, error: ne } = await supabase.rpc("next_ot_no");
        if (ne) throw new Error("문서번호 채번 실패: " + ne.message);
        const { data: ins, error: ie } = await supabase.from("overtime_reports").insert({ ...payload, report_no: no }).select("id,report_no").single();
        if (ie) throw ie;
        if (submitForApproval && f.approver_id)
          notifyOvertimeApprovalRequest({ approverId: f.approver_id, authorName: authorAcc?.username ?? user.name, reportNo: no, reportId: (ins as {id:number}).id, siteName: f.site_name, startAt: startDT }).catch(console.warn);
      } else {
        const { error } = await supabase.from("overtime_reports").update(payload).eq("id", editingId!);
        if (error) throw error;
        const rep = myReports.find(r => r.id === editingId);
        if (submitForApproval && f.approver_id && rep)
          notifyOvertimeApprovalRequest({ approverId: f.approver_id, authorName: authorAcc?.username ?? user.name, reportNo: rep.report_no, reportId: rep.id, siteName: f.site_name, startAt: startDT }).catch(console.warn);
      }
      await load(); setEditingId(null);
    } catch (e: unknown) { alert("저장 실패: " + (e instanceof Error ? e.message : String(e))); }
    finally { setSaving(false); }
  }

  async function approve(r: OvertimeReport) {
    if (!user || !confirm("승인하시겠습니까?")) return;
    const { error } = await supabase.from("overtime_reports").update({ approval_status:"approved", approved_at: new Date().toISOString() }).eq("id", r.id);
    if (error) { alert("오류: " + error.message); return; }
    notifyOvertimeApproved({ authorId: r.author_id, approverName: authorAcc?.username ?? user.name, reportNo: r.report_no, reportId: r.id }).catch(console.warn);
    await load();
  }
  async function reject() {
    if (!rejectModal || !user) return;
    if (!rejectReason.trim()) { alert("반려 사유를 입력해주세요."); return; }
    const { error } = await supabase.from("overtime_reports").update({ approval_status:"rejected", rejected_at: new Date().toISOString(), reject_reason: rejectReason.trim() }).eq("id", rejectModal.id);
    if (error) { alert("오류: " + error.message); return; }
    const rep = myReports.find(r => r.id === rejectModal.id);
    if (rep) notifyOvertimeRejected({ authorId: rep.author_id, approverName: authorAcc?.username ?? user.name, reportNo: rep.report_no, reportId: rep.id, reason: rejectReason.trim() }).catch(console.warn);
    setRejectModal(null); setRejectReason(""); await load();
  }

  const canEdit   = (r: OvertimeReport) => !!user && r.author_id === user.id && (r.approval_status === "draft" || r.approval_status === "rejected");
  const canDelete = (r: OvertimeReport) => !!user && r.author_id === user.id && (r.approval_status === "draft" || r.approval_status === "rejected");
  const canApprove = (r: OvertimeReport) => !!user && r.approver_id === user.id && r.approval_status === "pending";

  async function deleteReport(id: number, reportNo: string) {
    if (!confirm(`보고서 ${reportNo}을(를) 삭제하시겠습니까?`)) return;
    const { error } = await supabase.from("overtime_reports").delete().eq("id", id);
    if (error) { alert("삭제 실패: " + error.message); return; }
    load();
  }

  // ── 셀 배경 스타일 (라벨) ──
  const labelCell: React.CSSProperties = {
    background: "#f5f5f5", fontWeight: "bold", textAlign: "center",
    fontSize: "9pt", borderRight: bdr, whiteSpace: "nowrap", padding: "0 2mm", verticalAlign: "middle",
  };

  return (
    <div className="flex flex-col h-full bg-gray-300 dark:bg-gray-900 text-sm">
      {/* ── 인쇄 전용 CSS ── */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body * { visibility: hidden !important; }
          #ot-print-doc, #ot-print-doc * { visibility: visible !important; }
          #ot-print-doc {
            position: fixed !important; inset: 0 !important;
            width: 210mm !important; height: 297mm !important;
            padding: 12mm 14mm !important;
            background: white !important; color: black !important;
            overflow: hidden !important; box-shadow: none !important;
          }
          #ot-print-doc input, #ot-print-doc select, #ot-print-doc textarea {
            color: black !important; background: transparent !important;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          #ot-print-doc th, #ot-print-doc td[data-label="true"] {
            background-color: #f0f0f0 !important;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
        }
      ` }} />

      {/* ── 상단 툴바 (인쇄 시 숨김) ── */}
      <div className="print:hidden flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h1 className="text-sm font-bold text-gray-800 dark:text-gray-100">잔업보고서</h1>
        <div className="flex gap-2">
          {editingId !== null ? (
            <>
              {!isMobile && <>
                <button onClick={() => save(false)} disabled={saving}
                  className="px-3 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 rounded font-medium disabled:opacity-50">
                  {saving ? "저장중…" : "임시저장"}
                </button>
                <button onClick={() => save(true)} disabled={saving}
                  className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-50">
                  {saving ? "제출중…" : "승인 요청"}
                </button>
                <button onClick={() => window.print()}
                  className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-900 text-white rounded font-medium">
                  🖨️ 인쇄
                </button>
              </>}
              <button onClick={() => setEditingId(null)}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">
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

        {/* ════════════════════════════════
            문서 뷰
        ════════════════════════════════ */}
        {editingId !== null && (
          <>
            {/* 보조 바: 잔업 승인자 + 상태 (인쇄 시 숨김) */}
            <div className="print:hidden sticky top-0 z-10 flex flex-wrap items-center gap-3 px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800 text-xs">
              <span className="text-gray-500 whitespace-nowrap font-medium">잔업 승인자</span>
              <select value={f.approver_id ?? ""}
                onChange={e => sf({ approver_id: e.target.value ? Number(e.target.value) : null })}
                className="border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-400 max-w-xs">
                <option value="">— 승인자 선택 —</option>
                {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.username}{a.dept ? ` (${a.dept})` : ""}</option>)}
              </select>
              {otResult && (
                <span className="font-semibold text-blue-700 dark:text-blue-300">{otResult.display}</span>
              )}
            </div>

            {/* ── 모바일 스텝 폼 ── */}
            {isMobile && (() => {
              const STEPS = [
                "현장명", "작업지시자", "작업사유", "작업호기",
                "시작일시", "종료일시", "잔업시간", "작업자",
                "작업내용", "작업결과", "잔업 승인자",
              ];
              const total = STEPS.length;
              const isFirst = mobileStep === 0;
              const isLast  = mobileStep === total - 1;
              return (
                <div className="flex flex-col" style={{ minHeight: "calc(100dvh - 112px)" }}>
                  {/* 진행률 바 */}
                  <div className="px-4 pt-4 pb-2 shrink-0">
                    <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
                      <span className="font-semibold text-gray-700 dark:text-gray-200">{STEPS[mobileStep]}</span>
                      <span>{mobileStep + 1} / {total}</span>
                    </div>
                    <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
                        style={{ width: `${((mobileStep + 1) / total) * 100}%` }} />
                    </div>
                  </div>

                  {/* 스텝 콘텐츠 */}
                  <div className="flex-1 px-4 py-4 overflow-y-auto">

                    {/* Step 0: 현장명 */}
                    {mobileStep === 0 && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">현장명</label>
                        <input autoFocus
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-3 text-base bg-white dark:bg-gray-800 focus:outline-none focus:border-blue-400"
                          value={f.site_name} onChange={e => sf({ site_name: e.target.value })}
                          placeholder="현장명을 입력하세요"
                          onKeyDown={e => { if (e.nativeEvent.isComposing) return; if (e.key === "Enter") setMobileStep(1); }} />
                      </div>
                    )}

                    {/* Step 1: 작업지시자 */}
                    {mobileStep === 1 && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">작업지시자</label>
                        <select className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-3 text-base bg-white dark:bg-gray-800 focus:outline-none focus:border-blue-400"
                          value={f.work_instructor_id ?? ""}
                          onChange={e => {
                            const id = e.target.value ? Number(e.target.value) : null;
                            sf({ work_instructor_id: id, work_instructor: id ? (accounts.find(a => a.id === id)?.username ?? "") : "" });
                          }}>
                          <option value="">직접 입력</option>
                          {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.username}{a.dept ? ` (${a.dept})` : ""}</option>)}
                        </select>
                        {!f.work_instructor_id && (
                          <input className="mt-2 w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-3 text-base bg-white dark:bg-gray-800 focus:outline-none focus:border-blue-400"
                            value={f.work_instructor} onChange={e => sf({ work_instructor: e.target.value })}
                            placeholder="이름 직접 입력" />
                        )}
                      </div>
                    )}

                    {/* Step 2: 작업사유 */}
                    {mobileStep === 2 && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">작업사유</label>
                        <div className="flex flex-wrap gap-2">
                          {WORK_REASONS.map(r => (
                            <label key={r}
                              className="flex items-center gap-2 px-4 py-2.5 border-2 rounded-xl cursor-pointer text-sm font-medium select-none transition-colors"
                              style={{ borderColor: f.work_reasons.includes(r) ? "#2563eb" : "#d1d5db", background: f.work_reasons.includes(r) ? "#eff6ff" : "white", color: f.work_reasons.includes(r) ? "#1d4ed8" : "#374151" }}>
                              <input type="checkbox" className="hidden" checked={f.work_reasons.includes(r)}
                                onChange={e => sf({ work_reasons: e.target.checked ? [...f.work_reasons, r] : f.work_reasons.filter(x => x !== r) })} />
                              {r}
                            </label>
                          ))}
                        </div>
                        {f.work_reasons.includes("기타") && (
                          <input className="mt-3 w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-3 text-base bg-white dark:bg-gray-800 focus:outline-none focus:border-blue-400"
                            value={f.work_reason_etc} onChange={e => sf({ work_reason_etc: e.target.value })} placeholder="기타 내용 입력" />
                        )}
                      </div>
                    )}

                    {/* Step 3: 작업호기 */}
                    {mobileStep === 3 && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">작업호기</label>
                        <input autoFocus
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-3 text-base bg-white dark:bg-gray-800 focus:outline-none focus:border-blue-400"
                          value={f.work_elevator} onChange={e => sf({ work_elevator: e.target.value })}
                          placeholder="예: 1호기, 2·3호기"
                          onKeyDown={e => { if (e.nativeEvent.isComposing) return; if (e.key === "Enter") setMobileStep(4); }} />
                      </div>
                    )}

                    {/* Step 4: 시작일시 */}
                    {mobileStep === 4 && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">시작일시</label>
                        <input type="datetime-local"
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-3 text-base bg-white dark:bg-gray-800 focus:outline-none focus:border-blue-400"
                          value={startDT || ""}
                          onChange={e => {
                            const p = parseDT(e.target.value);
                            sf({ s_yr: p.yr, s_mo: p.mo, s_dy: p.dy, s_hr: p.hr, s_mi: p.mi });
                            detectFromStart(p.yr, p.mo, p.dy);
                          }} />
                        {startDow && <p className="text-sm text-blue-600 dark:text-blue-400 mt-2 font-medium">{startDow}요일</p>}
                      </div>
                    )}

                    {/* Step 5: 종료일시 */}
                    {mobileStep === 5 && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">종료일시</label>
                        <input type="datetime-local"
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-3 text-base bg-white dark:bg-gray-800 focus:outline-none focus:border-blue-400"
                          value={endDT || ""}
                          onChange={e => {
                            const p = parseDT(e.target.value);
                            sf({ e_yr: p.yr, e_mo: p.mo, e_dy: p.dy, e_hr: p.hr, e_mi: p.mi });
                          }} />
                        {endDow && <p className="text-sm text-blue-600 dark:text-blue-400 mt-2 font-medium">{endDow}요일</p>}
                      </div>
                    )}

                    {/* Step 6: 잔업시간 */}
                    {mobileStep === 6 && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">잔업시간</label>
                        {otResult ? (
                          <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-4">
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">자동 계산</p>
                            <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{otResult.display}</p>
                          </div>
                        ) : (
                          <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-4 text-center text-gray-400 text-sm">
                            시작/종료 일시를 입력하면 자동 계산됩니다
                          </div>
                        )}
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mt-3 mb-1.5">메모 (선택)</label>
                        <input
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-3 text-base bg-white dark:bg-gray-800 focus:outline-none focus:border-blue-400"
                          value={f.note} onChange={e => sf({ note: e.target.value })} placeholder="직접 입력" />
                      </div>
                    )}

                    {/* Step 7: 작업자 */}
                    {mobileStep === 7 && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          작업자 <span className="font-normal text-gray-400">(최대 10명)</span>
                        </label>
                        <div className="space-y-2">
                          {f.workers.map((w, i) => (
                            <div key={i} className="flex gap-2 items-center">
                              <span className="text-xs text-gray-400 shrink-0" style={{ width: "3.5rem" }}>작업자{i + 1}</span>
                              <div className="flex-1">
                                <WorkerSearchInput
                                  value={w}
                                  placeholder={`작업자${i + 1}`}
                                  accounts={activeAccounts}
                                  cellStyle={{ width: "100%", border: "1px solid #d1d5db", borderRadius: "12px", padding: "8px 12px", fontSize: "14px", outline: "none", background: "white" }}
                                  onChange={v => { const ws = [...f.workers]; ws[i] = v; sf({ workers: ws }); }}
                                />
                              </div>
                              <input
                                className="w-24 border border-gray-300 dark:border-gray-600 rounded-xl px-2 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:border-blue-400"
                                value={f.worker_notes[i]} placeholder="비고"
                                onChange={e => { const ns = [...f.worker_notes]; ns[i] = e.target.value; sf({ worker_notes: ns }); }} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Step 8: 작업내용 */}
                    {mobileStep === 8 && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">작업내용</label>
                        <textarea autoFocus
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-3 text-base resize-none bg-white dark:bg-gray-800 focus:outline-none focus:border-blue-400"
                          rows={10} value={f.work_content} onChange={e => sf({ work_content: e.target.value })}
                          placeholder="작업내용을 입력하세요…" />
                      </div>
                    )}

                    {/* Step 9: 작업결과 */}
                    {mobileStep === 9 && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">작업결과</label>
                        <textarea autoFocus
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-3 text-base resize-none bg-white dark:bg-gray-800 focus:outline-none focus:border-blue-400"
                          rows={10} value={f.work_result} onChange={e => sf({ work_result: e.target.value })}
                          placeholder="작업결과를 입력하세요…" />
                      </div>
                    )}

                    {/* Step 10: 잔업 승인자 */}
                    {mobileStep === 10 && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">잔업 승인자</label>
                        <select className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-3 text-base bg-white dark:bg-gray-800 focus:outline-none focus:border-blue-400"
                          value={f.approver_id ?? ""}
                          onChange={e => sf({ approver_id: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">— 승인자 선택 —</option>
                          {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.username}{a.dept ? ` (${a.dept})` : ""}</option>)}
                        </select>
                        {otResult && (
                          <div className="mt-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3">
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">잔업시간</p>
                            <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{otResult.display}</p>
                          </div>
                        )}
                      </div>
                    )}

                  </div>

                  {/* 하단 내비게이션 */}
                  <div className="shrink-0 px-4 py-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex gap-3">
                    {!isFirst && (
                      <button onClick={() => setMobileStep(s => s - 1)}
                        className="px-5 py-3 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl font-medium">
                        ← 이전
                      </button>
                    )}
                    {!isLast && (
                      <button onClick={() => setMobileStep(s => s + 1)}
                        className="flex-1 py-3 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium">
                        다음 →
                      </button>
                    )}
                    {isLast && (
                      <>
                        <button onClick={() => save(false)} disabled={saving}
                          className="flex-1 py-3 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-xl font-medium disabled:opacity-50">
                          {saving ? "저장중…" : "임시저장"}
                        </button>
                        <button onClick={() => save(true)} disabled={saving}
                          className="flex-1 py-3 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium disabled:opacity-50">
                          {saving ? "제출중…" : "승인 요청"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* A4 문서 */}
            {!isMobile && <div className="flex justify-center py-8 print:py-0">
              <div id="ot-print-doc" style={{
                width: "210mm", minHeight: "297mm",
                padding: "12mm 14mm",
                background: "white", color: "#111",
                fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif",
                fontSize: "10pt",
                display: "flex", flexDirection: "column",
                boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
              }}>

                {/* ── 제목 + 결재란 ── */}
                <div style={{ display:"flex", alignItems:"stretch", marginBottom:"4mm" }}>
                  {/* 제목 영역 */}
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:"30pt", fontWeight:900, textDecoration:"underline", letterSpacing:"10px", lineHeight:1 }}>
                      잔업보고서
                    </div>
                    <div style={{ marginTop:"6mm", fontSize:"9.5pt" }}>
                      아래와 같이 시간외 근로(잔업) 사유가 발생하였기에 보고서를 제출합니다.
                    </div>
                  </div>

                  {/* 결재란 — 5열 */}
                  <table style={{ borderCollapse:"collapse", border: bdr, marginLeft:"4mm", alignSelf:"flex-start" }}>
                    <thead>
                      <tr>
                        {["담당","팀장","임원","대표","대표"].map((r,i) => (
                          <th key={i} style={{
                            border: bdr, width:"17mm", height:"7mm",
                            textAlign:"center", fontSize:"9pt", fontWeight:"bold",
                            background:"#f0f0f0", padding:0,
                          }}>{r}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {/* 서명 공간 */}
                      <tr>
                        {[0,1,2,3,4].map(i => (
                          <td key={i} style={{
                            border: bdr, width:"17mm", height:"20mm",
                            textAlign:"center", verticalAlign:"middle", fontSize:"8pt", color:"#444",
                          }}>
                            {i === 0 && approverAcc && (
                              <span style={{ fontSize:"8pt", fontWeight:"bold" }}>{approverAcc.username}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                      {/* 날짜 라인 */}
                      <tr>
                        {[0,1,2,3,4].map(i => (
                          <td key={i} style={{
                            border: bdr, textAlign:"center", fontSize:"9pt",
                            color:"#888", height:"6mm", padding:0,
                          }}>
                            /
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* ── 본문 표 ── */}
                <table style={{ width:"100%", borderCollapse:"collapse", border: bdr, tableLayout:"fixed" }}>
                  <colgroup>
                    <col style={{ width:"22mm" }} />
                    <col />
                    <col style={{ width:"22mm" }} />
                    <col />
                  </colgroup>
                  <tbody>

                    {/* 현장명 / 작업지시자 */}
                    <tr style={{ borderBottom: bdr }}>
                      <td data-label="true" style={{ ...labelCell, borderBottom:"none", height:"10mm" }}>현 장 명</td>
                      <td style={{ borderRight: bdr, padding:"0 2mm", verticalAlign:"middle" }}>
                        <input style={iCell} value={f.site_name}
                          onChange={e => sf({ site_name: e.target.value })} placeholder="현장명 입력" />
                      </td>
                      <td data-label="true" style={{ ...labelCell, borderBottom:"none" }}>작업지시자</td>
                      <td style={{ verticalAlign:"middle", padding:"0 2mm" }}>
                        <select style={{ ...iCell, cursor:"pointer" }} value={f.work_instructor_id ?? ""}
                          onChange={e => {
                            const id = e.target.value ? Number(e.target.value) : null;
                            sf({ work_instructor_id: id, work_instructor: id ? (accounts.find(a=>a.id===id)?.username ?? "") : "" });
                          }}>
                          <option value="">직접 입력</option>
                          {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.username}{a.dept ? ` (${a.dept})` : ""}</option>)}
                        </select>
                        {!f.work_instructor_id && (
                          <input style={{ ...iCell, marginTop:"0.5mm" }} value={f.work_instructor}
                            onChange={e => sf({ work_instructor: e.target.value })} placeholder="이름 직접 입력" />
                        )}
                      </td>
                    </tr>

                    {/* 작업사유 */}
                    <tr style={{ borderBottom: bdr }}>
                      <td data-label="true" style={{ ...labelCell, height:"10mm" }}>작업사유</td>
                      <td colSpan={3} style={{ padding:"2mm 3mm", verticalAlign:"middle" }}>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:"0 6mm", fontSize:"10pt", alignItems:"center" }}>
                          {WORK_REASONS.map(r => (
                            <label key={r} style={{ display:"flex", alignItems:"center", gap:"1mm", cursor:"pointer", whiteSpace:"nowrap" }}>
                              <input type="checkbox" checked={f.work_reasons.includes(r)}
                                onChange={e => sf({ work_reasons: e.target.checked ? [...f.work_reasons,r] : f.work_reasons.filter(x=>x!==r) })}
                                style={{ accentColor:"#444" }} />
                              {r}
                            </label>
                          ))}
                          {f.work_reasons.includes("기타") && (
                            <input style={{ ...iPart, width:"28mm", marginLeft:"1mm" }} value={f.work_reason_etc}
                              onChange={e => sf({ work_reason_etc: e.target.value })} placeholder="기타 내용" />
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* 작업호기 */}
                    <tr style={{ borderBottom: bdr }}>
                      <td data-label="true" style={{ ...labelCell, height:"9mm" }}>작업호기</td>
                      <td colSpan={3} style={{ padding:"0 2mm", verticalAlign:"middle" }}>
                        <input style={iCell} value={f.work_elevator}
                          onChange={e => sf({ work_elevator: e.target.value })} placeholder="예: 1호기, 2·3호기" />
                      </td>
                    </tr>

                    {/* 작업일시 – 시작 + 종료 표 형태 */}
                    <tr style={{ borderBottom: bdr }}>
                      <td data-label="true" style={{ ...labelCell, borderBottom:"none" }}>작업일시</td>
                      <td colSpan={3} style={{ padding:0 }}>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <colgroup>
                            <col style={{ width:"12mm" }} />
                            <col />
                            <col style={{ width:"36mm" }} />
                          </colgroup>
                          <tbody>
                            {/* 시작 행 */}
                            <tr style={{ borderBottom: "1px solid #ccc" }}>
                              <td style={{ borderRight:bdr, textAlign:"center", fontSize:"9pt", fontWeight:"bold", padding:"1.5mm 0", verticalAlign:"middle" }}>시 작</td>
                              <td style={{ padding:"1.5mm 3mm", verticalAlign:"middle" }}>
                                <div style={{ display:"flex", alignItems:"center", flexWrap:"nowrap", gap:"0.8mm", fontSize:"10pt" }}>
                                  <span>20</span>
                                  <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.s_yr} placeholder="YY"
                                    onFocus={e => e.target.select()}
                                    onChange={e => { sf({ s_yr: e.target.value }); detectFromStart(e.target.value, f.s_mo, f.s_dy); }} />
                                  <span>년</span>
                                  <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.s_mo} placeholder="MM"
                                    onFocus={e => e.target.select()}
                                    onChange={e => { sf({ s_mo: e.target.value }); detectFromStart(f.s_yr, e.target.value, f.s_dy); }} />
                                  <span>월</span>
                                  <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.s_dy} placeholder="DD"
                                    onFocus={e => e.target.select()}
                                    onChange={e => { sf({ s_dy: e.target.value }); detectFromStart(f.s_yr, f.s_mo, e.target.value); }} />
                                  <span>일(</span>
                                  <span style={{ width:"5mm", textAlign:"center", fontWeight:"bold", color:"#1d4ed8" }}>{startDow || "??"}</span>
                                  <span>요일)</span>
                                  <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.s_hr} placeholder="HH"
                                    onFocus={e => e.target.select()}
                                    onChange={e => sf({ s_hr: e.target.value })} />
                                  <span>시</span>
                                  <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.s_mi} placeholder="MM"
                                    onFocus={e => e.target.select()}
                                    onChange={e => sf({ s_mi: e.target.value })} />
                                  <span>분부터</span>
                                </div>
                              </td>
                              <td style={{ borderLeft:bdr, textAlign:"center", fontWeight:"bold", fontSize:"10pt", verticalAlign:"middle", padding:"1.5mm 2mm" }}>
                                {otResult
                                  ? <span style={{ color:"#1d4ed8" }}>{otResult.display}</span>
                                  : <span style={{ color:"#aaa" }}>—— HR</span>}
                              </td>
                            </tr>
                            {/* 종료 행 */}
                            <tr>
                              <td style={{ borderRight:bdr, textAlign:"center", fontSize:"9pt", fontWeight:"bold", padding:"1.5mm 0", verticalAlign:"middle" }}>종 료</td>
                              <td style={{ padding:"1.5mm 3mm", verticalAlign:"middle" }}>
                                <div style={{ display:"flex", alignItems:"center", flexWrap:"nowrap", gap:"0.8mm", fontSize:"10pt" }}>
                                  <span>20</span>
                                  <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.e_yr} placeholder="YY"
                                    onFocus={e => e.target.select()}
                                    onChange={e => sf({ e_yr: e.target.value })} />
                                  <span>년</span>
                                  <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.e_mo} placeholder="MM"
                                    onFocus={e => e.target.select()}
                                    onChange={e => sf({ e_mo: e.target.value })} />
                                  <span>월</span>
                                  <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.e_dy} placeholder="DD"
                                    onFocus={e => e.target.select()}
                                    onChange={e => sf({ e_dy: e.target.value })} />
                                  <span>일(</span>
                                  <span style={{ width:"5mm", textAlign:"center", fontWeight:"bold", color:"#1d4ed8" }}>{endDow || "??"}</span>
                                  <span>요일)</span>
                                  <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.e_hr} placeholder="HH"
                                    onFocus={e => e.target.select()}
                                    onChange={e => sf({ e_hr: e.target.value })} />
                                  <span>시</span>
                                  <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.e_mi} placeholder="MM"
                                    onFocus={e => e.target.select()}
                                    onChange={e => sf({ e_mi: e.target.value })} />
                                  <span>분까지</span>
                                </div>
                              </td>
                              <td style={{ borderLeft:bdr, padding:"1.5mm 2mm", verticalAlign:"middle" }}>
                                <input
                                  style={{ ...iCell, fontSize:"9pt" }}
                                  value={f.note}
                                  onChange={e => sf({ note: e.target.value })}
                                />
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* 작업자명 + 비고 — 성명/비고 2행 표 */}
                    <tr style={{ borderBottom: bdr }}>
                      <td data-label="true" style={{ ...labelCell, padding:0, verticalAlign:"top" }}>
                        <div style={{ height:"9mm", display:"flex", alignItems:"center", justifyContent:"center", borderBottom: bdr }}>작업자명</div>
                        <div style={{ height:"8mm", display:"flex", alignItems:"center", justifyContent:"center" }}>비 고</div>
                      </td>
                      <td colSpan={3} style={{ padding:0, verticalAlign:"top" }}>
                        <table style={{ width:"100%", borderCollapse:"collapse", height:"100%" }}>
                          <tbody>
                            {/* 작업자명 행 */}
                            <tr style={{ borderBottom: bdr }}>
                              {f.workers.map((w, i) => (
                                <td key={i} style={{
                                  borderLeft: i === 0 ? "none" : bdr, width:"10%", height:"9mm",
                                  textAlign:"center", verticalAlign:"middle", overflow:"visible",
                                  padding:"0.5mm 0.5mm",
                                }}>
                                  <WorkerSearchInput
                                    value={w}
                                    placeholder={`작업자${i + 1}`}
                                    accounts={activeAccounts}
                                    cellStyle={{ ...iCell, textAlign:"center", padding:"0", fontSize:"8.5pt", width:"100%" }}
                                    onChange={v => { const ws=[...f.workers]; ws[i]=v; sf({ workers: ws }); }}
                                  />
                                </td>
                              ))}
                            </tr>
                            {/* 비고 행 */}
                            <tr>
                              {f.worker_notes.map((n, i) => (
                                <td key={i} style={{
                                  borderLeft: i === 0 ? "none" : bdr, width:"10%", height:"8mm",
                                  textAlign:"center", verticalAlign:"middle",
                                  padding:"1mm 0.5mm",
                                }}>
                                  <input
                                    style={{ ...iCell, textAlign:"center", padding:"0", fontSize:"8.5pt" }}
                                    value={n}
                                    onChange={e => { const ns=[...f.worker_notes]; ns[i]=e.target.value; sf({ worker_notes: ns }); }}
                                  />
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* 작성자 / 작성일자 */}
                    <tr>
                      <td data-label="true" style={{ ...labelCell, borderBottom:"none", height:"9mm" }}>작 성 자</td>
                      <td style={{ borderRight: bdr, padding:"0 3mm", verticalAlign:"middle", fontWeight:"bold" }}>
                        {authorAcc?.username ?? user?.name ?? ""}
                      </td>
                      <td data-label="true" style={{ ...labelCell, borderBottom:"none" }}>작성일자</td>
                      <td style={{ padding:"0 3mm", verticalAlign:"middle", color:"#444" }}>{todayStr}</td>
                    </tr>

                  </tbody>
                </table>

                {/* ── 작업내용 ── */}
                <div style={{ border: bdr, borderTop:"none", padding:"2mm 3mm", flex:1 }}>
                  <div style={{ fontSize:"9pt", fontWeight:"bold", marginBottom:"1mm" }}>
                    ※ 작업내용(점검 및 수리 경우 호기별 기록)
                  </div>
                  <textarea style={{ ...iTArea, height:"74mm" }} value={f.work_content}
                    onChange={e => sf({ work_content: e.target.value })} placeholder="작업내용을 입력하세요…" />
                </div>

                {/* ── 작업결과 ── */}
                <div style={{ border: bdr, borderTop:"none", padding:"2mm 3mm", height:"44mm" }}>
                  <div style={{ fontSize:"9pt", fontWeight:"bold", marginBottom:"1mm" }}>※ 작업결과</div>
                  <textarea style={{ ...iTArea, height:"33mm" }} value={f.work_result}
                    onChange={e => sf({ work_result: e.target.value })} placeholder="작업결과를 입력하세요…" />
                </div>

                {/* ── 회사명 ── */}
                <div style={{ textAlign:"right", marginTop:"2mm", fontSize:"10pt", fontWeight:"bold", color:"#333" }}>
                  주식회사 대솔E/L
                </div>

              </div>{/* /ot-print-doc */}
            </div>}

          </>
        )}

        {/* ════════════════════════════════
            목록 뷰
        ════════════════════════════════ */}
        {editingId === null && (
          <div className="p-4 max-w-3xl mx-auto">
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
                            {r.is_holiday && <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">{r.holiday_type ?? "휴일"}</span>}
                          </div>
                          <p className="mt-1 font-medium">{r.site_name}</p>
                          <div className="mt-0.5 text-xs text-gray-500 space-y-0.5">
                            <p>{s.toLocaleDateString("ko-KR")} {s.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})} ~ {e.toLocaleDateString("ko-KR")} {e.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}</p>
                            <p className="text-blue-600 font-medium">{ot.display}</p>
                            <p>작업사유: {r.work_reasons.join(", ") || "-"}</p>
                            {author   && <p>작성자: {author.username}</p>}
                            {approver && <p>승인자: {approver.username}</p>}
                          </div>
                          {r.approval_status === "rejected" && r.reject_reason && (
                            <p className="mt-1 text-xs text-red-500">반려: {r.reject_reason}</p>
                          )}
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          {canEdit(r) && (
                            <button onClick={() => openEdit(r)} className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 rounded">수정</button>
                          )}
                          {canDelete(r) && (
                            <button onClick={() => deleteReport(r.id, r.report_no)} className="px-2 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 rounded">삭제</button>
                          )}
                          <button onClick={() => openEdit(r, true)} className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-900 text-white rounded">🖨️ 인쇄</button>
                          {canApprove(r) && (
                            <>
                              <button onClick={() => approve(r)} className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded">승인</button>
                              <button onClick={() => { setRejectModal({ id:r.id, reportNo:r.report_no }); setRejectReason(""); }} className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded">반려</button>
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
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none resize-none" />
            <div className="flex gap-2 mt-3">
              <button onClick={reject} className="flex-1 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded font-medium">반려 처리</button>
              <button onClick={() => setRejectModal(null)} className="flex-1 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 rounded">취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
