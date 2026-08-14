"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
  workers: string[]; work_content: string | null; work_result: string | null; note: string | null;
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
  workers: string[]; work_content: string; work_result: string; note: string;
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
    workers: Array(8).fill(""), work_content: "", work_result: "", note: "",
    approver_id: null, work_hours: null, holiday_hours: null, overtime_hours: null,
  };
}
function reportToForm(r: OvertimeReport): FormState {
  const sp = parseDT(r.start_at?.slice(0,16) ?? "");
  const ep = parseDT(r.end_at?.slice(0,16) ?? "");
  const ws = [...r.workers]; while (ws.length < 8) ws.push("");
  return {
    site_name: r.site_name, work_instructor: r.work_instructor ?? "", work_instructor_id: r.work_instructor_id,
    work_reasons: r.work_reasons, work_reason_etc: r.work_reason_etc ?? "", work_elevator: r.work_elevator ?? "",
    s_yr: sp.yr, s_mo: sp.mo, s_dy: sp.dy, s_hr: sp.hr, s_mi: sp.mi,
    e_yr: ep.yr, e_mo: ep.mo, e_dy: ep.dy, e_hr: ep.hr, e_mi: ep.mi,
    is_holiday: r.is_holiday, holiday_type: r.holiday_type ?? "",
    workers: ws, work_content: r.work_content ?? "", work_result: r.work_result ?? "", note: r.note ?? "",
    approver_id: r.approver_id, work_hours: r.work_hours, holiday_hours: r.holiday_hours, overtime_hours: r.overtime_hours,
  };
}

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, [string, string]> = {
    draft: ["작성중","bg-gray-100 text-gray-600"], pending: ["결재 요청","bg-blue-100 text-blue-700"],
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

  const startDow = startDT ? dayOfWeekKr(new Date(startDT)) : "";
  const endDow   = endDT   ? dayOfWeekKr(new Date(endDT))   : "";
  const activeAccounts = useMemo(() => accounts.filter(a => a.status !== "퇴직"), [accounts]);
  const approverAcc    = accounts.find(a => a.id === f.approver_id);
  const authorAcc      = accounts.find(a => a.id === user?.id);
  const todayStr       = new Date().toLocaleDateString("ko-KR");

  function openNew() {
    const now = new Date();
    const { isHoliday, holidayType } = detectHoliday(now);
    setForm({ ...makeEmptyForm(), is_holiday: isHoliday, holiday_type: holidayType });
    setOtResult(null); setEditingId("new");
  }
  function openEdit(r: OvertimeReport, andPrint = false) {
    setForm(reportToForm(r)); setOtResult(null); setEditingId(r.id);
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
    if (submitForApproval && !f.approver_id) { alert("결재 승인자를 지정해주세요."); return; }
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

  const canEdit   = (r: OvertimeReport) => !!user && (isManager || (r.author_id === user.id && r.approval_status !== "approved"));
  const canApprove = (r: OvertimeReport) => !!user && r.approver_id === user.id && r.approval_status === "pending";

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
              <button onClick={() => save(false)} disabled={saving}
                className="px-3 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 rounded font-medium disabled:opacity-50">
                {saving ? "저장중…" : "임시저장"}
              </button>
              <button onClick={() => save(true)} disabled={saving}
                className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-50">
                {saving ? "제출중…" : "결재 요청"}
              </button>
              <button onClick={() => window.print()}
                className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-900 text-white rounded font-medium">
                🖨️ 인쇄
              </button>
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
            {/* 보조 바: 결재 승인자 + 상태 (인쇄 시 숨김) */}
            <div className="print:hidden sticky top-0 z-10 flex flex-wrap items-center gap-3 px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800 text-xs">
              <span className="text-gray-500 whitespace-nowrap font-medium">결재 승인자</span>
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

            {/* A4 문서 */}
            <div className="flex justify-center py-8 print:py-0">
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
                              {r}({f.work_reasons.includes(r) ? "✔" : " "})
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

                    {/* 작업일시 – 시작 */}
                    <tr style={{ borderBottom: "1px solid #ccc" }}>
                      <td data-label="true" rowSpan={2} style={{ ...labelCell, borderBottom:"none" }}>작업일시</td>
                      <td colSpan={2} style={{ borderRight: bdr, padding:"1.5mm 3mm", verticalAlign:"middle" }}>
                        <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:"1mm", fontSize:"10pt" }}>
                          <span>20</span>
                          <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.s_yr} placeholder="YY"
                            onChange={e => { sf({ s_yr: e.target.value }); detectFromStart(e.target.value, f.s_mo, f.s_dy); }} />
                          <span>년</span>
                          <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.s_mo} placeholder="MM"
                            onChange={e => { sf({ s_mo: e.target.value }); detectFromStart(f.s_yr, e.target.value, f.s_dy); }} />
                          <span>월</span>
                          <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.s_dy} placeholder="DD"
                            onChange={e => { sf({ s_dy: e.target.value }); detectFromStart(f.s_yr, f.s_mo, e.target.value); }} />
                          <span>일(</span>
                          <span style={{ width:"5mm", textAlign:"center", fontWeight:"bold", color:"#1d4ed8" }}>{startDow || "??"}</span>
                          <span>요일)</span>
                          <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.s_hr} placeholder="HH"
                            onChange={e => sf({ s_hr: e.target.value })} />
                          <span>시</span>
                          <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.s_mi} placeholder="MM"
                            onChange={e => sf({ s_mi: e.target.value })} />
                          <span>분부터</span>
                        </div>
                      </td>
                      <td style={{ padding:"1.5mm 3mm", verticalAlign:"middle", fontSize:"10pt", fontWeight:"bold" }}>
                        {otResult
                          ? <span style={{ color:"#1d4ed8" }}>({otResult.display})</span>
                          : <span style={{ color:"#aaa" }}>(            HR)</span>}
                      </td>
                    </tr>

                    {/* 작업일시 – 종료 */}
                    <tr style={{ borderBottom: bdr }}>
                      <td colSpan={2} style={{ borderRight: bdr, padding:"1.5mm 3mm", verticalAlign:"middle" }}>
                        <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:"1mm", fontSize:"10pt" }}>
                          <span>20</span>
                          <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.e_yr} placeholder="YY"
                            onChange={e => sf({ e_yr: e.target.value })} />
                          <span>년</span>
                          <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.e_mo} placeholder="MM"
                            onChange={e => sf({ e_mo: e.target.value })} />
                          <span>월</span>
                          <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.e_dy} placeholder="DD"
                            onChange={e => sf({ e_dy: e.target.value })} />
                          <span>일(</span>
                          <span style={{ width:"5mm", textAlign:"center", fontWeight:"bold", color:"#1d4ed8" }}>{endDow || "??"}</span>
                          <span>요일)</span>
                          <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.e_hr} placeholder="HH"
                            onChange={e => sf({ e_hr: e.target.value })} />
                          <span>시</span>
                          <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.e_mi} placeholder="MM"
                            onChange={e => sf({ e_mi: e.target.value })} />
                          <span>분부터</span>
                        </div>
                      </td>
                      {/* 휴일 체크 */}
                      <td style={{ padding:"1.5mm 3mm", verticalAlign:"middle", fontSize:"9pt" }}>
                        <label style={{ display:"flex", alignItems:"center", gap:"1mm", cursor:"pointer" }}>
                          <input type="checkbox" checked={f.is_holiday}
                            onChange={e => sf({ is_holiday: e.target.checked, holiday_type: e.target.checked ? (f.holiday_type || "공휴일") : "" })} />
                          휴일근무
                        </label>
                        {f.is_holiday && (
                          <select value={f.holiday_type}
                            onChange={e => sf({ holiday_type: e.target.value })}
                            style={{ marginTop:"0.5mm", border:"none", borderBottom:"1px solid #888", background:"transparent", fontSize:"8.5pt", width:"100%", outline:"none" }}>
                            <option>토요일</option><option>일요일</option><option>공휴일</option>
                          </select>
                        )}
                      </td>
                    </tr>

                    {/* 작업자명 */}
                    <tr style={{ borderBottom: bdr }}>
                      <td data-label="true" style={{ ...labelCell, height:"11mm" }}>작업자명</td>
                      <td colSpan={3} style={{ padding:"1mm 2mm", verticalAlign:"middle" }}>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(8, 1fr)", gap:"0 1mm" }}>
                          {f.workers.map((w, i) => (
                            <input key={i} style={{ ...iPart, width:"100%", textAlign:"center", padding:"0 0.5mm" }}
                              value={w} placeholder={`작업자${i+1}`}
                              onChange={e => { const ws=[...f.workers]; ws[i]=e.target.value; sf({ workers: ws }); }} />
                          ))}
                        </div>
                      </td>
                    </tr>

                    {/* 비고 */}
                    <tr style={{ borderBottom: bdr }}>
                      <td data-label="true" style={{ ...labelCell, height:"9mm" }}>비 고</td>
                      <td colSpan={3} style={{ padding:"0 2mm", verticalAlign:"middle" }}>
                        <input style={iCell} value={f.note} onChange={e => sf({ note: e.target.value })} />
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
            </div>
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
