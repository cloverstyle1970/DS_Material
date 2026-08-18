"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useReloadOnActivate, useTabIsActive } from "@/context/TabActivationContext";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { calcOvertimeResult, detectHoliday, dayOfWeekKr, OvertimeResult } from "./overtimeCalc";
import { notifyOvertimeApprovalRequest, notifyOvertimeApproved, notifyOvertimeRejected } from "./overtimeNotify";

export const OT_MENU_HREF = "/hr/overtime-report";
const WORK_REASONS = ["점검", "공사", "수리·부품교체", "상주", "조출", "기타"] as const;

interface Account { id: number; username: string; dept: string | null; team: string | null; status: string | null; signature_url: string | null; }
interface OvertimeReport {
  id: number; report_no: string; author_id: number; site_name: string;
  work_instructor: string | null; work_instructor_id: number | null;
  work_reasons: string[]; work_reason_etc: string | null; work_elevator: string | null;
  start_at: string; end_at: string; is_holiday: boolean; holiday_type: string | null;
  work_hours: number | null; holiday_hours: number | null; overtime_hours: number | null;
  workers: string[]; worker_notes: string[]; work_content: string | null; work_result: string | null; note: string | null;
  approver_id: number | null; approval_status: string; approver_signature: string | null;
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
  const ws = [...r.workers];
  const targetLen = Math.max(10, Math.ceil(ws.length / 10) * 10);
  while (ws.length < targetLen) ws.push("");
  return {
    site_name: r.site_name, work_instructor: r.work_instructor ?? "", work_instructor_id: r.work_instructor_id,
    work_reasons: r.work_reasons, work_reason_etc: r.work_reason_etc ?? "", work_elevator: r.work_elevator ?? "",
    s_yr: sp.yr, s_mo: sp.mo, s_dy: sp.dy, s_hr: sp.hr, s_mi: sp.mi,
    e_yr: ep.yr, e_mo: ep.mo, e_dy: ep.dy, e_hr: ep.hr, e_mi: ep.mi,
    is_holiday: r.is_holiday, holiday_type: r.holiday_type ?? "",
    workers: ws,
    worker_notes: (() => { const ns=[...(r.worker_notes??[])]; while(ns.length<targetLen) ns.push(""); return ns; })(),
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

/** 계정 검색 입력 — 승인자·작업지시자 공용.
 *  allowFreeText=true 이면 목록에 없는 이름도 허용(작업지시자).
 *  false 이면 blur 시 미매칭 입력을 마지막 유효값으로 되돌림(승인자). */
function AccountSearchInput({ accountId, freeText = "", onSelect, accounts, placeholder, style, className, allowFreeText = false }: {
  accountId: number | null;
  freeText?: string;
  onSelect: (id: number | null, name: string) => void;
  accounts: Account[];
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string;
  allowFreeText?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [dropRect, setDropRect] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (accountId) {
      const acc = accounts.find(a => a.id === accountId);
      setText(acc?.username ?? "");
    } else {
      setText(freeText);
    }
  }, [accountId, freeText, accounts]);

  const suggestions = useMemo(() => {
    const q = text.trim();
    if (!q) return accounts.slice(0, 15);
    return accounts.filter(a => a.username.includes(q) || (a.dept ?? "").includes(q)).slice(0, 15);
  }, [text, accounts]);

  function pick(a: Account) {
    onSelect(a.id, a.username);
    setText(a.username);
    setOpen(false);
  }

  function updatePos() {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropRect({ top: r.bottom + 2, left: r.left });
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setText(e.target.value);
    if (!e.target.value.trim()) onSelect(null, "");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && suggestions.length === 1) {
      e.preventDefault(); pick(suggestions[0]);
    }
    if (e.key === "Escape") setOpen(false);
  }

  function handleBlur() {
    setTimeout(() => {
      const q = text.trim();
      if (!q) { onSelect(null, ""); setOpen(false); return; }
      const exact = accounts.find(a => a.username === q);
      if (exact) { onSelect(exact.id, exact.username); }
      else if (allowFreeText) { onSelect(null, q); }
      else {
        // 목록에 없으면 이전 값으로 복원
        const prev = accountId ? (accounts.find(a => a.id === accountId)?.username ?? "") : "";
        setText(prev);
        if (!prev) onSelect(null, "");
      }
      setOpen(false);
    }, 150);
  }

  return (
    <>
      <input ref={inputRef} value={text}
        onChange={handleChange}
        onFocus={() => { updatePos(); setOpen(true); }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={style} className={className}
      />
      {open && dropRect && typeof document !== "undefined" && createPortal(
        <div style={{
          position: "fixed", top: dropRect.top, left: dropRect.left,
          minWidth: 200, zIndex: 9999,
          background: "white", color: "#111", border: "1px solid #bbb",
          borderRadius: 4, boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
          maxHeight: 220, overflowY: "auto",
          fontSize: "9pt", fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif",
        }}>
          {suggestions.length === 0
            ? <div style={{ padding: "6px 10px", color: "#999" }}>검색 결과 없음</div>
            : suggestions.map(a => (
              <div key={a.id}
                onMouseDown={e => { e.preventDefault(); pick(a); }}
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
  const [signModal, setSignModal]       = useState<OvertimeReport | null>(null);
  const signCanvasRef  = useRef<HTMLCanvasElement>(null);
  const signIsDrawing  = useRef(false);
  const [isMobile, setIsMobile]   = useState(false);
  const [mobileStep, setMobileStep] = useState(0);
  const [listDateFrom, setListDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [listDateTo, setListDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [listQuery, setListQuery] = useState("");

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
  const activeAccounts  = useMemo(() => accounts.filter(a => a.status !== "퇴직"), [accounts]);
  const approverAcc     = accounts.find(a => a.id === f.approver_id);
  const authorAcc       = accounts.find(a => a.id === user?.id);
  const todayStr        = new Date().toLocaleDateString("ko-KR");
  const editingReport   = myReports.find(r => r.id === editingId);
  const isApproved      = editingReport?.approval_status === "approved";
  const approvedAtStr   = isApproved && editingReport?.approved_at
    ? new Date(editingReport.approved_at).toLocaleDateString("ko-KR", { month:"2-digit", day:"2-digit" }).replace(". ", "/").replace(".", "")
    : null;

  function openNew() {
    const now = new Date();
    const { isHoliday, holidayType } = detectHoliday(now);
    const myAccount = accounts.find(a => a.id === user?.id);
    const isConstructionTeam = myAccount?.team === "공사팀";
    const hjhAccount = isConstructionTeam ? accounts.find(a => a.username === "황진한") : undefined;
    setForm({ ...makeEmptyForm(), is_holiday: isHoliday, holiday_type: holidayType,
      approver_id: hjhAccount?.id ?? null });
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

  function approve(r: OvertimeReport) {
    setSignModal(r);
  }
  useEffect(() => {
    if (!signModal || !signCanvasRef.current) return;
    const ctx = signCanvasRef.current.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, signCanvasRef.current.width, signCanvasRef.current.height);
  }, [signModal]);

  function signGetPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }
  function signStart(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    signIsDrawing.current = true;
    const canvas = signCanvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const { x, y } = signGetPos(e, canvas);
    ctx.beginPath(); ctx.moveTo(x, y);
  }
  function signMove(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!signIsDrawing.current || !signCanvasRef.current) return;
    const canvas = signCanvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const { x, y } = signGetPos(e, canvas);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#111"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.stroke();
  }
  function signEnd() { signIsDrawing.current = false; }
  function signClear() {
    if (!signCanvasRef.current) return;
    const ctx = signCanvasRef.current.getContext("2d")!;
    ctx.clearRect(0, 0, signCanvasRef.current.width, signCanvasRef.current.height);
  }
  async function approveWithSignature(sig: string) {
    if (!signModal || !user) return;
    const { error } = await supabase.from("overtime_reports")
      .update({ approval_status:"approved", approved_at: new Date().toISOString(), approver_signature: sig })
      .eq("id", signModal.id);
    if (error) { alert("오류: " + error.message); return; }
    notifyOvertimeApproved({ authorId: signModal.author_id, approverName: authorAcc?.username ?? user.name, reportNo: signModal.report_no, reportId: signModal.id }).catch(console.warn);
    setSignModal(null); await load();
  }

  function confirmApprove() {
    if (!signCanvasRef.current) return;
    void approveWithSignature(signCanvasRef.current.toDataURL("image/png"));
  }

  function approveWithRegisteredSignature() {
    const mySig = accounts.find(a => a.id === user?.id)?.signature_url;
    if (!mySig) return;
    void approveWithSignature(mySig);
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

  const canEdit   = (r: OvertimeReport) => !!user && r.author_id === user.id && r.approval_status !== "approved";
  const canDelete = (r: OvertimeReport) => !!user && r.author_id === user.id && r.approval_status !== "approved";
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
    <div className="flex flex-col h-full bg-gray-300 dark:bg-gray-900 text-sm print:block print:bg-white print:h-auto">
      {/* ── 인쇄 전용 CSS ── */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: A4 portrait; margin: 0; }
          /* AdminShell 전역 CSS가 탭 컨테이너를 이미 page flow로 풀어준다.
             position:fixed / visibility:hidden 방식 대신 자연 흐름으로 인쇄한다. */
          .ot-print-hide { display: none !important; }
          /* 스크롤 래퍼 해제 */
          #ot-scroll-wrap {
            overflow: visible !important;
            height: auto !important;
            background: white !important;
          }
          /* overflow-x-auto 래퍼 해제 */
          #ot-scroll-wrap > div {
            overflow: visible !important;
            min-width: 0 !important;
          }
          /* flex 센터 래퍼 여백 제거 */
          #ot-scroll-wrap > div > div {
            padding: 0 !important;
          }
          #ot-print-doc {
            box-shadow: none !important;
            width: 210mm !important;
            min-height: 0 !important;
            margin: 0 auto !important;
            color: black !important;
            background: white !important;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          /* 다크모드 글씨색이 흰 종이에서 안 보이는 문제 방지 */
          #ot-print-doc * {
            color: black !important;
            background: transparent !important;
            -webkit-text-fill-color: black !important;
          }
          #ot-print-doc input, #ot-print-doc select, #ot-print-doc textarea {
            border: none !important; border-bottom: none !important;
            outline: none !important; box-shadow: none !important;
          }
          #ot-print-doc input::placeholder,
          #ot-print-doc textarea::placeholder {
            color: transparent !important;
            -webkit-text-fill-color: transparent !important;
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
              <>
                <button onClick={() => save(false)} disabled={saving}
                  className="px-3 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 rounded font-medium disabled:opacity-50">
                  {saving ? "저장중…" : "임시저장"}
                </button>
                <button onClick={() => save(true)} disabled={saving}
                  className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-50">
                  {saving ? "제출중…" : "승인 요청"}
                </button>
                {!isMobile && <button onClick={() => window.print()}
                  className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-900 text-white rounded font-medium">
                  🖨️ 인쇄
                </button>}
              </>
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

      <div id="ot-scroll-wrap" className="flex-1 overflow-auto">

        {/* ════════════════════════════════
            문서 뷰
        ════════════════════════════════ */}
        {editingId !== null && (
          <>
            {/* 보조 바: 잔업 승인자 + 상태 (인쇄 시 숨김) */}
            <div className="print:hidden sticky top-0 z-10 flex flex-wrap items-center gap-3 px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800 text-xs">
              <span className="text-gray-500 whitespace-nowrap font-medium">잔업 승인자</span>
              <AccountSearchInput
                accountId={f.approver_id}
                onSelect={id => sf({ approver_id: id })}
                accounts={activeAccounts}
                placeholder="— 승인자 검색 —"
                className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-400 w-40"
              />
              {otResult && (
                <span className="font-semibold text-blue-700 dark:text-blue-300">{otResult.display}</span>
              )}
            </div>

            {/* A4 문서 */}
            <div className="overflow-x-auto">
            <div className="flex justify-center py-8 print:py-0" style={{ minWidth: "210mm" }}>
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
                      {(() => {
                        const sigCol = approverAcc?.username === "황진한" ? 0 : 1;
                        return (
                          <tr>
                            {[0,1,2,3,4].map(i => (
                              <td key={i} style={{
                                border: bdr, width:"17mm", height:"20mm",
                                textAlign:"center", verticalAlign:"middle", fontSize:"8pt", color:"#444",
                                padding:"1mm",
                              }}>
                                {i === sigCol && isApproved && editingReport?.approver_signature && (
                                  <img src={editingReport.approver_signature}
                                    alt="서명"
                                    style={{ maxWidth:"100%", maxHeight:"17mm", objectFit:"contain" }} />
                                )}
                              </td>
                            ))}
                          </tr>
                        );
                      })()}
                      {/* 날짜 라인 */}
                      {(() => {
                        const sigCol = approverAcc?.username === "황진한" ? 0 : 1;
                        return (
                          <tr>
                            {[0,1,2,3,4].map(i => (
                              <td key={i} style={{
                                border: bdr, textAlign:"center", fontSize:"9pt",
                                color:"#555", height:"6mm", padding:0,
                              }}>
                                {i === sigCol && approvedAtStr ? approvedAtStr : "/"}
                              </td>
                            ))}
                          </tr>
                        );
                      })()}
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
                        <AccountSearchInput
                          accountId={f.work_instructor_id}
                          freeText={f.work_instructor}
                          allowFreeText
                          onSelect={(id, name) => sf({ work_instructor_id: id, work_instructor: name })}
                          accounts={activeAccounts}
                          placeholder="이름 검색 또는 직접 입력"
                          style={{ ...iCell }}
                        />
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
                            <col style={{ width:"39.6mm" }} />
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
                                  {startDow
                                    ? <span style={{ width:"5mm", textAlign:"center", fontWeight:"bold", color:"#1d4ed8" }}>{startDow}</span>
                                    : <span className="ot-print-hide" style={{ width:"5mm", textAlign:"center", fontWeight:"bold", color:"#1d4ed8" }}>??</span>}
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
                                  : <span className="ot-print-hide" style={{ color:"#aaa" }}>—— HR</span>}
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
                                  {endDow
                                    ? <span style={{ width:"5mm", textAlign:"center", fontWeight:"bold", color:"#1d4ed8" }}>{endDow}</span>
                                    : <span className="ot-print-hide" style={{ width:"5mm", textAlign:"center", fontWeight:"bold", color:"#1d4ed8" }}>??</span>}
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

                    {/* 작업자명 + 비고 — 10명씩 행 반복 */}
                    {Array.from({ length: Math.ceil(f.workers.length / 10) }).map((_, rowIdx) => {
                      const start = rowIdx * 10;
                      const isLast = rowIdx === Math.ceil(f.workers.length / 10) - 1;
                      return (
                        <tr key={rowIdx} style={{ borderBottom: bdr }}>
                          <td data-label="true" style={{ ...labelCell, padding:0, verticalAlign:"top" }}>
                            <div style={{ height:"9mm", display:"flex", alignItems:"center", justifyContent:"center", borderBottom: bdr }}>작업자명</div>
                            <div style={{ height:"11.44mm", display:"flex", alignItems:"center", justifyContent:"center" }}>비 고</div>
                          </td>
                          <td colSpan={3} style={{ padding:0, verticalAlign:"top", overflow:"visible" }}>
                            <div style={{ position:"relative" }}>
                            <table style={{ width:"100%", borderCollapse:"collapse", height:"100%" }}>
                              <tbody>
                                {/* 작업자명 행 */}
                                <tr style={{ borderBottom: bdr }}>
                                  {f.workers.slice(start, start + 10).map((w, i) => (
                                    <td key={i} style={{
                                      borderLeft: i === 0 ? "none" : bdr, width:"10%", height:"9mm",
                                      textAlign:"center", verticalAlign:"middle", overflow:"visible",
                                      padding:"0.5mm 0.5mm",
                                    }}>
                                      <WorkerSearchInput
                                        value={w}
                                        placeholder={`작업자${start + i + 1}`}
                                        accounts={activeAccounts}
                                        cellStyle={{ ...iCell, textAlign:"center", padding:"0", fontSize:"8.5pt", width:"100%" }}
                                        onChange={v => {
                                          if (v && f.workers.some((existing, j) => j !== start + i && existing === v)) {
                                            alert(`'${v}'은(는) 이미 등록된 작업자입니다.`); return;
                                          }
                                          const ws=[...f.workers]; ws[start + i]=v; sf({ workers: ws });
                                        }}
                                      />
                                    </td>
                                  ))}
                                </tr>
                                {/* 비고 행 */}
                                <tr>
                                  {f.worker_notes.slice(start, start + 10).map((n, i) => (
                                    <td key={i} style={{
                                      borderLeft: i === 0 ? "none" : bdr, width:"10%", height:"11.44mm",
                                      textAlign:"center", verticalAlign:"middle",
                                      padding:"1mm 0.5mm",
                                    }}>
                                      <input
                                        style={{ ...iCell, textAlign:"center", padding:"0", fontSize:"8.5pt" }}
                                        value={n}
                                        onChange={e => { const ns=[...f.worker_notes]; ns[start + i]=e.target.value; sf({ worker_notes: ns }); }}
                                      />
                                    </td>
                                  ))}
                                </tr>
                              </tbody>
                            </table>
                            {isLast && (
                              <div
                                className="ot-print-hide"
                                style={{ position:"absolute", top:0, left:"100%", marginLeft:"2mm", display:"flex", flexDirection:"column", gap:"1mm" }}
                              >
                                <button
                                  type="button"
                                  onClick={() => sf({ workers: [...f.workers, ...Array(10).fill("")], worker_notes: [...f.worker_notes, ...Array(10).fill("")] })}
                                  style={{ height:"9mm", fontSize:"8pt", padding:"0 2mm", cursor:"pointer", border:"1px solid #aaa", borderRadius:"2px", background:"#f9f9f9", whiteSpace:"nowrap" }}
                                >
                                  + 추가
                                </button>
                                {f.workers.length > 10 && (
                                  <button
                                    type="button"
                                    onClick={() => sf({ workers: f.workers.slice(0, -10), worker_notes: f.worker_notes.slice(0, -10) })}
                                    style={{ height:"11.44mm", fontSize:"8pt", padding:"0 2mm", cursor:"pointer", border:"1px solid #f99", borderRadius:"2px", background:"#fff5f5", whiteSpace:"nowrap", color:"#c00" }}
                                  >
                                    - 삭제
                                  </button>
                                )}
                              </div>
                            )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}

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
            </div>{/* /overflow-x-auto */}

          </>
        )}

        {/* ════════════════════════════════
            목록 뷰
        ════════════════════════════════ */}
        {editingId === null && (
          <div className="p-4 max-w-3xl mx-auto">
            {/* 검색 필터 */}
            <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">기간</span>
              <input type="date" value={listDateFrom} onChange={e => setListDateFrom(e.target.value)}
                className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-400" />
              <span className="text-xs text-gray-400">~</span>
              <input type="date" value={listDateTo} onChange={e => setListDateTo(e.target.value)}
                className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-400" />
              <button onClick={() => {
                const d = new Date();
                setListDateFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
                setListDateTo(d.toISOString().slice(0, 10));
              }} className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">이번달</button>
              <button onClick={() => {
                const d = new Date();
                setListDateFrom(`${d.getFullYear()}-01-01`);
                setListDateTo(d.toISOString().slice(0, 10));
              }} className="text-xs text-gray-500 dark:text-gray-400 hover:underline whitespace-nowrap">올해</button>
              <button onClick={() => { setListDateFrom(""); setListDateTo(""); }}
                className="text-xs text-gray-400 dark:text-gray-500 hover:underline whitespace-nowrap">전체</button>
              <div className="w-px h-4 bg-gray-200 dark:bg-gray-600" />
              <input type="text" value={listQuery} onChange={e => setListQuery(e.target.value)}
                placeholder="현장명 / 작업사유 검색"
                className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400 w-44" />
              {(() => {
                const cnt = myReports.filter(r => {
                  const dt = r.start_at.slice(0, 10);
                  if (listDateFrom && dt < listDateFrom) return false;
                  if (listDateTo   && dt > listDateTo)   return false;
                  if (listQuery) {
                    const q = listQuery.toLowerCase();
                    if (!r.site_name.toLowerCase().includes(q) && !r.work_reasons.join(",").toLowerCase().includes(q)) return false;
                  }
                  return true;
                }).length;
                return <span className="text-xs text-gray-400 ml-auto">{cnt}건</span>;
              })()}
            </div>
            {myReports.length === 0 ? (
              <div className="text-center text-sm text-gray-400 py-16">등록된 잔업보고서가 없습니다.</div>
            ) : (() => {
              const filteredReports = myReports.filter(r => {
                const dt = r.start_at.slice(0, 10);
                if (listDateFrom && dt < listDateFrom) return false;
                if (listDateTo   && dt > listDateTo)   return false;
                if (listQuery) {
                  const q = listQuery.toLowerCase();
                  if (!r.site_name.toLowerCase().includes(q) && !r.work_reasons.join(",").toLowerCase().includes(q)) return false;
                }
                return true;
              });
              if (filteredReports.length === 0) return (
                <div className="text-center text-sm text-gray-400 py-16">검색 결과가 없습니다.</div>
              );
              return (
              <div className="space-y-3">
                {filteredReports.map(r => {
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
              );
            })()}
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

      {/* 서명 모달 */}
      {signModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-5 w-[340px]">
            <h3 className="text-sm font-bold mb-1">잔업보고서 승인 — 서명 입력</h3>
            <p className="text-xs text-gray-400 mb-3">{signModal.report_no} · 아래 영역에 서명해주세요</p>
            {(() => {
              const mySig = accounts.find(a => a.id === user?.id)?.signature_url;
              if (!mySig) return null;
              return (
                <button onClick={approveWithRegisteredSignature}
                  className="w-full mb-3 py-2 text-xs bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-lg border border-blue-200 dark:border-blue-700 font-semibold">
                  ✅ 등록된 서명으로 바로 승인
                </button>
              );
            })()}
            <div className="relative border-2 border-gray-300 rounded-lg overflow-hidden bg-white"
              style={{ touchAction: "none" }}>
              <canvas ref={signCanvasRef} width={600} height={220}
                style={{ width:"100%", height:"110px", display:"block", cursor:"crosshair" }}
                onMouseDown={signStart} onMouseMove={signMove} onMouseUp={signEnd} onMouseLeave={signEnd}
                onTouchStart={signStart} onTouchMove={signMove} onTouchEnd={signEnd} />
              <span className="absolute bottom-1 right-2 text-[10px] text-gray-300 pointer-events-none select-none">서명란</span>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={signClear}
                className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded border border-gray-300">
                지우기
              </button>
              <button onClick={confirmApprove}
                className="flex-1 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium">
                승인 완료
              </button>
              <button onClick={() => setSignModal(null)}
                className="px-3 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 rounded">
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
