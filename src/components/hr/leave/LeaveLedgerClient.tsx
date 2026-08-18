"use client";

import { useState, useEffect, useCallback } from "react";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

export const LR_LEDGER_MENU_HREF = "/hr/leave-ledger";

const LEAVE_TYPES = ["조퇴", "결근", "경조", "연차", "훈련", "교육", "휴가"] as const;
const bdr = "1px solid #444";

interface Account { id: number; username: string; dept: string | null; signature_url: string | null; }
interface LeaveRow {
  id: number; request_no: string; author_id: number; leave_type: string;
  s_yr: string|null; s_mo: string|null; s_dy: string|null; s_hr: string|null; s_mi: string|null;
  e_yr: string|null; e_mo: string|null; e_dy: string|null; e_hr: string|null; e_mi: string|null;
  duration_days: number|null; reason: string|null;
  sub_yr: string|null; sub_mo: string|null; sub_dy: string|null;
  approver_id: number|null; approval_status: string;
  approver_signature: string|null; author_signature: string|null;
  approved_at: string|null; submitted_at: string|null; created_at: string;
}

function dowKr(yr: string|null, mo: string|null, dy: string|null) {
  if (!yr || !mo || !dy) return "";
  const d = new Date(`20${yr.padStart(2,"0")}-${mo.padStart(2,"0")}-${dy.padStart(2,"0")}`);
  return isNaN(d.getTime()) ? "" : ["일","월","화","수","목","금","토"][d.getDay()];
}
function periodStr(r: LeaveRow) {
  if (!r.s_yr) return "—";
  const s = `20${r.s_yr}/${r.s_mo}/${r.s_dy}`;
  if (!r.e_yr || (r.s_yr===r.e_yr && r.s_mo===r.e_mo && r.s_dy===r.e_dy)) return s;
  return `${s} ~ 20${r.e_yr}/${r.e_mo}/${r.e_dy}`;
}

export default function LeaveLedgerClient() {
  const { user } = useAuth();
  const isManager = user ? (isAdmin(user) || hasMenuPermission(user, LR_LEDGER_MENU_HREF, "update")) : false;

  const [rows, setRows]         = useState<LeaveRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [query, setQuery]       = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [dateTo, setDateTo]     = useState(() => `${new Date().getFullYear()}-12-31`);
  const [detail, setDetail]     = useState<LeaveRow|null>(null);
  const [editModal, setEditModal] = useState<LeaveRow|null>(null);
  const [editForm, setEditForm]   = useState<Partial<LeaveRow>>({});
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    let q = supabase.from("leave_requests").select("*")
      .eq("approval_status","approved")
      .order("approved_at",{ascending:false});
    if (!isManager) q = q.eq("author_id", user.id);
    const { data } = await q;
    setRows((data as LeaveRow[]|null) ?? []);
  }, [user, isManager]);

  useEffect(() => {
    supabase.from("accounts").select("id,username,dept,signature_url").order("username")
      .then(({ data }) => setAccounts((data as Account[]|null) ?? []));
  }, []);
  useEffect(() => { load(); }, [load]);
  useReloadOnActivate(load);

  const filtered = rows.filter(r => {
    // 날짜 필터 (시작일 기준) — padStart로 단일자릿수 월/일 비교 오류 방지
    const pad = (v: string|null) => (v ?? "").padStart(2, "0");
    const dt = r.s_yr ? `20${pad(r.s_yr)}-${pad(r.s_mo)}-${pad(r.s_dy)}` : "";
    if (dateFrom && dt && dt < dateFrom) return false;
    if (dateTo   && dt && dt > dateTo)   return false;
    // 유형 필터
    if (typeFilter && r.leave_type !== typeFilter) return false;
    // 키워드 검색
    if (query) {
      const q2 = query.toLowerCase();
      const author = accounts.find(a => a.id === r.author_id);
      if (
        !r.request_no.toLowerCase().includes(q2) &&
        !(author?.username ?? "").toLowerCase().includes(q2) &&
        !(r.reason ?? "").toLowerCase().includes(q2)
      ) return false;
    }
    return true;
  });

  const totalDays = filtered.reduce((s,r) => s + (r.duration_days ?? 0), 0);

  async function saveEdit() {
    if (!editModal) return;
    setEditSaving(true);
    const { error } = await supabase.from("leave_requests").update({
      leave_type:    editForm.leave_type ?? editModal.leave_type,
      s_yr: editForm.s_yr, s_mo: editForm.s_mo, s_dy: editForm.s_dy,
      s_hr: editForm.s_hr, s_mi: editForm.s_mi,
      e_yr: editForm.e_yr, e_mo: editForm.e_mo, e_dy: editForm.e_dy,
      e_hr: editForm.e_hr, e_mi: editForm.e_mi,
      duration_days: editForm.duration_days,
      reason: editForm.reason,
      sub_yr: editForm.sub_yr, sub_mo: editForm.sub_mo, sub_dy: editForm.sub_dy,
    }).eq("id", editModal.id);
    setEditSaving(false);
    if (error) { alert("수정 실패: " + error.message); return; }
    setEditModal(null); load();
  }

  async function deleteRow(id: number, no: string) {
    if (!confirm(`${no} 문서를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    const { error } = await supabase.from("leave_requests").delete().eq("id", id);
    if (error) { alert("삭제 실패: " + error.message); return; }
    load();
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-100">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h1 className="text-base font-bold">년차계 등록대장</h1>
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
          setDateFrom(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`);
          setDateTo(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()}`);
        }} className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">이번달</button>
        <button onClick={() => {
          setDateFrom(`${new Date().getFullYear()}-01-01`);
          setDateTo(`${new Date().getFullYear()}-12-31`);
        }} className="text-xs text-gray-500 dark:text-gray-400 hover:underline whitespace-nowrap">올해</button>
        <button onClick={() => { setDateFrom(""); setDateTo(""); }}
          className="text-xs text-gray-400 dark:text-gray-500 hover:underline whitespace-nowrap">전체</button>
        <div className="w-px h-4 bg-gray-200 dark:bg-gray-600" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400">
          <option value="">전체 유형</option>
          {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="문서번호 / 작성자 / 사유 검색"
          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400 w-48" />
      </div>

      {/* 합계 바 */}
      {filtered.length > 0 && (
        <div className="flex gap-4 px-4 py-2 bg-blue-50 dark:bg-blue-950/20 border-b border-blue-100 dark:border-blue-900 text-xs shrink-0">
          <span>총 일수: <b className="text-blue-700 dark:text-blue-300">{totalDays % 1 === 0 ? totalDays : totalDays.toFixed(1)}일</b></span>
          <span className="text-gray-400">({filtered.length}건)</span>
        </div>
      )}

      {/* 목록 */}
      <div className="flex-1 overflow-auto p-4">
        {filtered.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-16">승인 완료된 년차계가 없습니다.</div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 text-[11px]">
                <tr>
                  <th className="px-3 py-2 text-left">문서번호</th>
                  <th className="px-3 py-2 text-center">유형</th>
                  {isManager && <th className="px-3 py-2 text-left">작성자</th>}
                  <th className="px-3 py-2 text-left">기간</th>
                  <th className="px-3 py-2 text-center">일수</th>
                  <th className="px-3 py-2 text-left">사유</th>
                  <th className="px-3 py-2 text-left">승인일</th>
                  <th className="px-3 py-2 text-center">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map(r => {
                  const author   = accounts.find(a => a.id === r.author_id);
                  const approvedAt = r.approved_at ? new Date(r.approved_at).toLocaleDateString("ko-KR") : "—";
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                      <td className="px-3 py-2 font-mono text-gray-500 dark:text-gray-400">{r.request_no}</td>
                      <td className="px-3 py-2 text-center">
                        <span className="px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                          {r.leave_type}
                        </span>
                      </td>
                      {isManager && <td className="px-3 py-2 font-medium">{author?.username ?? "—"}</td>}
                      <td className="px-3 py-2 whitespace-nowrap">{periodStr(r)}</td>
                      <td className="px-3 py-2 text-center font-bold text-blue-600 dark:text-blue-400">
                        {r.duration_days != null ? `${r.duration_days}일` : "—"}
                      </td>
                      <td className="px-3 py-2 max-w-[120px] truncate text-gray-600 dark:text-gray-300">{r.reason ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{approvedAt}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => setDetail(r)}
                            className="text-xs text-blue-600 hover:underline dark:text-blue-400">보기</button>
                          {user && isAdmin(user) && <>
                            <button onClick={() => { setEditModal(r); setEditForm({ ...r }); }}
                              className="text-xs text-gray-600 hover:underline dark:text-gray-300">수정</button>
                            <button onClick={() => deleteRow(r.id, r.request_no)}
                              className="text-xs text-red-500 hover:underline dark:text-red-400">삭제</button>
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

      {/* ── 상세 모달 (A4 뷰어) ── */}
      {detail && (() => {
        const author   = accounts.find(a => a.id === detail.author_id);
        const approver = accounts.find(a => a.id === detail.approver_id);
        const isApproved = detail.approval_status === "approved";
        const sigCol = approver?.username === "황진한" ? 0 : 1;
        const approvedAtStr = isApproved && detail.approved_at
          ? new Date(detail.approved_at).toLocaleDateString("ko-KR", { month:"2-digit", day:"2-digit" }).replace(". ","/").replace(".","")
          : null;
        const sDow = dowKr(detail.s_yr, detail.s_mo, detail.s_dy);
        const eDow = dowKr(detail.e_yr, detail.e_mo, detail.e_dy);
        const iPart: React.CSSProperties = { fontFamily:"'Malgun Gothic','맑은 고딕',sans-serif", fontSize:"10.5pt" };
        return (
          <>
            <style dangerouslySetInnerHTML={{ __html: `
              @media print {
                body * { visibility: hidden !important; }
                #lr-ledger-doc, #lr-ledger-doc * { visibility: visible !important; }
                #lr-ledger-doc { position: fixed !important; top: 0 !important; left: 0 !important; width: 210mm !important; box-shadow: none !important; }
              }
            ` }} />
            <div className="fixed inset-0 z-50 bg-black/60 overflow-auto" onClick={e => { if (e.target === e.currentTarget) setDetail(null); }}>
              <div className="min-h-full flex flex-col items-center py-6 px-4">
                {/* 툴바 */}
                <div className="print:hidden flex items-center justify-between gap-3 mb-4 w-full max-w-[230mm]">
                  <span className="text-white text-sm font-medium">{detail.leave_type}계 — {detail.request_no}</span>
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
                <div id="lr-ledger-doc" style={{
                  width:"210mm", minHeight:"297mm", padding:"18mm 20mm",
                  background:"white", color:"#111",
                  fontFamily:"'Malgun Gothic','맑은 고딕',sans-serif", fontSize:"10pt",
                  display:"flex", flexDirection:"column",
                  boxShadow:"0 4px 24px rgba(0,0,0,0.3)",
                }}>
                  <div style={{ border:"2px solid #333", flex:1, padding:"12mm 14mm", display:"flex", flexDirection:"column" }}>

                    {/* 제목 + 결재란 */}
                    <div style={{ display:"flex", alignItems:"flex-start", marginBottom:"12mm" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:"40pt", fontWeight:900, letterSpacing:"4px", lineHeight:1 }}>
                          <span>(</span>
                          <span style={{ display:"inline-block", minWidth:"80px", textAlign:"center" }}>{detail.leave_type}</span>
                          <span>)계</span>
                        </div>
                      </div>
                      <table style={{ borderCollapse:"collapse", border: bdr }}>
                        <tbody>
                          <tr>
                            <td rowSpan={3} style={{ border: bdr, width:"6mm", fontSize:"9pt", fontWeight:"bold", background:"#f0f0f0", textAlign:"center", verticalAlign:"middle", writingMode:"vertical-rl", letterSpacing:"2px", padding:0 }}>결재</td>
                            {["담당","팀장","임원","대표","대표"].map((lbl,i) => (
                              <th key={i} style={{ border: bdr, width:"14mm", height:"7mm", textAlign:"center", fontSize:"8pt", fontWeight:"bold", background:"#f0f0f0", padding:0 }}>{lbl}</th>
                            ))}
                          </tr>
                          <tr>
                            {[0,1,2,3,4].map(i => (
                              <td key={i} style={{ border: bdr, width:"14mm", height:"18mm", textAlign:"center", verticalAlign:"middle", padding:"1mm" }}>
                                {i === sigCol && isApproved && detail.approver_signature && (
                                  <img src={detail.approver_signature} alt="서명" style={{ maxWidth:"100%", maxHeight:"15mm", objectFit:"contain" }} />
                                )}
                              </td>
                            ))}
                          </tr>
                          <tr>
                            {[0,1,2,3,4].map(i => (
                              <td key={i} style={{ border: bdr, textAlign:"center", fontSize:"9pt", height:"6mm", padding:0 }}>
                                {i === sigCol && approvedAtStr ? approvedAtStr : "/"}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* 성명 */}
                    <div style={{ marginBottom:"8mm", fontSize:"11pt" }}>
                      <span style={{ fontWeight:"bold", marginRight:"6mm" }}>성 명 :</span>
                      <span style={{ borderBottom:"1px solid #444", display:"inline-block", minWidth:"30mm", paddingBottom:"1mm" }}>
                        {author?.username ?? ""}
                      </span>
                    </div>

                    {/* 본문 */}
                    <div style={{ marginBottom:"10mm", fontSize:"10.5pt", lineHeight:1.8 }}>
                      상기 본인은 아래와 같은 사유로 인하여 (
                      <span style={{ fontWeight:"bold", margin:"0 2mm" }}>{detail.leave_type}</span>
                      )계를 제출하오니 재가 바랍니다.
                    </div>

                    {/* 기간 박스 */}
                    <div style={{ border: bdr, padding:"5mm 6mm", marginBottom:"10mm", display:"flex", alignItems:"center", gap:"3mm" }}>
                      <span style={{ fontWeight:"bold", fontSize:"11pt", whiteSpace:"nowrap" }}>기 간 :</span>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", alignItems:"center", flexWrap:"nowrap", gap:"0.8mm", marginBottom:"3mm", ...iPart }}>
                          <span>{detail.s_yr ? `20${detail.s_yr}` : ""}</span><span>년</span>
                          <span>{detail.s_mo}</span><span>월</span>
                          <span>{detail.s_dy}</span>
                          <span>일(</span>
                          <span style={{ fontWeight:"bold", color:"#1d4ed8" }}>{sDow}</span>
                          <span>요일)</span>
                          {detail.s_hr && <><span>{detail.s_hr}</span><span>시</span></>}
                          {detail.s_mi && <><span>{detail.s_mi}</span><span>분부터</span></>}
                          {!detail.s_hr && <span>부터</span>}
                        </div>
                        <div style={{ display:"flex", alignItems:"center", flexWrap:"nowrap", gap:"0.8mm", ...iPart }}>
                          <span>{detail.e_yr ? `20${detail.e_yr}` : ""}</span><span>년</span>
                          <span>{detail.e_mo}</span><span>월</span>
                          <span>{detail.e_dy}</span>
                          <span>일(</span>
                          <span style={{ fontWeight:"bold", color:"#1d4ed8" }}>{eDow}</span>
                          <span>요일)</span>
                          {detail.e_hr && <><span>{detail.e_hr}</span><span>시</span></>}
                          {detail.e_mi && <><span>{detail.e_mi}</span><span>분까지</span></>}
                          {!detail.e_hr && <span>까지</span>}
                        </div>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:"0.8mm", whiteSpace:"nowrap", ...iPart }}>
                        <span>(</span>
                        <span style={{ minWidth:"10mm", textAlign:"center", fontWeight:"bold" }}>
                          {detail.duration_days ?? ""}
                        </span>
                        <span>)일간</span>
                      </div>
                    </div>

                    {/* 사유 */}
                    <div style={{ marginBottom:"8mm", paddingLeft:"10mm", display:"flex", alignItems:"center", gap:"4mm" }}>
                      <span style={{ fontSize:"11pt", fontWeight:"bold", whiteSpace:"nowrap" }}>사 유 :</span>
                      <span style={{ borderBottom:"1px solid #444", flex:1, paddingBottom:"1mm", fontSize:"11pt" }}>
                        {detail.reason ?? ""}
                      </span>
                    </div>

                    {/* 제출일 */}
                    <div style={{ marginBottom:"14mm", paddingLeft:"10mm", fontSize:"11pt" }}>
                      <span style={{ fontWeight:"bold" }}>제출일 : </span>
                      {detail.sub_yr ? `20${detail.sub_yr}년 ${detail.sub_mo}월 ${detail.sub_dy}일` : ""}
                    </div>

                    {/* 작성자 */}
                    <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center", marginBottom:"10mm", gap:"2mm" }}>
                      <span style={{ fontSize:"11pt", fontWeight:"bold", whiteSpace:"nowrap" }}>작성자 :</span>
                      <span style={{ borderBottom:"1px solid #444", minWidth:"36mm", fontSize:"11pt", paddingBottom:"1mm", display:"inline-block", textAlign:"center" }}>
                        {author?.username ?? ""}
                      </span>
                      <div style={{ width:"14mm", height:"14mm", border: bdr, display:"flex", alignItems:"center", justifyContent:"center", position:"relative", marginLeft:"1mm" }}>
                        {detail.author_signature
                          ? <img src={detail.author_signature} alt="서명" style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"contain" }} />
                          : <span style={{ fontSize:"8pt", color:"#aaa" }}>(인)</span>}
                      </div>
                    </div>

                    {/* 구분 체크박스 */}
                    <div style={{ flex:1 }} />
                    <div style={{ display:"flex", justifyContent:"center", gap:"6mm", flexWrap:"wrap", marginBottom:"4mm", fontSize:"10pt" }}>
                      {LEAVE_TYPES.map(t => (
                        <label key={t} style={{ display:"flex", alignItems:"center", gap:"1.5mm" }}>
                          <input type="checkbox" readOnly checked={detail.leave_type === t}
                            style={{ width:"3.5mm", height:"3.5mm", accentColor:"#333" }} />
                          <span style={{ fontWeight: detail.leave_type === t ? "bold" : "normal" }}>{t}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* 회사명 */}
                  <div style={{ textAlign:"right", fontSize:"11pt", fontWeight:"bold", marginTop:"5mm" }}>
                    주식회사 대솔E/L
                  </div>
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── 수정 모달 ── */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <span className="font-bold text-sm">년차계 수정 — {editModal.request_no}</span>
              <button onClick={() => setEditModal(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm">
              {/* 유형 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">휴가 유형</label>
                <div className="flex flex-wrap gap-2">
                  {LEAVE_TYPES.map(t => (
                    <label key={t} className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg cursor-pointer text-xs select-none"
                      style={{ borderColor: editForm.leave_type === t ? "#7c3aed" : "#d1d5db", background: editForm.leave_type === t ? "#f5f3ff" : "white", color: editForm.leave_type === t ? "#7c3aed" : "#374151" }}>
                      <input type="radio" className="hidden" checked={editForm.leave_type === t} onChange={() => setEditForm(f => ({ ...f, leave_type: t }))} />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
              {/* 시작 */}
              <div className="grid grid-cols-5 gap-2">
                {[["s_yr","YY","시작년"],["s_mo","MM","월"],["s_dy","DD","일"],["s_hr","HH","시(선택)"],["s_mi","MM","분(선택)"]].map(([k,ph,lbl]) => (
                  <div key={k}>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{lbl}</label>
                    <input maxLength={2} placeholder={ph}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400 text-center"
                      value={(editForm as Record<string,unknown>)[k] as string ?? ""}
                      onChange={e => setEditForm(f => ({ ...f, [k]: e.target.value }))} />
                  </div>
                ))}
              </div>
              {/* 종료 */}
              <div className="grid grid-cols-5 gap-2">
                {[["e_yr","YY","종료년"],["e_mo","MM","월"],["e_dy","DD","일"],["e_hr","HH","시(선택)"],["e_mi","MM","분(선택)"]].map(([k,ph,lbl]) => (
                  <div key={k}>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{lbl}</label>
                    <input maxLength={2} placeholder={ph}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400 text-center"
                      value={(editForm as Record<string,unknown>)[k] as string ?? ""}
                      onChange={e => setEditForm(f => ({ ...f, [k]: e.target.value }))} />
                  </div>
                ))}
              </div>
              {/* 일수 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">일수</label>
                <input type="number" step="0.5" min="0"
                  className="w-32 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400"
                  value={editForm.duration_days ?? ""}
                  onChange={e => setEditForm(f => ({ ...f, duration_days: e.target.value ? parseFloat(e.target.value) : undefined }))} />
              </div>
              {/* 사유 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">사유</label>
                <input className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400"
                  value={editForm.reason ?? ""}
                  onChange={e => setEditForm(f => ({ ...f, reason: e.target.value }))} />
              </div>
              {/* 제출일 */}
              <div className="grid grid-cols-3 gap-2">
                {[["sub_yr","YY","제출년"],["sub_mo","MM","월"],["sub_dy","DD","일"]].map(([k,ph,lbl]) => (
                  <div key={k}>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{lbl}</label>
                    <input maxLength={2} placeholder={ph}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400 text-center"
                      value={(editForm as Record<string,unknown>)[k] as string ?? ""}
                      onChange={e => setEditForm(f => ({ ...f, [k]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
              <button onClick={() => setEditModal(null)}
                className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 rounded-lg font-medium">취소</button>
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
