"use client";

import { useState, useEffect, useCallback } from "react";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { calcOvertimeResult, detectHoliday, dayOfWeekKr } from "./overtimeCalc";

const WORK_REASONS = ["점검", "공사", "수리·부품교체", "상주", "조출", "기타"] as const;
const bdr = "1px solid #444";
const labelCell: React.CSSProperties = {
  background: "#f5f5f5", fontWeight: "bold", textAlign: "center",
  fontSize: "9pt", borderRight: bdr, whiteSpace: "nowrap", padding: "0 2mm", verticalAlign: "middle",
};

export const OT_LEDGER_MENU_HREF = "/hr/overtime-ledger";

interface Account {
  id: number;
  username: string;
  dept: string | null;
}

interface OTRow {
  id: number;
  report_no: string;
  author_id: number;
  site_name: string;
  work_instructor: string | null;
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
  worker_notes: string[];
  work_content: string | null;
  work_result: string | null;
  note: string | null;
  approver_id: number | null;
  approved_at: string | null;
  approval_status: string;
}

interface EditForm {
  site_name: string; work_instructor: string;
  work_reasons: string[]; work_reason_etc: string; work_elevator: string;
  start_at: string; end_at: string;
  workers: string[]; worker_notes: string[];
  work_content: string; work_result: string; note: string;
  approver_id: number | null;
}

function rowToEditForm(r: OTRow): EditForm {
  const ws = [...(r.workers ?? [])];      while (ws.length < 10) ws.push("");
  const wn = [...(r.worker_notes ?? [])]; while (wn.length < 10) wn.push("");
  return {
    site_name: r.site_name, work_instructor: r.work_instructor ?? "",
    work_reasons: r.work_reasons, work_reason_etc: r.work_reason_etc ?? "",
    work_elevator: r.work_elevator ?? "",
    start_at: r.start_at.slice(0, 16), end_at: r.end_at.slice(0, 16),
    workers: ws, worker_notes: wn,
    work_content: r.work_content ?? "", work_result: r.work_result ?? "",
    note: r.note ?? "", approver_id: r.approver_id,
  };
}

export default function OvertimeLedgerClient() {
  const { user } = useAuth();
  const isManager = user ? (isAdmin(user) || hasMenuPermission(user, OT_LEDGER_MENU_HREF, "update")) : false;

  const [rows, setRows] = useState<OTRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [detail, setDetail] = useState<OTRow | null>(null);
  const [editingRow, setEditingRow] = useState<OTRow | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const ef = (patch: Partial<EditForm>) => setEditForm(f => f ? { ...f, ...patch } : f);

  const load = useCallback(async () => {
    if (!user) return;
    const PAGE = 500;
    const all: OTRow[] = [];
    for (let off = 0; ; off += PAGE) {
      let q = supabase
        .from("overtime_reports")
        .select("*")
        .eq("approval_status", "approved")
        .order("approved_at", { ascending: false })
        .range(off, off + PAGE - 1);
      if (!isManager) q = q.eq("author_id", user.id);
      const { data } = await q;
      const batch = (data as OTRow[] | null) ?? [];
      all.push(...batch);
      if (batch.length < PAGE) break;
    }
    setRows(all);
  }, [user, isManager]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("accounts").select("id, username, dept").order("username");
      setAccounts((data as Account[] | null) ?? []);
    })();
  }, []);

  useEffect(() => { load(); }, [load]);
  useReloadOnActivate(load);

  async function saveEdit() {
    if (!editingRow || !editForm) return;
    setEditSaving(true);
    const s = new Date(editForm.start_at);
    const e = new Date(editForm.end_at);
    const { isHoliday, holidayType } = detectHoliday(s);
    const ot = calcOvertimeResult(s, e, isHoliday);
    const { error } = await supabase.from("overtime_reports").update({
      site_name: editForm.site_name.trim(),
      work_instructor: editForm.work_instructor.trim() || null,
      work_reasons: editForm.work_reasons,
      work_reason_etc: editForm.work_reasons.includes("기타") ? (editForm.work_reason_etc.trim() || null) : null,
      work_elevator: editForm.work_elevator.trim() || null,
      start_at: s.toISOString(), end_at: e.toISOString(),
      is_holiday: isHoliday, holiday_type: isHoliday ? holidayType : null,
      work_hours: ot.workHours, holiday_hours: ot.holidayHours, overtime_hours: ot.overtimeHours,
      workers: editForm.workers, worker_notes: editForm.worker_notes,
      work_content: editForm.work_content.trim() || null,
      work_result: editForm.work_result.trim() || null,
      note: editForm.note.trim() || null,
      approver_id: editForm.approver_id,
      updated_at: new Date().toISOString(),
    }).eq("id", editingRow.id);
    setEditSaving(false);
    if (error) { alert("수정 실패: " + error.message); return; }
    setEditingRow(null); setEditForm(null);
    load();
  }

  async function deleteRow(id: number, reportNo: string) {
    if (!confirm(`보고서 ${reportNo}을(를) 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    const { error } = await supabase.from("overtime_reports").delete().eq("id", id);
    if (error) { alert("삭제 실패: " + error.message); return; }
    load();
  }

  const filtered = rows.filter(r => {
    const dt = r.start_at.slice(0, 10); // YYYY-MM-DD
    if (dateFrom && dt < dateFrom) return false;
    if (dateTo   && dt > dateTo)   return false;
    if (query) {
      const q = query.toLowerCase();
      const author = accounts.find(a => a.id === r.author_id);
      if (
        !r.site_name.toLowerCase().includes(q) &&
        !r.report_no.toLowerCase().includes(q) &&
        !(author?.username ?? "").toLowerCase().includes(q) &&
        !(r.work_instructor ?? "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  // 합계 계산
  const totalWork     = filtered.reduce((s, r) => s + (r.work_hours ?? 0), 0);
  const totalHoliday  = filtered.reduce((s, r) => s + (r.holiday_hours ?? 0), 0);
  const totalOvertime = filtered.reduce((s, r) => s + (r.overtime_hours ?? 0), 0);

  function fmt(h: number) { return h % 1 === 0 ? `${h}H` : `${h.toFixed(1)}H`; }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-100">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h1 className="text-base font-bold">잔업보고서 등록대장</h1>
        <span className="text-xs text-gray-400">{filtered.length}건</span>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 shrink-0">
        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">기간</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400" />
        <span className="text-xs text-gray-400">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400" />
        <button onClick={() => {
          const d = new Date();
          setDateFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
          setDateTo(d.toISOString().slice(0, 10));
        }} className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">이번달</button>
        <button onClick={() => {
          const d = new Date();
          setDateFrom(`${d.getFullYear()}-01-01`);
          setDateTo(d.toISOString().slice(0, 10));
        }} className="text-xs text-gray-500 dark:text-gray-400 hover:underline whitespace-nowrap">올해</button>
        <button onClick={() => { setDateFrom(""); setDateTo(""); }}
          className="text-xs text-gray-400 dark:text-gray-500 hover:underline whitespace-nowrap">전체</button>
        <div className="w-px h-4 bg-gray-200 dark:bg-gray-600" />
        <input
          type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="현장명 / 보고서번호 / 작성자 검색"
          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400 w-52" />
      </div>

      {/* 합계 바 */}
      {filtered.length > 0 && (
        <div className="flex gap-4 px-4 py-2 bg-blue-50 dark:bg-blue-950/20 border-b border-blue-100 dark:border-blue-900 text-xs shrink-0">
          <span>총 근무: <b className="text-blue-700 dark:text-blue-300">{fmt(totalWork)}</b></span>
          <span>휴일근무: <b className="text-orange-600 dark:text-orange-300">{fmt(totalHoliday)}</b></span>
          <span>잔업: <b className="text-purple-600 dark:text-purple-300">{fmt(totalOvertime)}</b></span>
        </div>
      )}

      {/* 목록 */}
      <div className="flex-1 overflow-auto p-4">
        {filtered.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-16">승인 완료된 잔업보고서가 없습니다.</div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 uppercase text-[11px]">
                <tr>
                  <th className="px-3 py-2 text-left">보고서번호</th>
                  <th className="px-3 py-2 text-left">현장명</th>
                  <th className="px-3 py-2 text-left">작업일시</th>
                  <th className="px-3 py-2 text-center">휴일</th>
                  <th className="px-3 py-2 text-center">근무</th>
                  <th className="px-3 py-2 text-center">잔업</th>
                  <th className="px-3 py-2 text-left">작업사유</th>
                  {isManager && <th className="px-3 py-2 text-left">작성자</th>}
                  <th className="px-3 py-2 text-center">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map(r => {
                  const s = new Date(r.start_at);
                  const e = new Date(r.end_at);
                  const author = accounts.find(a => a.id === r.author_id);
                  const ot = calcOvertimeResult(s, e, r.is_holiday);
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                      <td className="px-3 py-2 font-mono text-gray-500">{r.report_no}</td>
                      <td className="px-3 py-2 font-medium">{r.site_name}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div>{s.toLocaleDateString("ko-KR")}</div>
                        <div className="text-gray-400">
                          {s.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                          {" ~ "}
                          {e.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.is_holiday
                          ? <span className="text-orange-500 font-medium">{r.holiday_type ?? "휴일"}</span>
                          : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center font-medium text-blue-600 dark:text-blue-400">
                        {r.work_hours != null ? fmt(r.work_hours) : "-"}
                      </td>
                      <td className="px-3 py-2 text-center font-medium text-purple-600 dark:text-purple-400">
                        {r.overtime_hours != null ? fmt(r.overtime_hours) : "-"}
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                        {r.work_reasons.join(", ")}
                        {r.work_reason_etc ? ` (${r.work_reason_etc})` : ""}
                      </td>
                      {isManager && (
                        <td className="px-3 py-2">{author?.username ?? "-"}</td>
                      )}
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => setDetail(r)}
                            className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                            보기
                          </button>
                          {isManager && <>
                            <button onClick={() => { setEditingRow(r); setEditForm(rowToEditForm(r)); }}
                              className="text-xs text-gray-600 hover:underline dark:text-gray-300">
                              수정
                            </button>
                            <button onClick={() => deleteRow(r.id, r.report_no)}
                              className="text-xs text-red-500 hover:underline dark:text-red-400">
                              삭제
                            </button>
                          </>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 상세 모달 — A4 문서 뷰어 */}
      {detail && (() => {
        const s = new Date(detail.start_at);
        const e = new Date(detail.end_at);
        const s_yr = String(s.getFullYear()).slice(2);
        const s_mo = String(s.getMonth() + 1).padStart(2, "0");
        const s_dy = String(s.getDate()).padStart(2, "0");
        const s_hr = String(s.getHours()).padStart(2, "0");
        const s_mi = String(s.getMinutes()).padStart(2, "0");
        const sDow = dayOfWeekKr(s);
        const e_yr = String(e.getFullYear()).slice(2);
        const e_mo = String(e.getMonth() + 1).padStart(2, "0");
        const e_dy = String(e.getDate()).padStart(2, "0");
        const e_hr = String(e.getHours()).padStart(2, "0");
        const e_mi = String(e.getMinutes()).padStart(2, "0");
        const eDow = dayOfWeekKr(e);
        const ot = calcOvertimeResult(s, e, detail.is_holiday);
        const author   = accounts.find(a => a.id === detail.author_id);
        const approver = accounts.find(a => a.id === detail.approver_id);
        const workers     = [...(detail.workers ?? [])];     while (workers.length < 10)     workers.push("");
        const workerNotes = [...(detail.worker_notes ?? [])]; while (workerNotes.length < 10) workerNotes.push("");
        const docText: React.CSSProperties = { fontSize:"10pt", fontFamily:"'Malgun Gothic','맑은 고딕',sans-serif", display:"block" };

        return (
          <>
            <style dangerouslySetInnerHTML={{ __html: `
              @media print {
                body * { visibility: hidden !important; }
                #ot-ledger-print-doc, #ot-ledger-print-doc * { visibility: visible !important; }
                #ot-ledger-print-doc {
                  position: fixed !important; top: 0 !important; left: 0 !important;
                  width: 210mm !important; box-shadow: none !important;
                }
              }
            ` }} />
            <div className="fixed inset-0 z-50 bg-black/60 overflow-auto" onClick={e => { if (e.target === e.currentTarget) setDetail(null); }}>
              <div className="min-h-full flex flex-col items-center py-6 px-4">
                {/* 툴바 */}
                <div className="print:hidden flex items-center justify-between gap-3 mb-4 w-full max-w-[230mm]">
                  <span className="text-white text-sm font-medium">잔업보고서 {detail.report_no}</span>
                  <div className="flex gap-2">
                    <button onClick={() => window.print()}
                      className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded font-medium">
                      🖨️ 인쇄
                    </button>
                    <button onClick={() => setDetail(null)}
                      className="px-3 py-1.5 text-xs bg-white/10 hover:bg-white/20 text-white rounded font-medium">
                      ✕ 닫기
                    </button>
                  </div>
                </div>

                {/* A4 문서 */}
                <div id="ot-ledger-print-doc" style={{
                  width: "210mm", minHeight: "297mm",
                  padding: "12mm 14mm",
                  background: "white", color: "#111",
                  fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif",
                  fontSize: "10pt",
                  display: "flex", flexDirection: "column",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
                }}>

                  {/* ── 제목 + 결재란 ── */}
                  <div style={{ display:"flex", alignItems:"stretch", marginBottom:"4mm" }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:"30pt", fontWeight:900, textDecoration:"underline", letterSpacing:"10px", lineHeight:1 }}>
                        잔업보고서
                      </div>
                      <div style={{ marginTop:"6mm", fontSize:"9.5pt" }}>
                        아래와 같이 시간외 근로(잔업) 사유가 발생하였기에 보고서를 제출합니다.
                      </div>
                    </div>
                    <table style={{ borderCollapse:"collapse", border: bdr, marginLeft:"4mm", alignSelf:"flex-start" }}>
                      <thead>
                        <tr>
                          {["담당","팀장","임원","대표","대표"].map((r,i) => (
                            <th key={i} style={{ border: bdr, width:"17mm", height:"7mm", textAlign:"center", fontSize:"9pt", fontWeight:"bold", background:"#f0f0f0", padding:0 }}>{r}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {[0,1,2,3,4].map(i => (
                            <td key={i} style={{ border: bdr, width:"17mm", height:"20mm", textAlign:"center", verticalAlign:"middle", fontSize:"8pt", color:"#444" }}>
                              {i === 0 && approver && <span style={{ fontSize:"8pt", fontWeight:"bold" }}>{approver.username}</span>}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          {[0,1,2,3,4].map(i => (
                            <td key={i} style={{ border: bdr, textAlign:"center", fontSize:"9pt", color:"#888", height:"6mm", padding:0 }}>
                              {i === 0 && detail.approved_at
                                ? new Date(detail.approved_at).toLocaleDateString("ko-KR", { month:"2-digit", day:"2-digit" })
                                : "/"}
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
                        <td style={{ borderRight: bdr, padding:"0 3mm", verticalAlign:"middle" }}>
                          <span style={docText}>{detail.site_name}</span>
                        </td>
                        <td data-label="true" style={{ ...labelCell, borderBottom:"none" }}>작업지시자</td>
                        <td style={{ padding:"0 3mm", verticalAlign:"middle" }}>
                          <span style={docText}>{detail.work_instructor ?? ""}</span>
                        </td>
                      </tr>

                      {/* 작업사유 */}
                      <tr style={{ borderBottom: bdr }}>
                        <td data-label="true" style={{ ...labelCell, height:"10mm" }}>작업사유</td>
                        <td colSpan={3} style={{ padding:"2mm 3mm", verticalAlign:"middle" }}>
                          <div style={{ display:"flex", flexWrap:"wrap", gap:"0 6mm", fontSize:"10pt", alignItems:"center" }}>
                            {WORK_REASONS.map(r => (
                              <label key={r} style={{ display:"flex", alignItems:"center", gap:"1mm", whiteSpace:"nowrap" }}>
                                <input type="checkbox" readOnly checked={detail.work_reasons.includes(r)} style={{ accentColor:"#444" }} />
                                {r}
                              </label>
                            ))}
                            {detail.work_reasons.includes("기타") && detail.work_reason_etc && (
                              <span style={{ fontSize:"10pt", borderBottom:"1px solid #444", minWidth:"28mm", marginLeft:"1mm" }}>
                                {detail.work_reason_etc}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* 작업호기 */}
                      <tr style={{ borderBottom: bdr }}>
                        <td data-label="true" style={{ ...labelCell, height:"9mm" }}>작업호기</td>
                        <td colSpan={3} style={{ padding:"0 3mm", verticalAlign:"middle" }}>
                          <span style={docText}>{detail.work_elevator ?? ""}</span>
                        </td>
                      </tr>

                      {/* 작업일시 */}
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
                              <tr style={{ borderBottom:"1px solid #ccc" }}>
                                <td style={{ borderRight:bdr, textAlign:"center", fontSize:"9pt", fontWeight:"bold", padding:"1.5mm 0", verticalAlign:"middle" }}>시 작</td>
                                <td style={{ padding:"1.5mm 3mm", verticalAlign:"middle" }}>
                                  <span style={{ fontSize:"10pt", fontFamily:"'Malgun Gothic','맑은 고딕',sans-serif" }}>
                                    20{s_yr}년 {s_mo}월 {s_dy}일(
                                    <span style={{ fontWeight:"bold", color:"#1d4ed8" }}>{sDow}</span>
                                    요일) {s_hr}시 {s_mi}분부터
                                  </span>
                                </td>
                                <td style={{ borderLeft:bdr, textAlign:"center", fontWeight:"bold", fontSize:"10pt", verticalAlign:"middle", padding:"1.5mm 2mm", color:"#1d4ed8" }}>
                                  {ot.display}
                                </td>
                              </tr>
                              <tr>
                                <td style={{ borderRight:bdr, textAlign:"center", fontSize:"9pt", fontWeight:"bold", padding:"1.5mm 0", verticalAlign:"middle" }}>종 료</td>
                                <td style={{ padding:"1.5mm 3mm", verticalAlign:"middle" }}>
                                  <span style={{ fontSize:"10pt", fontFamily:"'Malgun Gothic','맑은 고딕',sans-serif" }}>
                                    20{e_yr}년 {e_mo}월 {e_dy}일(
                                    <span style={{ fontWeight:"bold", color:"#1d4ed8" }}>{eDow}</span>
                                    요일) {e_hr}시 {e_mi}분까지
                                  </span>
                                </td>
                                <td style={{ borderLeft:bdr, padding:"1.5mm 2mm", verticalAlign:"middle", fontSize:"9pt", color:"#444" }}>
                                  {detail.note ?? ""}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>

                      {/* 작업자명 + 비고 */}
                      <tr style={{ borderBottom: bdr }}>
                        <td data-label="true" style={{ ...labelCell, padding:0, verticalAlign:"top" }}>
                          <div style={{ height:"9mm", display:"flex", alignItems:"center", justifyContent:"center", borderBottom: bdr }}>작업자명</div>
                          <div style={{ height:"8mm", display:"flex", alignItems:"center", justifyContent:"center" }}>비 고</div>
                        </td>
                        <td colSpan={3} style={{ padding:0, verticalAlign:"top" }}>
                          <table style={{ width:"100%", borderCollapse:"collapse", height:"100%" }}>
                            <tbody>
                              <tr style={{ borderBottom: bdr }}>
                                {workers.map((w, i) => (
                                  <td key={i} style={{ borderLeft: i === 0 ? "none" : bdr, width:"10%", height:"9mm", textAlign:"center", verticalAlign:"middle", fontSize:"8.5pt", padding:"0.5mm", overflow:"hidden" }}>
                                    {w}
                                  </td>
                                ))}
                              </tr>
                              <tr>
                                {workerNotes.map((n, i) => (
                                  <td key={i} style={{ borderLeft: i === 0 ? "none" : bdr, width:"10%", height:"8mm", textAlign:"center", verticalAlign:"middle", fontSize:"8.5pt", padding:"1mm 0.5mm", overflow:"hidden" }}>
                                    {n}
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
                          {author?.username ?? ""}
                        </td>
                        <td data-label="true" style={{ ...labelCell, borderBottom:"none" }}>작성일자</td>
                        <td style={{ padding:"0 3mm", verticalAlign:"middle", color:"#444" }}>
                          {s.toLocaleDateString("ko-KR")}
                        </td>
                      </tr>

                    </tbody>
                  </table>

                  {/* ── 작업내용 ── */}
                  <div style={{ border: bdr, borderTop:"none", padding:"2mm 3mm", flex:1, minHeight:"74mm" }}>
                    <div style={{ fontSize:"9pt", fontWeight:"bold", marginBottom:"1mm" }}>
                      ※ 작업내용(점검 및 수리 경우 호기별 기록)
                    </div>
                    <div style={{ fontSize:"10pt", fontFamily:"'Malgun Gothic','맑은 고딕',sans-serif", whiteSpace:"pre-wrap", lineHeight:1.5 }}>
                      {detail.work_content ?? ""}
                    </div>
                  </div>

                  {/* ── 작업결과 ── */}
                  <div style={{ border: bdr, borderTop:"none", padding:"2mm 3mm", minHeight:"44mm" }}>
                    <div style={{ fontSize:"9pt", fontWeight:"bold", marginBottom:"1mm" }}>※ 작업결과</div>
                    <div style={{ fontSize:"10pt", fontFamily:"'Malgun Gothic','맑은 고딕',sans-serif", whiteSpace:"pre-wrap", lineHeight:1.5 }}>
                      {detail.work_result ?? ""}
                    </div>
                  </div>

                  {/* ── 회사명 ── */}
                  <div style={{ textAlign:"right", marginTop:"2mm", fontSize:"10pt", fontWeight:"bold", color:"#333" }}>
                    주식회사 대솔E/L
                  </div>

                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* 수정 모달 (관리자) */}
      {editingRow && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <span className="font-bold text-sm">잔업보고서 수정 — {editingRow.report_no}</span>
              <button onClick={() => { setEditingRow(null); setEditForm(null); }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            {/* 폼 */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">현장명</label>
                  <input className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400"
                    value={editForm.site_name} onChange={e => ef({ site_name: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">작업지시자</label>
                  <input className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400"
                    value={editForm.work_instructor} onChange={e => ef({ work_instructor: e.target.value })} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">작업사유</label>
                <div className="flex flex-wrap gap-2">
                  {WORK_REASONS.map(r => (
                    <label key={r} className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg cursor-pointer text-xs select-none"
                      style={{ borderColor: editForm.work_reasons.includes(r) ? "#2563eb" : "#d1d5db", background: editForm.work_reasons.includes(r) ? "#eff6ff" : "white", color: editForm.work_reasons.includes(r) ? "#1d4ed8" : "#374151" }}>
                      <input type="checkbox" className="hidden" checked={editForm.work_reasons.includes(r)}
                        onChange={e => ef({ work_reasons: e.target.checked ? [...editForm.work_reasons, r] : editForm.work_reasons.filter(x => x !== r) })} />
                      {r}
                    </label>
                  ))}
                </div>
                {editForm.work_reasons.includes("기타") && (
                  <input className="mt-2 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400"
                    value={editForm.work_reason_etc} onChange={e => ef({ work_reason_etc: e.target.value })} placeholder="기타 내용" />
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">작업호기</label>
                <input className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400"
                  value={editForm.work_elevator} onChange={e => ef({ work_elevator: e.target.value })} placeholder="예: 1호기, 2·3호기" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">시작일시</label>
                  <input type="datetime-local"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400"
                    value={editForm.start_at} onChange={e => ef({ start_at: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">종료일시</label>
                  <input type="datetime-local"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400"
                    value={editForm.end_at} onChange={e => ef({ end_at: e.target.value })} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">작업자 / 비고</label>
                <div className="space-y-1.5">
                  {editForm.workers.map((w, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <span className="text-xs text-gray-400 w-14 shrink-0">작업자{i + 1}</span>
                      <input className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400"
                        value={w} placeholder={`작업자${i + 1}`}
                        onChange={e => { const ws = [...editForm.workers]; ws[i] = e.target.value; ef({ workers: ws }); }} />
                      <input className="w-28 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400"
                        value={editForm.worker_notes[i]} placeholder="비고"
                        onChange={e => { const ns = [...editForm.worker_notes]; ns[i] = e.target.value; ef({ worker_notes: ns }); }} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">작업내용</label>
                <textarea rows={4}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm resize-none bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400"
                  value={editForm.work_content} onChange={e => ef({ work_content: e.target.value })} />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">작업결과</label>
                <textarea rows={3}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm resize-none bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400"
                  value={editForm.work_result} onChange={e => ef({ work_result: e.target.value })} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">잔업승인자</label>
                  <select className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400"
                    value={editForm.approver_id ?? ""}
                    onChange={e => ef({ approver_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">— 선택 —</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.username}{a.dept ? ` (${a.dept})` : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">메모</label>
                  <input className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400"
                    value={editForm.note} onChange={e => ef({ note: e.target.value })} />
                </div>
              </div>
            </div>

            {/* 푸터 */}
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
              <button onClick={() => { setEditingRow(null); setEditForm(null); }}
                className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 rounded-lg font-medium">
                취소
              </button>
              <button onClick={saveEdit} disabled={editSaving}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50">
                {editSaving ? "저장중…" : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
