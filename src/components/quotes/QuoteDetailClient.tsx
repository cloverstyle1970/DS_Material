"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { useTabs, MAX_TABS } from "@/context/TabsContext";
import { supabase } from "@/lib/supabase";
import DraggableModal from "@/components/common/DraggableModal";
import QuotePrintPaper from "@/components/quotes/QuotePrintPaper";

// ============================================================
// 타입
// ============================================================

type Status = "작성중" | "발행" | "승인" | "취소";
type ProgressState = "미시작" | "자재신청" | "자재출고" | "세금계산서발급" | "입금완료" | "종료";
type ChargeType = "유상" | "무상";

const PROGRESS_FLOW: ProgressState[] = ["미시작", "자재신청", "자재출고", "세금계산서발급", "입금완료", "종료"];

interface QuoteHeader {
  id: number;
  quote_no: string;
  quote_date: string;
  site_name: string | null;
  elevator_name: string | null;
  work_title: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  material_subtotal: number;
  direct_labor: number;
  indirect_labor: number;
  overhead: number;
  profit: number;
  truncate_amount: number;
  total_amount: number;
  indirect_labor_rate: number;
  overhead_rate: number;
  profit_rate: number;
  note: string | null;
  status: Status;
  progress_state: ProgressState;
  charge_type: ChargeType;
  created_by_name: string | null;
  created_at: string;
}

interface QuoteRevision {
  id: number;
  revision_no: number;
  change_summary: string | null;
  changed_by_name: string | null;
  changed_at: string;
}

interface InvoiceRow {
  id: number;
  invoice_no: string;
  invoice_type: "세금계산서" | "거래명세서";
  issued_at: string;
  issued_by_name: string | null;
  status: "발행" | "취소";
  supply_amount: number;
  vat_amount: number;
  total_amount: number;
}

type PaymentMethod = "현금" | "계좌이체" | "카드" | "어음" | "기타";
interface PaymentRow {
  id: number;
  payment_no: string;
  paid_at: string;
  amount: number;
  method: PaymentMethod;
  is_prepaid: boolean;
  depositor_name: string | null;
  note: string | null;
  status: "확정" | "취소";
  created_by_name: string | null;
}

interface QuoteItem {
  id: number;
  material_id: string | null;
  material_name: string;
  spec: string | null;
  unit: string | null;
  qty: number;
  unit_price: number;
  amount: number;
  remark: string | null;
  elevator_name: string | null;
  opinion_text: string | null;
  opinion_image_url: string | null;
}

interface CompanyInfo {
  company_name: string | null;
  company_biz_no: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
  company_ceo: string | null;
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}
function fmtDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}년 ${m[2]}월 ${m[3]}일`;
}

// ============================================================

export default function QuoteDetailClient() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-sm text-gray-500">로딩 중...</div>}>
      <QuoteDetailInner />
    </Suspense>
  );
}

function QuoteDetailInner() {
  const params = useSearchParams();
  const router = useRouter();
  const idStr = params.get("id");
  const id = idStr ? Number(idStr) : NaN;
  const { user } = useAuth();
  const [header, setHeader] = useState<QuoteHeader | null>(null);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openOpinionId, setOpenOpinionId] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<QuoteRevision[]>([]);
  const [revOpen, setRevOpen] = useState(false);
  const [revLoading, setRevLoading] = useState(false);
  const [creatingMR, setCreatingMR] = useState(false);
  const [issuingInv, setIssuingInv] = useState<"세금계산서" | "거래명세서" | null>(null);
  const [invOpen, setInvOpen]       = useState(false);
  const [invoices, setInvoices]     = useState<InvoiceRow[]>([]);
  const [payments, setPayments]     = useState<PaymentRow[]>([]);
  const [payListOpen, setPayListOpen] = useState(false);
  const [payAddOpen, setPayAddOpen]   = useState(false);
  const [payForm, setPayForm] = useState<{ amount: string; method: PaymentMethod; paid_at: string; is_prepaid: boolean; depositor_name: string; note: string }>({
    amount: "", method: "계좌이체", paid_at: new Date().toISOString().slice(0, 10),
    is_prepaid: false, depositor_name: "", note: "",
  });
  const [paySaving, setPaySaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const { tabs, openTab } = useTabs();

  useEffect(() => {
    if (!Number.isFinite(id)) { setError("잘못된 견적서 ID입니다."); setLoading(false); return; }
    (async () => {
      setLoading(true);
      const [h, it, c] = await Promise.all([
        supabase.from("quotes").select("*").eq("id", id).single(),
        supabase.from("quote_items").select("*").eq("quote_id", id).order("sort_order"),
        supabase.from("quote_settings").select("company_name, company_biz_no, company_address, company_phone, company_email, company_ceo").eq("id", 1).single(),
      ]);
      if (h.error) { setError(`견적서 로드 실패: ${h.error.message}`); setLoading(false); return; }
      setHeader(h.data as QuoteHeader);
      setItems((it.data ?? []) as QuoteItem[]);
      setCompany(c.data as CompanyInfo | null);
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <div className="p-12 text-center text-sm text-gray-500">로딩 중...</div>;
  if (error || !header) return <div className="p-12 text-center text-sm text-red-500">{error || "견적서를 찾을 수 없습니다."}</div>;
  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;

  const admin = isAdmin(user);

  // 변경 직전에 quote_revisions 스냅샷 기록 (실패해도 변경은 진행)
  async function snapshot(summary: string) {
    if (!header || !user) return;
    try {
      await supabase.rpc("snapshot_quote", {
        p_quote_id:  header.id,
        p_summary:   summary,
        p_user_id:   user.id,
        p_user_name: user.name,
      });
    } catch (e) {
      console.warn("[quote] snapshot 실패 (계속 진행):", e);
    }
  }

  async function changeStatus(next: Status) {
    if (!header) return;
    await snapshot(`결재상태: ${header.status} → ${next}`);
    const { error } = await supabase.from("quotes").update({ status: next, updated_at: new Date().toISOString() }).eq("id", header.id);
    if (error) { alert(`상태 변경 실패: ${error.message}`); return; }
    setHeader({ ...header, status: next });
  }

  async function changeProgress(next: ProgressState) {
    if (!header) return;
    if (header.status !== "승인" && next !== "미시작") {
      alert("진행상태 변경은 결재 [승인] 후에만 가능합니다.");
      return;
    }
    await snapshot(`진행상태: ${header.progress_state} → ${next}`);
    const { error } = await supabase.from("quotes").update({ progress_state: next, updated_at: new Date().toISOString() }).eq("id", header.id);
    if (error) { alert(`진행상태 변경 실패: ${error.message}`); return; }
    setHeader({ ...header, progress_state: next });
  }

  async function generateInvoiceNo(type: "세금계산서" | "거래명세서"): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = type === "세금계산서" ? `TX-${year}-` : `DN-${year}-`;
    const { data } = await supabase.from("invoices")
      .select("invoice_no").like("invoice_no", `${prefix}%`)
      .order("invoice_no", { ascending: false }).limit(1);
    let nextSeq = 1;
    if (data && data.length > 0) {
      const last = (data[0] as { invoice_no: string }).invoice_no;
      const m = last.match(/-(\d+)$/);
      if (m) nextSeq = parseInt(m[1], 10) + 1;
    }
    return `${prefix}${String(nextSeq).padStart(4, "0")}`;
  }

  async function issueInvoice(type: "세금계산서" | "거래명세서") {
    if (!header || !user) return;
    if (header.charge_type === "무상") {
      alert("무상 견적은 발행 대상이 아닙니다.");
      return;
    }
    if (header.progress_state !== "자재출고" && header.progress_state !== "세금계산서발급" && header.progress_state !== "입금완료" && header.progress_state !== "종료") {
      if (!confirm(`현재 진행상태는 [${header.progress_state}] 입니다. 자재출고 이후 발행이 권장됩니다. 그래도 발행하시겠습니까?`)) return;
    }
    setIssuingInv(type);
    try {
      const invoice_no = await generateInvoiceNo(type);
      const supply = header.total_amount;
      const vat = type === "세금계산서" ? Math.round(supply / 10) : 0;
      const total = supply + vat;
      const { data: inserted, error: insErr } = await supabase.from("invoices").insert({
        invoice_no,
        quote_id:        header.id,
        invoice_type:    type,
        issued_by_id:    user.id,
        issued_by_name:  user.name,
        supply_amount:   supply,
        vat_amount:      vat,
        total_amount:    total,
        customer_name:   header.customer_name,
        site_name:       header.site_name,
        note:            null,
      }).select("id, invoice_no").single();
      if (insErr || !inserted) throw insErr || new Error("발행 실패");

      // 세금계산서 발행 시 진행상태 자동 갱신
      if (type === "세금계산서" && header.progress_state !== "세금계산서발급" && header.progress_state !== "입금완료" && header.progress_state !== "종료") {
        await snapshot(`진행상태: ${header.progress_state} → 세금계산서발급 (${invoice_no})`);
        await supabase.from("quotes")
          .update({ progress_state: "세금계산서발급", updated_at: new Date().toISOString() })
          .eq("id", header.id);
        setHeader({ ...header, progress_state: "세금계산서발급" });
      }

      // 인쇄 페이지 새 탭 오픈
      const href = type === "세금계산서"
        ? `/invoice/tax?id=${inserted.id}`
        : `/invoice/delivery?id=${inserted.id}`;
      const label = `${type} ${invoice_no}`;
      const alreadyOpen = tabs.some(t => t.href === href);
      if (!alreadyOpen && tabs.length >= MAX_TABS) {
        alert(`발행은 완료됐지만 탭 한도 초과로 인쇄 페이지를 열 수 없습니다. (${invoice_no})`);
        return;
      }
      openTab(href, label);
      // 이력 즉시 갱신
      void loadInvoices();
    } catch (e) {
      alert(`발행 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIssuingInv(null);
    }
  }

  async function loadPayments() {
    if (!header) return;
    const { data } = await supabase.from("payments")
      .select("id, payment_no, paid_at, amount, method, is_prepaid, depositor_name, note, status, created_by_name")
      .eq("quote_id", header.id)
      .order("paid_at", { ascending: false })
      .order("id", { ascending: false });
    setPayments((data ?? []) as PaymentRow[]);
  }

  async function openPayList() {
    setPayListOpen(true);
    await loadPayments();
  }

  function openPayAdd() {
    setPayForm({
      amount: "", method: "계좌이체",
      paid_at: new Date().toISOString().slice(0, 10),
      is_prepaid: !!(header && header.progress_state !== "자재출고" && header.progress_state !== "세금계산서발급" && header.progress_state !== "입금완료" && header.progress_state !== "종료"),
      depositor_name: header?.customer_name ?? "",
      note: "",
    });
    setPayAddOpen(true);
  }

  async function generatePaymentNo(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `PAY-${year}-`;
    const { data } = await supabase.from("payments")
      .select("payment_no").like("payment_no", `${prefix}%`)
      .order("payment_no", { ascending: false }).limit(1);
    let nextSeq = 1;
    if (data && data.length > 0) {
      const last = (data[0] as { payment_no: string }).payment_no;
      const m = last.match(/-(\d+)$/);
      if (m) nextSeq = parseInt(m[1], 10) + 1;
    }
    return `${prefix}${String(nextSeq).padStart(4, "0")}`;
  }

  async function savePayment() {
    if (!header || !user) return;
    const amt = Number(payForm.amount.replace(/[^0-9-]/g, ""));
    if (!Number.isFinite(amt) || amt <= 0) { alert("금액을 입력하세요."); return; }
    if (!payForm.paid_at) { alert("입금일을 입력하세요."); return; }
    setPaySaving(true);
    try {
      const payment_no = await generatePaymentNo();
      const { error } = await supabase.from("payments").insert({
        payment_no,
        quote_id:        header.id,
        paid_at:         payForm.paid_at,
        amount:          amt,
        method:          payForm.method,
        is_prepaid:      payForm.is_prepaid,
        depositor_name:  payForm.depositor_name || null,
        note:            payForm.note || null,
        created_by_id:   user.id,
        created_by_name: user.name,
      });
      if (error) throw error;
      await loadPayments();

      // 누적 입금 ≥ total_amount → 진행상태 '입금완료' 자동 전이
      const sumPaid = (payments.reduce((s, p) => s + (p.status === "확정" ? p.amount : 0), 0)) + amt;
      if (sumPaid >= header.total_amount && header.progress_state !== "입금완료" && header.progress_state !== "종료") {
        await snapshot(`진행상태: ${header.progress_state} → 입금완료 (누적 ${sumPaid.toLocaleString()}원 ≥ ${header.total_amount.toLocaleString()}원)`);
        await supabase.from("quotes")
          .update({ progress_state: "입금완료", updated_at: new Date().toISOString() })
          .eq("id", header.id);
        setHeader({ ...header, progress_state: "입금완료" });
      }
      setPayAddOpen(false);
    } catch (e) {
      alert(`입금 등록 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPaySaving(false);
    }
  }

  async function finalizeQuote() {
    if (!header) return;
    if (header.progress_state !== "입금완료") {
      if (!confirm(`현재 진행상태는 [${header.progress_state}] 입니다. 그래도 종료 처리하시겠습니까?`)) return;
    } else {
      if (!confirm("견적을 [종료] 처리하시겠습니까? (완료된 거래로 마감됨)")) return;
    }
    setFinalizing(true);
    try {
      await snapshot(`진행상태: ${header.progress_state} → 종료`);
      const { error } = await supabase.from("quotes")
        .update({ progress_state: "종료", updated_at: new Date().toISOString() })
        .eq("id", header.id);
      if (error) throw error;
      setHeader({ ...header, progress_state: "종료" });
    } catch (e) {
      alert(`종료 처리 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFinalizing(false);
    }
  }

  async function loadInvoices() {
    if (!header) return;
    const { data } = await supabase.from("invoices")
      .select("id, invoice_no, invoice_type, issued_at, issued_by_name, status, supply_amount, vat_amount, total_amount")
      .eq("quote_id", header.id)
      .order("issued_at", { ascending: false });
    setInvoices((data ?? []) as InvoiceRow[]);
  }

  async function openInvoices() {
    setInvOpen(true);
    await loadInvoices();
  }

  function openInvoicePrint(inv: InvoiceRow) {
    const href = inv.invoice_type === "세금계산서"
      ? `/invoice/tax?id=${inv.id}`
      : `/invoice/delivery?id=${inv.id}`;
    const alreadyOpen = tabs.some(t => t.href === href);
    if (!alreadyOpen && tabs.length >= MAX_TABS) {
      alert(`탭 한도 초과 (최대 ${MAX_TABS}개)`);
      return;
    }
    openTab(href, `${inv.invoice_type} ${inv.invoice_no}`);
  }

  function goToOutbound() {
    if (!header) return;
    const href = `/claim/quote-outbound?quoteId=${header.id}`;
    const alreadyOpen = tabs.some(t => t.href === href);
    if (!alreadyOpen && tabs.length >= MAX_TABS) {
      alert(`탭은 최대 ${MAX_TABS}개까지 열 수 있습니다.`);
      return;
    }
    openTab(href, `출고관리 ${header.quote_no}`);
  }

  async function createMaterialRequest() {
    if (!header || !user) return;
    if (header.status !== "승인") { alert("결재 [승인] 후에만 자재신청을 생성할 수 있습니다."); return; }
    if (header.progress_state !== "미시작") {
      if (!confirm(`현재 진행상태가 [${header.progress_state}] 입니다. 그래도 자재신청을 추가 생성하시겠습니까?`)) return;
    }
    if (items.length === 0) { alert("자재 라인이 없습니다."); return; }

    setCreatingMR(true);
    try {
      // quote_items → material_requests.items (JSONB) 매핑
      const reqItems = items
        .filter(it => it.material_id) // 자재코드가 없는 수기 라인은 출고 처리 불가
        .map(it => ({
          materialId:   it.material_id!,
          materialName: it.material_name,
          qty:          Math.max(1, Math.round(it.qty)),
          elevatorName: it.elevator_name ?? null,
        }));
      if (reqItems.length === 0) {
        alert("자재코드가 연결된 라인이 없습니다. 견적서에서 자재를 정식 등록 후 다시 시도해 주세요.");
        return;
      }
      const { error: insErr } = await supabase.from("material_requests").insert({
        status:         "신청",
        site_name:      header.site_name,
        items:          reqItems,
        note:           `견적 ${header.quote_no} 자동 생성`,
        requester_id:   user.id,
        requester_name: user.name,
        requester_dept: user.dept ?? "",
        quote_id:       header.id,
        request_type:   "유상견적",
      });
      if (insErr) throw insErr;

      // 진행상태 → 자재신청
      await snapshot(`진행상태: ${header.progress_state} → 자재신청 (자재신청 자동 생성, ${reqItems.length}건)`);
      const { error: upErr } = await supabase.from("quotes")
        .update({ progress_state: "자재신청", updated_at: new Date().toISOString() })
        .eq("id", header.id);
      if (upErr) throw upErr;
      setHeader({ ...header, progress_state: "자재신청" });

      // 출고 관리 탭 자동 오픈
      goToOutbound();
    } catch (e) {
      alert(`자재신청 생성 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreatingMR(false);
    }
  }

  async function openRevisions() {
    if (!header) return;
    setRevOpen(true);
    setRevLoading(true);
    const { data, error } = await supabase.from("quote_revisions")
      .select("id, revision_no, change_summary, changed_by_name, changed_at")
      .eq("quote_id", header.id).order("revision_no", { ascending: false });
    setRevLoading(false);
    if (error) { alert(`수정 이력 로드 실패: ${error.message}`); return; }
    setRevisions((data ?? []) as QuoteRevision[]);
  }

  function fmtDateTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  }

  return (
    <>
      {/* 화면 전용 툴바 (인쇄 시 숨김) */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/quotes" className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400">← 목록</Link>
          <span className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400 ml-2">{header.quote_no}</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
            header.status === "발행"   ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
            : header.status === "승인" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
            : header.status === "취소" ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300"
            :                            "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
          }`}>결재: {header.status}</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
            header.charge_type === "무상" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                                          : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
          }`}>{header.charge_type}</span>

          <div className="ml-auto flex gap-2 flex-wrap">
            <button type="button" onClick={openRevisions}
              className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">📜 수정 이력</button>
            {admin && header.status === "승인" && header.progress_state === "미시작" && (
              <button type="button" onClick={createMaterialRequest} disabled={creatingMR}
                className="px-3 py-1.5 text-xs rounded bg-orange-500 text-white hover:bg-orange-600 font-semibold disabled:opacity-50">
                {creatingMR ? "생성 중..." : "📦 자재신청 생성"}
              </button>
            )}
            {admin && header.status === "승인" && header.progress_state !== "미시작" && (
              <button type="button" onClick={goToOutbound}
                className="px-3 py-1.5 text-xs rounded bg-orange-500 text-white hover:bg-orange-600 font-semibold">
                📦 출고 관리
              </button>
            )}
            {admin && header.status === "승인" && header.charge_type === "유상" && (
              <>
                <button type="button" onClick={() => issueInvoice("거래명세서")} disabled={issuingInv !== null}
                  className="px-3 py-1.5 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700 font-semibold disabled:opacity-50">
                  {issuingInv === "거래명세서" ? "발행 중..." : "📄 거래명세서 발행"}
                </button>
                <button type="button" onClick={() => issueInvoice("세금계산서")} disabled={issuingInv !== null}
                  className="px-3 py-1.5 text-xs rounded bg-purple-600 text-white hover:bg-purple-700 font-semibold disabled:opacity-50">
                  {issuingInv === "세금계산서" ? "발행 중..." : "🧾 세금계산서 발행"}
                </button>
                <button type="button" onClick={openInvoices}
                  className="px-3 py-1.5 text-xs rounded border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20">
                  📑 발행 이력
                </button>
                <button type="button" onClick={openPayAdd}
                  className="px-3 py-1.5 text-xs rounded bg-amber-500 text-white hover:bg-amber-600 font-semibold">
                  💵 입금 등록
                </button>
                <button type="button" onClick={openPayList}
                  className="px-3 py-1.5 text-xs rounded border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20">
                  💼 입금 이력
                </button>
                {(header.progress_state === "입금완료" || header.progress_state === "세금계산서발급" || header.progress_state === "자재출고") && (
                  <button type="button" onClick={finalizeQuote} disabled={finalizing}
                    className="px-3 py-1.5 text-xs rounded bg-slate-700 text-white hover:bg-slate-800 font-semibold disabled:opacity-50">
                    {finalizing ? "처리 중..." : "🏁 견적 종료"}
                  </button>
                )}
              </>
            )}
            {admin && header.status === "작성중" && (
              <>
                <button type="button"
                  onClick={() => router.push(`/quotes/edit?id=${header.id}`)}
                  className="px-3 py-1.5 text-xs rounded bg-yellow-500 text-white hover:bg-yellow-600 font-semibold">
                  ✏️ 수정
                </button>
                <button type="button" onClick={() => changeStatus("발행")}
                  className="px-3 py-1.5 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700">발행</button>
              </>
            )}
            {admin && header.status === "발행" && (
              <button type="button" onClick={() => changeStatus("승인")}
                className="px-3 py-1.5 text-xs rounded bg-green-700 text-white hover:bg-green-800">승인</button>
            )}
            {admin && header.status !== "취소" && (
              <button type="button" onClick={() => { if (confirm("취소 처리하시겠습니까?")) changeStatus("취소"); }}
                className="px-3 py-1.5 text-xs rounded bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 hover:bg-red-100">취소</button>
            )}
            <button type="button" onClick={() => window.print()}
              className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-semibold">🖨 인쇄</button>
          </div>
        </div>

        {/* 진행상태 스텝퍼 — 결재 [승인] 이후의 후속 진행 */}
        <div className="mt-3 flex items-center gap-1 overflow-x-auto">
          <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 mr-2 whitespace-nowrap">진행상태</span>
          {PROGRESS_FLOW.map((s, i) => {
            const curIdx = PROGRESS_FLOW.indexOf(header.progress_state);
            const isCurrent = s === header.progress_state;
            const isPast = i < curIdx;
            const isNext = i === curIdx + 1;
            const canClick = admin && header.status === "승인" && (isNext || isPast);
            return (
              <div key={s} className="flex items-center">
                <button
                  type="button"
                  disabled={!canClick}
                  onClick={() => {
                    if (!canClick) return;
                    if (isPast) {
                      if (!confirm(`진행상태를 [${s}] 로 되돌리시겠습니까?`)) return;
                    }
                    changeProgress(s);
                  }}
                  title={
                    !admin ? "관리자만 변경 가능"
                    : header.status !== "승인" ? "결재 [승인] 후 변경 가능"
                    : isCurrent ? "현재 단계"
                    : isNext ? `다음 단계로 진행 (${s})`
                    : isPast ? `이전 단계로 되돌리기 (${s})`
                    : "건너뛰기 불가"
                  }
                  className={`px-2.5 py-1 text-[11px] rounded font-semibold whitespace-nowrap transition-colors ${
                    isCurrent
                      ? "bg-blue-600 text-white ring-2 ring-blue-300"
                      : isPast
                      ? "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300"
                      : isNext
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300"
                      : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500 cursor-not-allowed"
                  } ${!canClick && !isCurrent ? "cursor-not-allowed opacity-70" : ""}`}
                >
                  {isPast && "✓ "}{s}
                </button>
                {i < PROGRESS_FLOW.length - 1 && (
                  <span className={`mx-0.5 text-[10px] ${i < curIdx ? "text-blue-400" : "text-gray-300 dark:text-gray-600"}`}>→</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 인쇄 영역 */}
      <div className="p-6 print:p-0 bg-gray-100 dark:bg-gray-900 print:bg-white min-h-screen">
        <QuotePrintPaper
          header={header}
          items={items}
          company={company}
          onOpenOpinion={(id) => setOpenOpinionId(Number(id))}
        />
      </div>

      {/* 입금 등록 모달 */}
      <DraggableModal
        open={payAddOpen}
        onClose={() => setPayAddOpen(false)}
        panelClassName="w-full max-w-md"
        header={(
          <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div>
              <div className="text-base font-bold text-gray-900 dark:text-white">💵 입금 등록</div>
              <div className="text-xs text-gray-500 mt-0.5">{header.quote_no} · 총액 {fmtNum(header.total_amount)}원</div>
            </div>
            <button onClick={() => setPayAddOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
        )}
      >
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">금액 <span className="text-red-500">*</span></label>
            <input type="text" inputMode="numeric" value={payForm.amount}
              onChange={e => {
                const v = e.target.value.replace(/[^0-9]/g, "");
                setPayForm(f => ({ ...f, amount: v ? Number(v).toLocaleString() : "" }));
              }}
              placeholder={`최대 ${fmtNum(header.total_amount)}원`}
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-right tabular-nums font-bold" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">방법</label>
              <select value={payForm.method}
                onChange={e => setPayForm(f => ({ ...f, method: e.target.value as PaymentMethod }))}
                className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm">
                {(["계좌이체","현금","카드","어음","기타"] as const).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">입금일</label>
              <input type="date" value={payForm.paid_at}
                onChange={e => setPayForm(f => ({ ...f, paid_at: e.target.value }))}
                className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">입금자명</label>
            <input type="text" value={payForm.depositor_name} lang="ko"
              onChange={e => setPayForm(f => ({ ...f, depositor_name: e.target.value }))}
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">비고</label>
            <input type="text" value={payForm.note} lang="ko"
              onChange={e => setPayForm(f => ({ ...f, note: e.target.value }))}
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={payForm.is_prepaid}
              onChange={e => setPayForm(f => ({ ...f, is_prepaid: e.target.checked }))}
              className="rounded" />
            <span>선입금 (출고 전 입금)</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setPayAddOpen(false)} disabled={paySaving}
              className="px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-sm">취소</button>
            <button type="button" onClick={savePayment} disabled={paySaving}
              className="px-5 py-2 rounded bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50">
              {paySaving ? "등록 중..." : "💵 입금 등록"}
            </button>
          </div>
        </div>
      </DraggableModal>

      {/* 입금 이력 모달 */}
      <DraggableModal
        open={payListOpen}
        onClose={() => setPayListOpen(false)}
        panelClassName="w-full max-w-3xl max-h-[80vh]"
        header={(() => {
          const sumPaid = payments.filter(p => p.status === "확정").reduce((s, p) => s + p.amount, 0);
          const balance = header.total_amount - sumPaid;
          return (
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <div className="text-base font-bold text-gray-900 dark:text-white">💼 입금 이력</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {header.quote_no} · 총액 {fmtNum(header.total_amount)} · 누적입금 {fmtNum(sumPaid)} ·
                  <span className={`ml-1 font-bold ${balance > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                    {balance > 0 ? `미수금 ${fmtNum(balance)}` : "완납"}
                  </span>
                </div>
              </div>
              <button onClick={() => setPayListOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
          );
        })()}
      >
        <div className="p-5 overflow-y-auto">
          {payments.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">입금 이력이 없습니다.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="border-b border-gray-200 dark:border-gray-700">
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="px-2 py-2">번호</th>
                  <th className="px-2 py-2">입금일</th>
                  <th className="px-2 py-2 text-right">금액</th>
                  <th className="px-2 py-2">방법</th>
                  <th className="px-2 py-2">입금자</th>
                  <th className="px-2 py-2">선입금</th>
                  <th className="px-2 py-2">등록자</th>
                  <th className="px-2 py-2 text-center">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {payments.map(p => (
                  <tr key={p.id} className="text-gray-700 dark:text-gray-300">
                    <td className="px-2 py-2 font-mono text-amber-600 dark:text-amber-400 font-bold">{p.payment_no}</td>
                    <td className="px-2 py-2 font-mono">{p.paid_at}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-bold">{fmtNum(p.amount)}</td>
                    <td className="px-2 py-2">{p.method}</td>
                    <td className="px-2 py-2">{p.depositor_name ?? "-"}</td>
                    <td className="px-2 py-2 text-center">{p.is_prepaid ? <span className="text-blue-500">✓</span> : "-"}</td>
                    <td className="px-2 py-2 text-gray-500">{p.created_by_name ?? "-"}</td>
                    <td className="px-2 py-2 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        p.status === "확정" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                        : "bg-gray-100 text-gray-500"
                      }`}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DraggableModal>

      {/* 발행 이력 모달 (화면 전용) */}
      <DraggableModal
        open={invOpen}
        onClose={() => setInvOpen(false)}
        panelClassName="w-full max-w-2xl max-h-[80vh]"
        header={(
          <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div>
              <div className="text-base font-bold text-gray-900 dark:text-white">발행 이력</div>
              <div className="text-xs text-gray-500 mt-0.5">{header.quote_no} · 총 {invoices.length}건</div>
            </div>
            <button onClick={() => setInvOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
        )}
      >
        <div className="p-5 overflow-y-auto">
          {invoices.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">발행 이력이 없습니다.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="border-b border-gray-200 dark:border-gray-700">
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="px-2 py-2">번호</th>
                  <th className="px-2 py-2">유형</th>
                  <th className="px-2 py-2">발행일</th>
                  <th className="px-2 py-2">발행자</th>
                  <th className="px-2 py-2 text-right">합계</th>
                  <th className="px-2 py-2 text-center">상태</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {invoices.map(inv => (
                  <tr key={inv.id} className="text-gray-700 dark:text-gray-300">
                    <td className="px-2 py-2 font-mono font-bold text-blue-600 dark:text-blue-400">{inv.invoice_no}</td>
                    <td className="px-2 py-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                        inv.invoice_type === "세금계산서"
                          ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      }`}>{inv.invoice_type}</span>
                    </td>
                    <td className="px-2 py-2 font-mono">{fmtDateTime(inv.issued_at)}</td>
                    <td className="px-2 py-2">{inv.issued_by_name ?? "-"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtNum(inv.total_amount)}</td>
                    <td className="px-2 py-2 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        inv.status === "발행"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                          : "bg-gray-100 text-gray-500"
                      }`}>{inv.status}</span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button type="button" onClick={() => openInvoicePrint(inv)}
                        className="text-[10px] px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100">
                        🖨 인쇄
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DraggableModal>

      {/* 수정 이력 모달 (화면 전용) */}
      <DraggableModal
        open={revOpen}
        onClose={() => setRevOpen(false)}
        panelClassName="w-full max-w-2xl max-h-[80vh]"
        header={(
          <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div>
              <div className="text-base font-bold text-gray-900 dark:text-white">견적서 수정 이력</div>
              <div className="text-xs text-gray-500 mt-0.5">{header.quote_no} · 총 {revisions.length}건</div>
            </div>
            <button onClick={() => setRevOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
        )}
      >
        <div className="p-5 overflow-y-auto">
          {revLoading ? (
            <div className="text-center py-8 text-sm text-gray-500">로딩 중...</div>
          ) : revisions.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">수정 이력이 없습니다.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="border-b border-gray-200 dark:border-gray-700">
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="px-2 py-2 w-12">Rev</th>
                  <th className="px-2 py-2 w-40">변경 시각</th>
                  <th className="px-2 py-2 w-24">변경자</th>
                  <th className="px-2 py-2">요약</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {revisions.map(r => (
                  <tr key={r.id} className="text-gray-700 dark:text-gray-300">
                    <td className="px-2 py-2 font-mono font-bold text-blue-600 dark:text-blue-400">#{r.revision_no}</td>
                    <td className="px-2 py-2 font-mono">{fmtDateTime(r.changed_at)}</td>
                    <td className="px-2 py-2">{r.changed_by_name ?? "-"}</td>
                    <td className="px-2 py-2">{r.change_summary ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DraggableModal>

      {/* 소견서 모달 (화면 전용) */}
      {(() => {
        const it = openOpinionId ? items.find(x => x.id === openOpinionId) : null;
        return (
          <DraggableModal
            open={!!it}
            onClose={() => setOpenOpinionId(null)}
            panelClassName="w-full max-w-xl max-h-[85vh]"
            header={it && (
              <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <div>
                  <div className="text-base font-bold text-gray-900 dark:text-white">소견서</div>
                  <div className="text-xs text-gray-500 mt-0.5">{it.material_name} {it.spec && `(${it.spec})`}</div>
                </div>
                <button onClick={() => setOpenOpinionId(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
              </div>
            )}
          >
            {it && (
              <div className="p-5 space-y-3 text-sm text-gray-700 dark:text-gray-300 overflow-y-auto">
                {it.opinion_image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.opinion_image_url} alt="소견서 이미지" className="max-w-full rounded-lg border border-gray-200 dark:border-gray-700" />
                )}
                {it.opinion_text ? (
                  <div className="whitespace-pre-wrap">{it.opinion_text}</div>
                ) : (
                  <div className="text-gray-400 text-xs">텍스트 소견 없음</div>
                )}
              </div>
            )}
          </DraggableModal>
        );
      })()}

    </>
  );
}
