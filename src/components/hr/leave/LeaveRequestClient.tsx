"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useReloadOnActivate, useTabIsActive } from "@/context/TabActivationContext";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { notifyLeaveApprovalRequest, notifyLeaveApproved, notifyLeaveRejected } from "./leaveNotify";

export const LR_MENU_HREF = "/hr/leave";

const LEAVE_TYPES = ["조퇴", "결근", "경조", "연차", "훈련", "교육", "휴가"] as const;
type LeaveType = typeof LEAVE_TYPES[number];

interface Account {
  id: number;
  username: string;
  dept: string | null;
  team: string | null;
  status: string | null;
  signature_url: string | null;
}
interface LeaveRequest {
  id: number;
  request_no: string;
  author_id: number;
  leave_type: string;
  s_yr: string | null; s_mo: string | null; s_dy: string | null; s_hr: string | null; s_mi: string | null;
  e_yr: string | null; e_mo: string | null; e_dy: string | null; e_hr: string | null; e_mi: string | null;
  duration_days: number | null;
  reason: string | null;
  sub_yr: string | null; sub_mo: string | null; sub_dy: string | null;
  approver_id: number | null;
  approval_status: string;
  approver_signature: string | null;
  author_signature: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  created_at: string;
}
interface FormState {
  leave_type: LeaveType;
  s_yr: string; s_mo: string; s_dy: string; s_hr: string; s_mi: string;
  e_yr: string; e_mo: string; e_dy: string; e_hr: string; e_mi: string;
  duration_days: string;
  reason: string;
  sub_yr: string; sub_mo: string; sub_dy: string;
  approver_id: number | null;
}

function makeEmptyForm(): FormState {
  const n = new Date();
  const yr = String(n.getFullYear()).slice(2);
  const mo = String(n.getMonth() + 1).padStart(2, "0");
  const dy = String(n.getDate()).padStart(2, "0");
  return {
    leave_type: "연차",
    s_yr: yr, s_mo: mo, s_dy: dy, s_hr: "", s_mi: "",
    e_yr: yr, e_mo: mo, e_dy: dy, e_hr: "", e_mi: "",
    duration_days: "",
    reason: "",
    sub_yr: yr, sub_mo: mo, sub_dy: dy,
    approver_id: null,
  };
}

function recordToForm(r: LeaveRequest): FormState {
  return {
    leave_type: (LEAVE_TYPES.includes(r.leave_type as LeaveType) ? r.leave_type : "연차") as LeaveType,
    s_yr: r.s_yr ?? "", s_mo: r.s_mo ?? "", s_dy: r.s_dy ?? "", s_hr: r.s_hr ?? "", s_mi: r.s_mi ?? "",
    e_yr: r.e_yr ?? "", e_mo: r.e_mo ?? "", e_dy: r.e_dy ?? "", e_hr: r.e_hr ?? "", e_mi: r.e_mi ?? "",
    duration_days: r.duration_days != null ? String(r.duration_days) : "",
    reason: r.reason ?? "",
    sub_yr: r.sub_yr ?? "", sub_mo: r.sub_mo ?? "", sub_dy: r.sub_dy ?? "",
    approver_id: r.approver_id,
  };
}

function dowKr(yr: string, mo: string, dy: string) {
  if (!yr || !mo || !dy) return "";
  const d = new Date(`20${yr.padStart(2,"0")}-${mo.padStart(2,"0")}-${dy.padStart(2,"0")}`);
  if (isNaN(d.getTime())) return "";
  return ["일","월","화","수","목","금","토"][d.getDay()];
}

const WORK_HOURS_PER_DAY = 9; // 1일 = 9시간 (09:00~18:00, 휴식 포함)

function calcDurationDays(
  sYr: string, sMo: string, sDy: string, sHr: string, sMi: string,
  eYr: string, eMo: string, eDy: string, eHr: string, eMi: string,
): string {
  if (!sYr || !sMo || !sDy || !eYr || !eMo || !eDy) return "";
  const pad = (v: string) => v.padStart(2, "0");
  const sDateStr = `20${pad(sYr)}-${pad(sMo)}-${pad(sDy)}`;
  const eDateStr = `20${pad(eYr)}-${pad(eMo)}-${pad(eDy)}`;

  if (sHr && sMi && eHr && eMi) {
    // 시분 입력 시: 시간 차이 ÷ 9h, 0.5일 단위로 반올림
    // 예) 9h → 1.0일 / 4h → 0.5일
    const sMs = new Date(`${sDateStr}T${pad(sHr)}:${pad(sMi)}`).getTime();
    const eMs = new Date(`${eDateStr}T${pad(eHr)}:${pad(eMi)}`).getTime();
    if (isNaN(sMs) || isNaN(eMs) || eMs < sMs) return "";
    const diffHours = (eMs - sMs) / (1000 * 60 * 60);
    const days = Math.round((diffHours / WORK_HOURS_PER_DAY) * 2) / 2; // 0.5 단위
    return days % 1 === 0 ? String(days) : days.toFixed(1);
  }

  // 날짜만 입력 시: 달력 일수 (종료일 포함)
  const sMs = new Date(sDateStr).getTime();
  const eMs = new Date(eDateStr).getTime();
  if (isNaN(sMs) || isNaN(eMs) || eMs < sMs) return "";
  return String(Math.round((eMs - sMs) / (1000 * 60 * 60 * 24)) + 1);
}

// ── 승인자 검색 인풋 ──────────────────────────────────────────
function AccountSearchInput({ accountId, onSelect, accounts, placeholder, style, className }: {
  accountId: number | null;
  onSelect: (id: number | null) => void;
  accounts: Account[];
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [dropRect, setDropRect] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const acc = accounts.find(a => a.id === accountId);
    setText(acc?.username ?? "");
  }, [accountId, accounts]);

  const suggestions = useMemo(() => {
    const q = text.trim();
    if (!q) return accounts.slice(0, 15);
    return accounts.filter(a => a.username.includes(q) || (a.dept ?? "").includes(q)).slice(0, 15);
  }, [text, accounts]);

  function pick(a: Account) { onSelect(a.id); setText(a.username); setOpen(false); }
  function updatePos() {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setDropRect({ top: r.bottom + 2, left: r.left });
    }
  }
  function handleBlur() {
    setTimeout(() => {
      const q = text.trim();
      if (!q) { onSelect(null); setOpen(false); return; }
      const exact = accounts.find(a => a.username === q);
      if (exact) { onSelect(exact.id); }
      else {
        const prev = accountId ? (accounts.find(a => a.id === accountId)?.username ?? "") : "";
        setText(prev);
        if (!prev) onSelect(null);
      }
      setOpen(false);
    }, 150);
  }

  return (
    <>
      <input ref={ref} value={text}
        onChange={e => { setText(e.target.value); if (!e.target.value) onSelect(null); }}
        onFocus={() => { updatePos(); setOpen(true); }}
        onBlur={handleBlur}
        onKeyDown={e => { if (e.key === "Enter" && suggestions.length === 1) { e.preventDefault(); pick(suggestions[0]); } }}
        placeholder={placeholder} style={style} className={className}
      />
      {open && dropRect && typeof document !== "undefined" && createPortal(
        <div style={{ position:"fixed", top:dropRect.top, left:dropRect.left, minWidth:200, zIndex:9999, background:"white", color:"#111", border:"1px solid #bbb", borderRadius:4, boxShadow:"0 6px 18px rgba(0,0,0,0.15)", maxHeight:220, overflowY:"auto", fontSize:"9pt", fontFamily:"'Malgun Gothic','맑은 고딕',sans-serif" }}>
          {suggestions.length === 0
            ? <div style={{ padding:"6px 10px", color:"#999" }}>검색 결과 없음</div>
            : suggestions.map(a => (
              <div key={a.id}
                onMouseDown={e => { e.preventDefault(); pick(a); }}
                style={{ padding:"5px 10px", cursor:"pointer", borderBottom:"1px solid #f0f0f0" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#eff6ff")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}>
                {a.username}
                {a.dept ? <span style={{ color:"#888", marginLeft:4 }}>({a.dept})</span> : null}
              </div>
            ))}
        </div>, document.body
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, [string, string]> = {
    draft: ["작성중","bg-gray-100 text-gray-600"],
    pending: ["승인 요청","bg-blue-100 text-blue-700"],
    approved: ["승인완료","bg-green-100 text-green-700"],
    rejected: ["반려","bg-red-100 text-red-600"],
  };
  const [label, cls] = m[status] ?? [status, "bg-gray-100 text-gray-500"];
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>;
}

// ── 공통 스타일 ──
const bdr = "1px solid #444";
const iPart: React.CSSProperties = { border:"none", borderBottom:"1px solid #444", background:"transparent", fontSize:"10pt", textAlign:"center", outline:"none", fontFamily:"inherit" };
const iLine: React.CSSProperties = { border:"none", borderBottom:"1px solid #444", background:"transparent", fontSize:"10pt", outline:"none", fontFamily:"inherit", width:"100%" };

export default function LeaveRequestClient() {
  const { user } = useAuth();
  const canCreate = user ? (isAdmin(user) || hasMenuPermission(user, LR_MENU_HREF, "create")) : false;
  const isManager = user ? (isAdmin(user) || hasMenuPermission(user, LR_MENU_HREF, "update")) : false;

  const [accounts, setAccounts]   = useState<Account[]>([]);
  const [records, setRecords]     = useState<LeaveRequest[]>([]);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [form, setForm]           = useState<FormState>(makeEmptyForm());
  const [saving, setSaving]       = useState(false);
  const [printPending, setPrintPending] = useState(false);
  const [rejectModal, setRejectModal]   = useState<{ id: number; no: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [signModal, setSignModal]       = useState<LeaveRequest | null>(null);
  const signCanvasRef = useRef<HTMLCanvasElement>(null);
  const signIsDrawing = useRef(false);
  const [listQuery, setListQuery] = useState("");

  const f  = form;
  const sf = (p: Partial<FormState>) => setForm(prev => ({ ...prev, ...p }));

  const load = useCallback(async () => {
    if (!user) return;
    let q = supabase.from("leave_requests").select("*").order("created_at", { ascending: false });
    // 관리자: 전체 / 일반 사용자: 본인이 작성자이거나 승인자인 문서
    if (!isManager) q = q.or(`author_id.eq.${user.id},approver_id.eq.${user.id}`);
    const { data } = await q;
    setRecords((data as LeaveRequest[] | null) ?? []);
  }, [user, isManager]);

  useEffect(() => {
    supabase.from("accounts").select("id,username,dept,team,status,signature_url").order("username")
      .then(({ data }) => setAccounts((data as Account[] | null) ?? []));
  }, []);
  useEffect(() => { load(); }, [load]);
  useReloadOnActivate(load);

  // 탭이 비활성화될 때 서명 모달을 닫아 다른 탭의 승인 동작과 혼선 방지
  const isTabActive = useTabIsActive();
  useEffect(() => {
    if (!isTabActive) { setSignModal(null); setRejectModal(null); }
  }, [isTabActive]);

  const activeAccounts = useMemo(() => accounts.filter(a => a.status !== "퇴직"), [accounts]);
  const approverAcc    = accounts.find(a => a.id === f.approver_id);
  const authorAcc      = accounts.find(a => a.id === user?.id);
  const editingRecord  = records.find(r => r.id === editingId);
  const isApproved     = editingRecord?.approval_status === "approved";
  const approvedAtStr  = isApproved && editingRecord?.approved_at
    ? new Date(editingRecord.approved_at).toLocaleDateString("ko-KR", { month:"2-digit", day:"2-digit" }).replace(". ","\/").replace(".","")
    : null;

  useEffect(() => {
    if (!printPending || editingId === null) return;
    const t = setTimeout(() => { window.print(); setPrintPending(false); }, 350);
    return () => clearTimeout(t);
  }, [printPending, editingId]);

  function openNew() {
    const hjhAccount = accounts.find(a => a.username === "황진한");
    setForm({ ...makeEmptyForm(), approver_id: hjhAccount?.id ?? null });
    setEditingId("new");
  }
  function openEdit(r: LeaveRequest, andPrint = false) {
    setForm(recordToForm(r));
    setEditingId(r.id);
    if (andPrint) setPrintPending(true);
  }

  async function save(submitForApproval: boolean) {
    if (!user) return;
    if (!f.s_yr || !f.s_mo || !f.s_dy) { alert("시작 날짜를 입력해주세요."); return; }
    if (submitForApproval && !f.approver_id) { alert("승인자를 지정해주세요."); return; }
    setSaving(true);
    try {
      const payload = {
        author_id: user.id,
        leave_type: f.leave_type,
        s_yr: f.s_yr, s_mo: f.s_mo, s_dy: f.s_dy, s_hr: f.s_hr, s_mi: f.s_mi,
        e_yr: f.e_yr, e_mo: f.e_mo, e_dy: f.e_dy, e_hr: f.e_hr, e_mi: f.e_mi,
        duration_days: f.duration_days ? parseFloat(f.duration_days) : null,
        reason: f.reason.trim() || null,
        sub_yr: f.sub_yr, sub_mo: f.sub_mo, sub_dy: f.sub_dy,
        approver_id: f.approver_id,
        approval_status: submitForApproval ? "pending" : "draft",
        submitted_at: submitForApproval ? new Date().toISOString() : null,
      };
      if (editingId === "new") {
        const yy = new Date().toISOString().slice(2, 4);
        const { count, error: ce } = await supabase
          .from("leave_requests")
          .select("*", { count: "exact", head: true })
          .like("request_no", `LR-${yy}-%`);
        if (ce) throw new Error("문서번호 채번 실패: " + ce.message);
        const no = `LR-${yy}-${String((count ?? 0) + 1).padStart(3, "0")}`;
        const { error: ie } = await supabase.from("leave_requests").insert({ ...payload, request_no: no });
        if (ie) throw ie;
        if (submitForApproval && f.approver_id) {
          const { data: newRec } = await supabase.from("leave_requests").select("id").eq("request_no", no).maybeSingle();
          notifyLeaveApprovalRequest({ approverId: f.approver_id, authorName: authorAcc?.username ?? user.name, requestNo: no, requestId: (newRec as {id:number}|null)?.id ?? 0, leaveType: f.leave_type }).catch(console.warn);
        }
      } else {
        const { error } = await supabase.from("leave_requests").update(payload).eq("id", editingId!);
        if (error) throw error;
        const rec = records.find(r => r.id === editingId);
        if (submitForApproval && f.approver_id && rec)
          notifyLeaveApprovalRequest({ approverId: f.approver_id, authorName: authorAcc?.username ?? user.name, requestNo: rec.request_no, requestId: rec.id, leaveType: f.leave_type }).catch(console.warn);
      }
      await load(); setEditingId(null);
    } catch (e: unknown) { alert("저장 실패: " + (e instanceof Error ? e.message : String(e))); }
    finally { setSaving(false); }
  }

  async function deleteRecord(id: number, no: string) {
    if (!confirm(`${no} 문서를 삭제하시겠습니까?`)) return;
    const { error } = await supabase.from("leave_requests").delete().eq("id", id);
    if (error) { alert("삭제 실패: " + error.message); return; }
    load();
  }

  // ── 서명 ──
  useEffect(() => {
    if (!signModal || !signCanvasRef.current) return;
    const ctx = signCanvasRef.current.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, signCanvasRef.current.width, signCanvasRef.current.height);
  }, [signModal]);

  function signGetPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
    if ("touches" in e) return { x: (e.touches[0].clientX - rect.left) * sx, y: (e.touches[0].clientY - rect.top) * sy };
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }
  function signStart(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault(); signIsDrawing.current = true;
    const canvas = signCanvasRef.current!;
    const { x, y } = signGetPos(e, canvas);
    canvas.getContext("2d")!.beginPath(); canvas.getContext("2d")!.moveTo(x, y);
  }
  function signMove(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!signIsDrawing.current || !signCanvasRef.current) return;
    const canvas = signCanvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const { x, y } = signGetPos(e, canvas);
    ctx.lineTo(x, y); ctx.strokeStyle = "#111"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();
  }
  function signEnd() { signIsDrawing.current = false; }
  function signClear() {
    if (!signCanvasRef.current) return;
    signCanvasRef.current.getContext("2d")!.clearRect(0, 0, signCanvasRef.current.width, signCanvasRef.current.height);
  }

  async function approveWithSig(sig: string) {
    if (!signModal || !user) return;
    const target = signModal;
    const { error } = await supabase.from("leave_requests")
      .update({ approval_status:"approved", approved_at: new Date().toISOString(), approver_signature: sig })
      .eq("id", target.id);
    if (error) { alert("오류: " + error.message); return; }
    notifyLeaveApproved({ authorId: target.author_id, approverName: authorAcc?.username ?? user.name, requestNo: target.request_no, requestId: target.id }).catch(console.warn);
    setSignModal(null); await load();
    if (editingId === target.id) setForm(prev => ({ ...prev }));
  }
  function confirmApprove() {
    if (!signCanvasRef.current) return;
    void approveWithSig(signCanvasRef.current.toDataURL("image/png"));
  }
  function approveWithRegistered() {
    const mySig = accounts.find(a => a.id === user?.id)?.signature_url;
    if (!mySig) return;
    void approveWithSig(mySig);
  }
  async function rejectRecord() {
    if (!rejectModal || !user) return;
    if (!rejectReason.trim()) { alert("반려 사유를 입력해주세요."); return; }
    const { error } = await supabase.from("leave_requests").update({ approval_status:"rejected", rejected_at: new Date().toISOString(), reject_reason: rejectReason.trim() }).eq("id", rejectModal.id);
    if (error) { alert("오류: " + error.message); return; }
    const rec = records.find(r => r.id === rejectModal.id);
    if (rec) notifyLeaveRejected({ authorId: rec.author_id, approverName: authorAcc?.username ?? user.name, requestNo: rec.request_no, requestId: rec.id, reason: rejectReason.trim() }).catch(console.warn);
    setRejectModal(null); setRejectReason(""); await load();
  }

  const canEdit   = (r: LeaveRequest) => !!user && (
    (r.author_id === user.id && r.approval_status !== "approved") ||
    (isAdmin(user) && r.approval_status === "approved")
  );
  const canDelete = (r: LeaveRequest) => !!user && (
    (r.author_id === user.id && r.approval_status !== "approved") ||
    (isAdmin(user) && r.approval_status === "approved")
  );
  const canApprove = (r: LeaveRequest) => !!user && r.approver_id === user.id && r.approval_status === "pending";

  // 기간 자동 계산
  useEffect(() => {
    const calc = calcDurationDays(f.s_yr, f.s_mo, f.s_dy, f.s_hr, f.s_mi, f.e_yr, f.e_mo, f.e_dy, f.e_hr, f.e_mi);
    sf({ duration_days: calc });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.s_yr, f.s_mo, f.s_dy, f.s_hr, f.s_mi, f.e_yr, f.e_mo, f.e_dy, f.e_hr, f.e_mi]);

  const sDow = dowKr(f.s_yr, f.s_mo, f.s_dy);
  const eDow = dowKr(f.e_yr, f.e_mo, f.e_dy);

  const filtered = records.filter(r => {
    if (!listQuery.trim()) return true;
    const q = listQuery.trim();
    const author = accounts.find(a => a.id === r.author_id);
    return r.request_no.includes(q) || r.leave_type.includes(q) || (r.reason ?? "").includes(q) || (author?.username ?? "").includes(q);
  });

  // 결재란 승인자 열 위치 (담당=0, 팀장=1, 임원=2, 대표1=3, 대표2=4)
  const sigCol = approverAcc?.username === "황진한" ? 0 : 1;

  return (
    <div className="flex flex-col h-full bg-gray-300 dark:bg-gray-900 text-sm print:block print:bg-white print:h-auto">
      {/* ── 인쇄 CSS ── */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: A4 portrait; margin: 0; }
          .lr-print-hide { display: none !important; }
          #lr-scroll-wrap { overflow: visible !important; height: auto !important; background: white !important; }
          #lr-scroll-wrap > div { overflow: visible !important; min-width: 0 !important; }
          #lr-scroll-wrap > div > div { padding: 0 !important; }
          #lr-print-doc {
            box-shadow: none !important; width: 210mm !important;
            min-height: 0 !important; margin: 0 auto !important;
            color: black !important; background: white !important;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          #lr-print-doc * {
            color: black !important; background: transparent !important;
            -webkit-text-fill-color: black !important;
          }
          #lr-print-doc input, #lr-print-doc select, #lr-print-doc textarea {
            border: none !important; border-bottom: 1px solid #444 !important;
            outline: none !important; box-shadow: none !important;
          }
          #lr-print-doc input::placeholder, #lr-print-doc textarea::placeholder {
            color: transparent !important; -webkit-text-fill-color: transparent !important;
          }
          #lr-print-doc th, #lr-print-doc td[data-label="true"] {
            background-color: #f0f0f0 !important;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          #lr-print-doc input[type="checkbox"] { width: 3.5mm !important; height: 3.5mm !important; }
        }
      ` }} />

      {/* ── 상단 툴바 ── */}
      <div className="lr-print-hide flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h1 className="text-sm font-bold text-gray-800 dark:text-gray-100">년차계</h1>
        <div className="flex gap-2">
          {editingId !== null ? (
            <>
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
              <button onClick={() => setEditingId(null)}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">
                목록으로
              </button>
            </>
          ) : canCreate && (
            <button onClick={openNew}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium">
              + 새 문서
            </button>
          )}
        </div>
      </div>

      <div id="lr-scroll-wrap" className="flex-1 overflow-auto">

        {/* ════════════════════════════
            문서 뷰 (A4)
        ════════════════════════════ */}
        {editingId !== null && (
          <>
            {/* 보조 바 */}
            <div className="lr-print-hide sticky top-0 z-10 flex flex-wrap items-center gap-3 px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800 text-xs">
              <span className="text-gray-500 font-medium whitespace-nowrap">승인자</span>
              <AccountSearchInput
                accountId={f.approver_id}
                onSelect={id => sf({ approver_id: id })}
                accounts={activeAccounts}
                placeholder="— 승인자 검색 —"
                className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-400 w-40"
              />
            </div>

            {/* A4 문서 */}
            <div className="overflow-x-auto">
            <div className="flex justify-center py-8 print:py-0" style={{ minWidth: "210mm" }}>
              <div id="lr-print-doc" style={{
                width: "210mm", minHeight: "297mm",
                padding: "18mm 20mm",
                background: "white", color: "#111",
                fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif",
                fontSize: "10pt",
                display: "flex", flexDirection: "column",
                boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
              }}>
                {/* ── 외곽 테두리 박스 ── */}
                <div style={{ border: "2px solid #333", flex:1, padding:"12mm 14mm", display:"flex", flexDirection:"column" }}>

                  {/* ── 제목 + 결재란 ── */}
                  <div style={{ display:"flex", alignItems:"flex-start", marginBottom:"12mm" }}>
                    {/* 제목 */}
                    <div style={{ flex:1, display:"flex", alignItems:"center" }}>
                      <div style={{ fontSize:"40pt", fontWeight:900, letterSpacing:"4px", lineHeight:1 }}>
                        <span>(</span>
                        <span style={{ display:"inline-block", minWidth:"80px", textAlign:"center" }}>{f.leave_type}</span>
                        <span>)계</span>
                      </div>
                    </div>

                    {/* 결재란 */}
                    <table style={{ borderCollapse:"collapse", border: bdr }}>
                      <tbody>
                        {/* 헤더 행: [결재(rowspan3)] [담당][팀장][임원][대표][대표] */}
                        <tr>
                          <td rowSpan={3} style={{ border: bdr, width:"6mm", fontSize:"9pt", fontWeight:"bold", background:"#f0f0f0", textAlign:"center", verticalAlign:"middle", writingMode:"vertical-rl", letterSpacing:"2px", padding:0 }}>결재</td>
                          {["담당","팀장","임원","대표","대표"].map((lbl,i) => (
                            <th key={i} style={{ border: bdr, width:"14mm", height:"7mm", textAlign:"center", fontSize:"8pt", fontWeight:"bold", background:"#f0f0f0", padding:0 }}>{lbl}</th>
                          ))}
                        </tr>
                        {/* 서명 행 */}
                        <tr>
                          {[0,1,2,3,4].map(i => (
                            <td key={i} style={{ border: bdr, width:"14mm", height:"18mm", textAlign:"center", verticalAlign:"middle", padding:"1mm" }}>
                              {i === sigCol && isApproved && editingRecord?.approver_signature && (
                                <img src={editingRecord.approver_signature} alt="서명" style={{ maxWidth:"100%", maxHeight:"15mm", objectFit:"contain" }} />
                              )}
                            </td>
                          ))}
                        </tr>
                        {/* 날짜 행 */}
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

                  {/* ── 성명 ── */}
                  <div style={{ marginBottom:"8mm", fontSize:"11pt" }}>
                    <span style={{ fontWeight:"bold", marginRight:"6mm" }}>성 명 :</span>
                    <span style={{ borderBottom:"1px solid #444", display:"inline-block", minWidth:"16mm", fontSize:"11pt", paddingBottom:"1mm" }}>
                      {authorAcc?.username ?? user?.name ?? ""}
                    </span>
                  </div>

                  {/* ── 본문 ── */}
                  <div style={{ marginBottom:"10mm", fontSize:"10.5pt", lineHeight:1.8 }}>
                    상기 본인은 아래와 같은 사유로 인하여 (
                    <span style={{ fontWeight:"bold", margin:"0 2mm" }}>{f.leave_type}</span>
                    )계를 제출하오니 재가 바랍니다.
                  </div>

                  {/* ── 기간 박스 ── */}
                  <div style={{ border: bdr, padding:"5mm 6mm", marginBottom:"10mm", display:"flex", alignItems:"center", gap:"3mm" }}>
                    {/* ① 기 간 : 레이블 — 두 행 중앙 */}
                    <span style={{ fontWeight:"bold", fontSize:"11pt", whiteSpace:"nowrap" }}>기 간 :</span>
                    {/* ② 날짜 두 행 */}
                    <div style={{ flex:1, minWidth:0 }}>
                      {/* 시작 행 */}
                      <div style={{ display:"flex", alignItems:"center", flexWrap:"nowrap", gap:"0.8mm", fontSize:"10pt", marginBottom:"3mm" }}>
                        <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.s_yr} placeholder="YY" onFocus={e=>e.target.select()} onChange={e=>sf({ s_yr: e.target.value })} />
                        <span>년</span>
                        <input style={{ ...iPart, width:"6mm" }} maxLength={2} value={f.s_mo} placeholder="MM" onFocus={e=>e.target.select()} onChange={e=>sf({ s_mo: e.target.value })} />
                        <span>월</span>
                        <input style={{ ...iPart, width:"6mm" }} maxLength={2} value={f.s_dy} placeholder="DD" onFocus={e=>e.target.select()} onChange={e=>sf({ s_dy: e.target.value })} />
                        <span>일(</span>
                        {sDow ? <span style={{ width:"4mm", textAlign:"center", fontWeight:"bold", color:"#1d4ed8" }}>{sDow}</span>
                              : <span className="lr-print-hide" style={{ width:"4mm", textAlign:"center", color:"#aaa" }}>?</span>}
                        <span>요일)</span>
                        <input style={{ ...iPart, width:"6mm" }} maxLength={2} value={f.s_hr} placeholder="HH" onFocus={e=>e.target.select()} onChange={e=>sf({ s_hr: e.target.value })} />
                        <span>시</span>
                        <input style={{ ...iPart, width:"6mm" }} maxLength={2} value={f.s_mi} placeholder="MM" onFocus={e=>e.target.select()} onChange={e=>sf({ s_mi: e.target.value })} />
                        <span>분부터</span>
                      </div>
                      {/* 종료 행 */}
                      <div style={{ display:"flex", alignItems:"center", flexWrap:"nowrap", gap:"0.8mm", fontSize:"10pt" }}>
                        <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.e_yr} placeholder="YY" onFocus={e=>e.target.select()} onChange={e=>sf({ e_yr: e.target.value })} />
                        <span>년</span>
                        <input style={{ ...iPart, width:"6mm" }} maxLength={2} value={f.e_mo} placeholder="MM" onFocus={e=>e.target.select()} onChange={e=>sf({ e_mo: e.target.value })} />
                        <span>월</span>
                        <input style={{ ...iPart, width:"6mm" }} maxLength={2} value={f.e_dy} placeholder="DD" onFocus={e=>e.target.select()} onChange={e=>sf({ e_dy: e.target.value })} />
                        <span>일(</span>
                        {eDow ? <span style={{ width:"4mm", textAlign:"center", fontWeight:"bold", color:"#1d4ed8" }}>{eDow}</span>
                              : <span className="lr-print-hide" style={{ width:"4mm", textAlign:"center", color:"#aaa" }}>?</span>}
                        <span>요일)</span>
                        <input style={{ ...iPart, width:"6mm" }} maxLength={2} value={f.e_hr} placeholder="HH" onFocus={e=>e.target.select()} onChange={e=>sf({ e_hr: e.target.value })} />
                        <span>시</span>
                        <input style={{ ...iPart, width:"6mm" }} maxLength={2} value={f.e_mi} placeholder="MM" onFocus={e=>e.target.select()} onChange={e=>sf({ e_mi: e.target.value })} />
                        <span>분까지</span>
                      </div>
                    </div>
                    {/* ③ (일수)일간 — 두 행 중앙 */}
                    <div style={{ display:"flex", alignItems:"center", gap:"0.8mm", fontSize:"10pt", whiteSpace:"nowrap" }}>
                      <span>(</span>
                      <input style={{ ...iPart, width:"10mm", textAlign:"center", cursor:"default" }} value={f.duration_days} readOnly placeholder="자동" />
                      <span>)일간</span>
                    </div>
                  </div>

                  {/* ── 사유 ── */}
                  <div style={{ marginBottom:"8mm", paddingLeft:"10mm", display:"flex", alignItems:"center", gap:"4mm" }}>
                    <span style={{ fontSize:"11pt", fontWeight:"bold", whiteSpace:"nowrap" }}>사 유 :</span>
                    <input style={{ ...iLine }} value={f.reason} onChange={e=>sf({ reason: e.target.value })} placeholder="사유를 입력하세요" />
                  </div>

                  {/* ── 제출일 ── */}
                  <div style={{ marginBottom:"14mm", paddingLeft:"10mm" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:"2mm", fontSize:"11pt" }}>
                      <span style={{ fontWeight:"bold" }}>제출일 :</span>
                      <input style={{ ...iPart, width:"8mm" }} maxLength={2} value={f.sub_yr} placeholder="YY" onFocus={e=>e.target.select()} onChange={e=>sf({ sub_yr: e.target.value })} />
                      <span>년</span>
                      <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.sub_mo} placeholder="MM" onFocus={e=>e.target.select()} onChange={e=>sf({ sub_mo: e.target.value })} />
                      <span>월</span>
                      <input style={{ ...iPart, width:"7mm" }} maxLength={2} value={f.sub_dy} placeholder="DD" onFocus={e=>e.target.select()} onChange={e=>sf({ sub_dy: e.target.value })} />
                      <span>일</span>
                    </div>
                  </div>

                  {/* ── 작성자 + 서명 ── */}
                  <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center", marginBottom:"10mm", gap:"2mm" }}>
                    <span style={{ fontSize:"11pt", fontWeight:"bold", whiteSpace:"nowrap" }}>작성자 :</span>
                    <span style={{ borderBottom:"1px solid #444", minWidth:"36mm", fontSize:"11pt", paddingBottom:"1mm", display:"inline-block", textAlign:"center" }}>
                      {authorAcc?.username ?? user?.name ?? ""}
                    </span>
                    <div style={{ width:"14mm", height:"14mm", border: bdr, display:"flex", alignItems:"center", justifyContent:"center", position:"relative", marginLeft:"1mm" }}>
                      <span style={{ fontSize:"8pt", color:"#999" }} className="lr-print-hide">(인)</span>
                      {editingRecord?.author_signature && (
                        <img src={editingRecord.author_signature} alt="작성자 서명" style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"contain" }} />
                      )}
                    </div>
                  </div>

                  {/* ── 구분 체크박스 ── */}
                  <div style={{ flex:1 }} />
                  <div style={{ display:"flex", justifyContent:"center", gap:"6mm", flexWrap:"wrap", marginBottom:"4mm", fontSize:"10pt" }}>
                    {LEAVE_TYPES.map(t => (
                      <label key={t} style={{ display:"flex", alignItems:"center", gap:"1.5mm", cursor:"pointer", userSelect:"none" }}>
                        <input
                          type="checkbox"
                          checked={f.leave_type === t}
                          onChange={() => sf({ leave_type: t })}
                          style={{ width:"3.5mm", height:"3.5mm", accentColor:"#333", cursor:"pointer" }}
                        />
                        <span style={{ fontWeight: f.leave_type === t ? "bold" : "normal" }}>{t}</span>
                      </label>
                    ))}
                  </div>

                </div>

                {/* ── 회사명 (테두리 박스 아래) ── */}
                <div style={{ textAlign:"right", fontSize:"11pt", fontWeight:"bold", marginTop:"5mm" }}>
                  주식회사 대솔E/L
                </div>
              </div>
            </div>
            </div>
          </>
        )}

        {/* ════════════════════════════
            목록 뷰
        ════════════════════════════ */}
        {editingId === null && (
          <div className="lr-print-hide p-4 space-y-3">
            {/* 검색 */}
            <div className="flex gap-2 items-center">
              <input
                value={listQuery} onChange={e => setListQuery(e.target.value)}
                placeholder="문서번호·유형·사유·성명 검색"
                className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 w-60"
              />
            </div>

            {/* 목록 테이블 */}
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    <th className="px-3 py-2 text-left font-medium">문서번호</th>
                    <th className="px-3 py-2 text-left font-medium">유형</th>
                    {isManager && <th className="px-3 py-2 text-left font-medium">작성자</th>}
                    <th className="px-3 py-2 text-left font-medium">기간</th>
                    <th className="px-3 py-2 text-left font-medium">사유</th>
                    <th className="px-3 py-2 text-center font-medium">상태</th>
                    <th className="px-3 py-2 text-center font-medium">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filtered.length === 0 && (
                    <tr><td colSpan={isManager ? 7 : 6} className="text-center py-8 text-gray-400">문서가 없습니다.</td></tr>
                  )}
                  {filtered.map(r => {
                    const author = accounts.find(a => a.id === r.author_id);
                    const period = r.s_yr ? `20${r.s_yr}/${r.s_mo}/${r.s_dy}` : "—";
                    return (
                      <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                        <td className="px-3 py-2 font-mono text-blue-600 dark:text-blue-400">{r.request_no}</td>
                        <td className="px-3 py-2">{r.leave_type}</td>
                        {isManager && <td className="px-3 py-2">{author?.username ?? "—"}</td>}
                        <td className="px-3 py-2">{period}</td>
                        <td className="px-3 py-2 max-w-[120px] truncate">{r.reason ?? "—"}</td>
                        <td className="px-3 py-2 text-center"><StatusBadge status={r.approval_status} /></td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1 justify-center flex-wrap">
                            {canEdit(r) && (
                              <button onClick={() => openEdit(r)}
                                className="px-2 py-0.5 text-xs bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500 rounded">수정</button>
                            )}
                            <button onClick={() => openEdit(r, true)}
                              className="px-2 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded">인쇄</button>
                            {canApprove(r) && (
                              <button onClick={() => setSignModal(r)}
                                className="px-2 py-0.5 text-xs bg-green-100 hover:bg-green-200 text-green-700 rounded">승인</button>
                            )}
                            {isManager && r.approval_status === "pending" && r.approver_id === user?.id && (
                              <button onClick={() => { setRejectModal({ id: r.id, no: r.request_no }); setRejectReason(""); }}
                                className="px-2 py-0.5 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded">반려</button>
                            )}
                            {canDelete(r) && (
                              <button onClick={() => deleteRecord(r.id, r.request_no)}
                                className="px-2 py-0.5 text-xs text-red-500 hover:text-red-700">삭제</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── 서명 모달 ── */}
      {signModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setSignModal(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-2xl w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold mb-3 text-gray-800 dark:text-gray-100">승인 서명</h3>
            <canvas ref={signCanvasRef} width={280} height={140}
              className="border border-gray-300 rounded w-full touch-none cursor-crosshair bg-white"
              onMouseDown={signStart} onMouseMove={signMove} onMouseUp={signEnd} onMouseLeave={signEnd}
              onTouchStart={signStart} onTouchMove={signMove} onTouchEnd={signEnd}
            />
            <div className="flex gap-2 mt-3">
              <button onClick={signClear} className="flex-1 px-3 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 rounded">지우기</button>
              {accounts.find(a => a.id === user?.id)?.signature_url && (
                <button onClick={approveWithRegistered} className="flex-1 px-3 py-1.5 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 rounded">등록 서명 사용</button>
              )}
              <button onClick={confirmApprove} className="flex-1 px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded font-medium">승인 확정</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 반려 모달 ── */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setRejectModal(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-2xl w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold mb-3 text-gray-800 dark:text-gray-100">반려 사유</h3>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3}
              placeholder="반려 사유를 입력하세요"
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 resize-none" />
            <div className="flex gap-2 mt-3">
              <button onClick={() => setRejectModal(null)} className="flex-1 px-3 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 rounded">취소</button>
              <button onClick={rejectRecord} className="flex-1 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded font-medium">반려</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
