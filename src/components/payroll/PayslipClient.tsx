"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Fragment, ChangeEvent, DragEvent } from "react";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import { parsePayrollExcel, type ParsedPayslip, type ParseResult, type PayrollCalcInfo } from "@/lib/payroll-excel";
import PayslipPrintPaper, { PayslipCard } from "@/components/payroll/PayslipPrintPaper";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

const MENU_HREF = "/payroll/payslip";

interface AccountLite {
  id: number;
  username: string;
  dept: string | null;
  rank: string | null;
}

interface PayslipItemRow {
  id: number;
  type: "earning" | "deduction";
  label: string;
  amount: number;
  sort: number;
}

interface RegisteredPayslip {
  id: number;
  period_id: number;
  account_id: number | null;
  slip_no: string | null;
  emp_name: string;
  dept: string | null;
  rank: string | null;
  birth_yymmdd: string | null;
  company_name: string | null;
  gross: number;
  deduction: number;
  net: number;
  calc_info: PayrollCalcInfo | null;
  remark: string | null;
  items: PayslipItemRow[];
}

interface MatchedRow extends ParsedPayslip {
  matchedAccountId: number | null;
  matchedCandidates: AccountLite[];
}

function matchAccount(name: string, dept: string | null, rank: string | null, accounts: AccountLite[]): AccountLite | null {
  const norm = (s: string | null) => (s ?? "").trim();
  const n = norm(name), d = norm(dept), r = norm(rank);
  // 1. 성명 + 부서 + 직급 모두 일치
  let m = accounts.find(a => a.username === n && norm(a.dept) === d && norm(a.rank) === r);
  if (m) return m;
  // 2. 성명 + 부서 일치
  m = accounts.find(a => a.username === n && norm(a.dept) === d);
  if (m) return m;
  // 3. 성명 단일 일치
  const cands = accounts.filter(a => a.username === n);
  if (cands.length === 1) return cands[0];
  return null;
}

function fmtNum(n: number): string {
  return n.toLocaleString("ko-KR");
}

export default function PayslipClient() {
  const { user } = useAuth();
  const today = new Date();
  const [year, setYear] = useState<number>(today.getFullYear());
  const [month, setMonth] = useState<number>(today.getMonth() + 1);
  const [payDate, setPayDate] = useState<string>("");

  const [accounts, setAccounts] = useState<AccountLite[]>([]);
  const [registered, setRegistered] = useState<RegisteredPayslip[]>([]);
  const [loading, setLoading] = useState(false);

  // 업로드 모달
  const [uploadOpen, setUploadOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [matched, setMatched] = useState<MatchedRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 인쇄 모달
  const [printingId, setPrintingId] = useState<number | null>(null);

  // 일괄 PDF 진행 상태
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; current_name: string } | null>(null);

  const admin = user ? isAdmin(user) : false;
  const canRead   = !!user && (admin || hasMenuPermission(user, MENU_HREF, "read"));
  const canCreate = !!user && (admin || hasMenuPermission(user, MENU_HREF, "create"));
  const canUpdate = !!user && (admin || hasMenuPermission(user, MENU_HREF, "update"));

  // 사원 목록 (전체 — 매칭용)
  const loadAccounts = useCallback(async () => {
    const { data } = await supabase
      .from("accounts")
      .select("id, username, dept, rank")
      .eq("status", "재직")
      .order("username");
    setAccounts((data ?? []) as AccountLite[]);
  }, []);

  // 귀속월 명세표 로드
  const loadPayslips = useCallback(async () => {
    setLoading(true);
    const periodRes = await supabase
      .from("payroll_periods")
      .select("id, pay_date")
      .eq("year", year)
      .eq("month", month)
      .maybeSingle();

    if (!periodRes.data) {
      setRegistered([]);
      setPayDate("");
      setLoading(false);
      return;
    }
    setPayDate(periodRes.data.pay_date ?? "");

    const psRes = await supabase
      .from("payslips")
      .select("id, period_id, account_id, slip_no, emp_name, dept, rank, birth_yymmdd, company_name, gross, deduction, net, calc_info, remark")
      .eq("period_id", periodRes.data.id)
      .order("emp_name");

    const ids = (psRes.data ?? []).map(r => r.id);
    let items: PayslipItemRow[] = [];
    if (ids.length > 0) {
      const itemRes = await supabase
        .from("payslip_items")
        .select("id, payslip_id, type, label, amount, sort")
        .in("payslip_id", ids)
        .order("sort");
      items = (itemRes.data ?? []) as (PayslipItemRow & { payslip_id: number })[];
    }
    const itemsByPs = new Map<number, PayslipItemRow[]>();
    for (const it of items as (PayslipItemRow & { payslip_id: number })[]) {
      const arr = itemsByPs.get(it.payslip_id) ?? [];
      arr.push(it);
      itemsByPs.set(it.payslip_id, arr);
    }

    const result: RegisteredPayslip[] = (psRes.data ?? []).map(r => ({
      ...(r as Omit<RegisteredPayslip, "items">),
      items: itemsByPs.get(r.id) ?? [],
    }));
    setRegistered(result);
    setLoading(false);
  }, [year, month]);

  useEffect(() => {
    if (canRead) {
      void loadAccounts();
      void loadPayslips();
    }
  }, [canRead, loadAccounts, loadPayslips]);
  useReloadOnActivate(() => {
    if (canRead) {
      void loadAccounts();
      void loadPayslips();
    }
  });

  // 파일 처리
  async function handleFile(file: File) {
    setUploadError(null);
    setParsing(true);
    setParseResult(null);
    setMatched([]);
    try {
      const result = await parsePayrollExcel(file);
      setParseResult(result);
      // 엑셀에서 귀속년월이 감지되면 UI에 자동 반영
      if (result.detectedYear && result.detectedYear !== year) setYear(result.detectedYear);
      if (result.detectedMonth && result.detectedMonth !== month) setMonth(result.detectedMonth);
      const m: MatchedRow[] = result.payslips.map(p => {
        const acc = matchAccount(p.empName, p.dept, p.rank, accounts);
        const cands = accounts.filter(a => a.username === p.empName);
        return { ...p, matchedAccountId: acc?.id ?? null, matchedCandidates: cands };
      });
      setMatched(m);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[payroll] parse failed", e);
      setUploadError(msg);
    } finally {
      setParsing(false);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleFile(file);
  }

  function onFilePick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function openUpload() {
    setParseResult(null);
    setMatched([]);
    setUploadError(null);
    setUploadOpen(true);
  }

  function closeUpload() {
    if (saving || parsing) return;
    setUploadOpen(false);
    setParseResult(null);
    setMatched([]);
    setUploadError(null);
  }

  function updateMatched(idx: number, patch: Partial<MatchedRow>) {
    setMatched(prev => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  async function handleSaveAll() {
    if (matched.length === 0) {
      alert("등록할 사원이 없습니다.");
      return;
    }
    if (matched.some(m => !m.matchedAccountId)) {
      if (!confirm(`매칭되지 않은 사원이 있습니다.\n매칭 안 된 행은 사원정보 없이 저장됩니다 (account_id NULL).\n계속하시겠습니까?`)) return;
    }
    if (!confirm(`${year}년 ${month}월 명세표 ${matched.length}건을 등록합니다.\n같은 귀속월에 기존 명세표가 있으면 모두 덮어씁니다.`)) return;

    setSaving(true);
    try {
      // 1) 귀속기간 UPSERT
      let periodId: number;
      const existing = await supabase
        .from("payroll_periods")
        .select("id")
        .eq("year", year).eq("month", month)
        .maybeSingle();
      if (existing.data) {
        periodId = existing.data.id;
        await supabase.from("payroll_periods")
          .update({ pay_date: payDate || null })
          .eq("id", periodId);
      } else {
        const ins = await supabase.from("payroll_periods")
          .insert({ year, month, pay_date: payDate || null })
          .select("id").single();
        if (ins.error || !ins.data) throw ins.error ?? new Error("귀속기간 생성 실패");
        periodId = ins.data.id;
      }

      // 2) 기존 명세표 전체 삭제 (CASCADE 로 items 도 같이 삭제)
      await supabase.from("payslips").delete().eq("period_id", periodId);

      // 3) 사원별 명세표 + items 등록
      for (const m of matched) {
        const psIns = await supabase.from("payslips").insert({
          period_id: periodId,
          account_id: m.matchedAccountId,
          slip_no: m.slipNo,
          emp_name: m.empName,
          dept: m.dept,
          rank: m.rank,
          birth_yymmdd: m.birthYymmdd,
          company_name: m.companyName,
          gross: m.gross,
          deduction: m.deduction,
          net: m.net,
          calc_info: m.calcInfo,
          remark: m.remark,
          created_by: user?.name ?? null,
        }).select("id").single();
        if (psIns.error || !psIns.data) throw psIns.error ?? new Error(`${m.empName} 등록 실패`);
        const psId = psIns.data.id;

        const itemRows = [
          ...m.earnings.map(it => ({ payslip_id: psId, type: "earning",   label: it.label, amount: it.amount, sort: it.sort })),
          ...m.deductions.map(it => ({ payslip_id: psId, type: "deduction", label: it.label, amount: it.amount, sort: it.sort })),
        ];
        if (itemRows.length > 0) {
          const itemIns = await supabase.from("payslip_items").insert(itemRows);
          if (itemIns.error) throw itemIns.error;
        }
      }

      alert(`${matched.length}건의 명세표가 등록되었습니다.`);
      closeUpload();
      await loadPayslips();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[payroll] save failed", e);
      alert(`등록 실패: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  // ─── 일괄 PDF 출력 ─────────────────────────────────────
  // 각 사원의 명세서 카드를 화면 밖에 임시 렌더링 → html2canvas로 캡처 →
  // jsPDF에 이미지로 삽입 → File System Access API로 사용자 지정 폴더에 저장.
  // 폴더 선택 미지원 환경(Firefox/Safari)은 개별 다운로드로 폴백.
  async function handleBatchPdf() {
    if (registered.length === 0) {
      alert("출력할 명세표가 없습니다.");
      return;
    }

    // 1) 폴더 선택 시도
    type DirHandle = { getFileHandle: (name: string, opts: { create: boolean }) => Promise<FileSystemFileHandle> };
    let dirHandle: DirHandle | null = null;
    const supportsDirPicker = typeof window !== "undefined" && "showDirectoryPicker" in window;
    if (supportsDirPicker) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dirHandle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      } catch {
        return; // 사용자가 취소
      }
    } else {
      if (!confirm("이 브라우저는 폴더 선택을 지원하지 않습니다.\n각 PDF가 다운로드 폴더로 개별 저장됩니다. 계속하시겠습니까?\n(Chrome/Edge 사용 시 폴더 선택 가능)")) return;
    }

    // 2) 라이브러리 동적 import — html2canvas-pro (Tailwind v4 의 oklch() 등 최신 CSS 컬러 지원)
    const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
      import("html2canvas-pro"),
      import("jspdf"),
    ]);

    // 3) 화면 밖 임시 컨테이너 — createRoot는 한 번만 만들어 재사용
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-99999px";
    container.style.top = "0";
    container.style.width = "98mm";
    container.style.background = "white";
    container.style.zIndex = "-1";
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      for (let i = 0; i < registered.length; i++) {
        const p = registered[i];
        setBatchProgress({ current: i + 1, total: registered.length, current_name: p.emp_name });

        // flushSync 로 React 렌더링을 동기적으로 DOM 에 반영 (concurrent rendering 회피)
        flushSync(() => {
          root.render(
            <PayslipCard payslip={p} year={year} month={month} payDate={payDate} no={i + 1} />
          );
        });

        // 폰트 로딩·레이아웃 안정화 대기 (특히 한글 폰트)
        await new Promise(resolve => setTimeout(resolve, 150));
        if (document.fonts?.ready) await document.fonts.ready;

        // 사이즈 안전성 검증
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          throw new Error(`${p.emp_name} 카드 렌더링 실패 (DOM 크기 0)`);
        }

        // 캡처
        const canvas = await html2canvas(container, {
          scale: 3,
          backgroundColor: "#ffffff",
          useCORS: true,
          logging: false,
        });
        if (canvas.width === 0 || canvas.height === 0) {
          throw new Error(`${p.emp_name} 캔버스 생성 실패 (캔버스 크기 0)`);
        }
        const imgData = canvas.toDataURL("image/png");
        if (!imgData.startsWith("data:image/png;base64,")) {
          throw new Error(`${p.emp_name} PNG 변환 실패`);
        }

        // A4 가로 PDF 생성 (297×210mm), 명세서를 페이지 가운데에 폭 98mm로 배치
        const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
        const cardWidth = 98;
        const cardHeight = (canvas.height * cardWidth) / canvas.width;
        const pageWidth = 297;
        const pageHeight = 210;
        const x = (pageWidth - cardWidth) / 2;
        const y = Math.max(10.5, (pageHeight - cardHeight) / 2);
        pdf.addImage(imgData, "PNG", x, y, cardWidth, cardHeight);

        // 파일명
        const filename = `${p.emp_name}_${year}년 ${String(month).padStart(2, "0")}월 급여명세서.pdf`;

        // 저장
        const blob = pdf.output("blob");
        if (dirHandle) {
          const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const writable = await (fileHandle as any).createWritable();
          await writable.write(blob);
          await writable.close();
        } else {
          // 폴더 미지원 → 개별 다운로드
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      }
      alert(`${registered.length}개 PDF 출력 완료${dirHandle ? " (선택 폴더에 저장됨)" : " (다운로드 폴더로 저장됨)"}.`);
    } catch (e) {
      console.error("[payroll] batch pdf failed", e);
      alert(`일괄 PDF 출력 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      root.unmount();
      document.body.removeChild(container);
      setBatchProgress(null);
    }
  }

  async function handleDeleteAll() {
    if (!canUpdate) return;
    if (registered.length === 0) return;
    if (!confirm(`${year}년 ${month}월 명세표 ${registered.length}건을 모두 삭제하시겠습니까?`)) return;
    const periodRes = await supabase.from("payroll_periods").select("id").eq("year", year).eq("month", month).maybeSingle();
    if (!periodRes.data) return;
    const { error } = await supabase.from("payslips").delete().eq("period_id", periodRes.data.id);
    if (error) {
      alert(`삭제 실패: ${error.message}`);
      return;
    }
    await loadPayslips();
  }

  const printingPayslip = useMemo(
    () => registered.find(p => p.id === printingId) ?? null,
    [registered, printingId],
  );

  if (!user) return <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">로그인이 필요합니다.</div>;
  if (!canRead) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 print:p-0">
      {/* 헤더 — 인쇄 시 숨김 */}
      <div className="flex items-end justify-between gap-3 flex-wrap no-print print:hidden">
        <div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white">급여명세표</h1>
          <p className="text-sm text-gray-500 dark:text-gray-300 mt-0.5">엑셀 업로드로 사원별 명세표 일괄 등록 · A4 가로 인쇄</p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">귀속년월</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={year}
                onChange={e => setYear(Number(e.target.value) || today.getFullYear())}
                className="w-20 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
              <span className="text-sm text-gray-500">년</span>
              <select
                value={month}
                onChange={e => setMonth(Number(e.target.value))}
                className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <span className="text-sm text-gray-500">월</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">지급일</label>
            <input
              type="date"
              value={payDate}
              onChange={e => setPayDate(e.target.value)}
              className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
          </div>
          {canCreate && (
            <button
              type="button"
              onClick={openUpload}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-rose-500 hover:bg-rose-600 text-white shadow-sm transition-colors"
            >
              <span>📤</span>
              <span>엑셀 업로드</span>
            </button>
          )}
          {registered.length > 0 && (
            <button
              type="button"
              onClick={handleBatchPdf}
              disabled={!!batchProgress}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-blue-500 hover:bg-blue-600 text-white shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>📄</span>
              <span>일괄 PDF 출력 ({registered.length}건)</span>
            </button>
          )}
          {canUpdate && registered.length > 0 && (
            <button
              type="button"
              onClick={handleDeleteAll}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <span>🗑</span>
              <span>당월 전체 삭제</span>
            </button>
          )}
        </div>
      </div>

      {/* 목록 */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden no-print print:hidden">
        <div className="bg-gray-50 dark:bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 flex items-center justify-between">
          <span>{year}년 {month}월 명세표</span>
          <span>총 {registered.length}명</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300">성명</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300">부서</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300">직급</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-300">지급계</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-300">공제계</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-emerald-600 dark:text-emerald-400">차인지급액</th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 w-24">인쇄</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-500 dark:text-gray-400">불러오는 중...</td></tr>
              ) : registered.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                  등록된 명세표가 없습니다. 우측 상단의 [📤 엑셀 업로드]로 추가하세요.
                </td></tr>
              ) : registered.map(p => (
                <tr key={p.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-rose-50/40 dark:hover:bg-rose-900/10">
                  <td className="px-3 py-2 text-gray-800 dark:text-gray-100 font-medium">{p.emp_name}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{p.dept ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{p.rank ?? "-"}</td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-200 font-mono">{fmtNum(p.gross)}</td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-200 font-mono">{fmtNum(p.deduction)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">{fmtNum(p.net)}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setPrintingId(p.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      🖨 인쇄
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 업로드 모달 */}
      {uploadOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 no-print">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">엑셀 업로드 → {year}년 {month}월 명세표 등록</h2>
              <button
                type="button"
                onClick={closeUpload}
                disabled={saving || parsing}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {/* 파일 선택 / 드랍 */}
              {!parseResult && (
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
                    dragOver ? "border-rose-500 bg-rose-50 dark:bg-rose-900/20" : "border-gray-300 dark:border-gray-600"
                  }`}
                >
                  <div className="text-4xl mb-2">📊</div>
                  <div className="text-sm text-gray-700 dark:text-gray-200 mb-1">
                    급여명세 엑셀 파일을 이곳에 끌어다 놓으세요
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    병합셀로 표시된 &quot;월급여 지급내역&quot; / &quot;4대보험 및 제세공과금 등&quot; 으로 컬럼 자동 분류
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                  >
                    파일 선택
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.xlsm"
                    onChange={onFilePick}
                    className="hidden"
                  />
                  {parsing && <div className="mt-3 text-sm text-rose-600">파싱 중...</div>}
                  {uploadError && (
                    <div className="mt-3 text-sm text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded p-2">
                      ⚠ {uploadError}
                    </div>
                  )}
                </div>
              )}

              {/* 파싱 결과 */}
              {parseResult && (
                <>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 text-xs flex flex-wrap gap-4">
                    <div><span className="text-gray-500">시트:</span> <span className="font-semibold">{parseResult.sheetName}</span></div>
                    {parseResult.detectedYear && parseResult.detectedMonth && (
                      <div><span className="text-gray-500">감지 귀속:</span> <span className="font-semibold text-rose-600 dark:text-rose-400">{parseResult.detectedYear}년 {parseResult.detectedMonth}월</span></div>
                    )}
                    <div><span className="text-gray-500">사원 수:</span> <span className="font-semibold">{matched.length}명</span></div>
                    <div><span className="text-gray-500">매칭 성공:</span> <span className="font-semibold text-emerald-600 dark:text-emerald-400">{matched.filter(m => m.matchedAccountId).length}명</span></div>
                    <div><span className="text-gray-500">매칭 실패:</span> <span className="font-semibold text-amber-600 dark:text-amber-400">{matched.filter(m => !m.matchedAccountId).length}명</span></div>
                    <div><span className="text-gray-500">경고 보유:</span> <span className="font-semibold text-amber-600 dark:text-amber-400">{matched.filter(m => m.warnings.length > 0).length}명</span></div>
                  </div>

                  {parseResult.warnings.length > 0 && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-300">
                      {parseResult.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                    </div>
                  )}

                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    <div className="max-h-[40vh] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium text-gray-600 dark:text-gray-300">성명</th>
                            <th className="px-2 py-1.5 text-left font-medium text-gray-600 dark:text-gray-300">부서</th>
                            <th className="px-2 py-1.5 text-left font-medium text-gray-600 dark:text-gray-300">직급</th>
                            <th className="px-2 py-1.5 text-left font-medium text-gray-600 dark:text-gray-300 w-44">매칭 사원</th>
                            <th className="px-2 py-1.5 text-right font-medium text-gray-600 dark:text-gray-300">지급계</th>
                            <th className="px-2 py-1.5 text-right font-medium text-gray-600 dark:text-gray-300">공제계</th>
                            <th className="px-2 py-1.5 text-right font-medium text-emerald-600 dark:text-emerald-400">차인지급액</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matched.map((m, idx) => (
                            <Fragment key={idx}>
                              <tr className="border-t border-gray-100 dark:border-gray-700">
                                <td className="px-2 py-1.5 font-medium text-gray-800 dark:text-gray-100">{m.empName}</td>
                                <td className="px-2 py-1.5 text-gray-600 dark:text-gray-300">{m.dept ?? "-"}</td>
                                <td className="px-2 py-1.5 text-gray-600 dark:text-gray-300">{m.rank ?? "-"}</td>
                                <td className="px-2 py-1.5">
                                  <select
                                    value={m.matchedAccountId ?? ""}
                                    onChange={e => updateMatched(idx, { matchedAccountId: e.target.value ? Number(e.target.value) : null })}
                                    className={`w-full px-1.5 py-0.5 text-xs border rounded bg-white dark:bg-gray-900 ${
                                      m.matchedAccountId
                                        ? "border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                                        : "border-amber-400 dark:border-amber-600 text-amber-700 dark:text-amber-300"
                                    }`}
                                  >
                                    <option value="">⚠ 매칭 안 됨</option>
                                    {accounts.map(a => (
                                      <option key={a.id} value={a.id}>{a.username} ({a.dept ?? "-"} / {a.rank ?? "-"})</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-2 py-1.5 text-right font-mono text-gray-700 dark:text-gray-200">{fmtNum(m.gross)}</td>
                                <td className="px-2 py-1.5 text-right font-mono text-gray-700 dark:text-gray-200">{fmtNum(m.deduction)}</td>
                                <td className="px-2 py-1.5 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">{fmtNum(m.net)}</td>
                              </tr>
                              {m.warnings.length > 0 && (
                                <tr>
                                  <td colSpan={7} className="px-2 py-1 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-xs">
                                    {m.warnings.map((w, j) => <div key={j}>⚠ {w}</div>)}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2">
              {parseResult && (
                <button
                  type="button"
                  onClick={() => { setParseResult(null); setMatched([]); }}
                  disabled={saving}
                  className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30"
                >
                  ← 다른 파일 선택
                </button>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={closeUpload}
                  disabled={saving || parsing}
                  className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30"
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={handleSaveAll}
                  disabled={saving || parsing || matched.length === 0}
                  className="px-4 py-1.5 text-sm font-medium rounded-md bg-rose-500 hover:bg-rose-600 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saving ? "등록 중..." : `${matched.length}건 일괄 등록`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 일괄 PDF 진행 모달 */}
      {batchProgress && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 no-print">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6 text-center">
            <div className="text-3xl mb-3">📄</div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-1">
              일괄 PDF 출력 중...
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              <span className="font-bold text-blue-600 dark:text-blue-400">{batchProgress.current}</span>
              {" / "}
              <span className="font-bold">{batchProgress.total}</span>
              {" — "}
              {batchProgress.current_name}
            </p>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-200"
                style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
              브라우저 탭을 닫지 마세요.
            </p>
          </div>
        </div>
      )}

      {/* 인쇄 모달 */}
      {printingPayslip && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 print:p-0 print:bg-white print:inset-auto print:static">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-[1100px] max-h-[95vh] overflow-hidden flex flex-col print:shadow-none print:rounded-none print:max-w-none print:max-h-none print:overflow-visible">
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between no-print print:hidden">
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
                급여명세표 — {printingPayslip.emp_name} ({year}년 {month}월)
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 text-sm font-medium rounded-md bg-rose-500 hover:bg-rose-600 text-white"
                >
                  🖨 인쇄
                </button>
                <button
                  type="button"
                  onClick={() => setPrintingId(null)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="overflow-auto bg-gray-100 dark:bg-gray-900 print:bg-white p-6 print:p-0">
              <PayslipPrintPaper
                year={year}
                month={month}
                payDate={payDate}
                payslip={printingPayslip}
                allPayslips={registered}
                currentIndex={registered.findIndex(p => p.id === printingPayslip.id)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
