"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import DraggableModal from "@/components/common/DraggableModal";

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

          <div className="ml-auto flex gap-2">
            <button type="button" onClick={openRevisions}
              className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">📜 수정 이력</button>
            {admin && header.status === "작성중" && (
              <button type="button" onClick={() => changeStatus("발행")}
                className="px-3 py-1.5 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700">발행</button>
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
        <div className="quote-paper bg-white text-black mx-auto shadow-lg print:shadow-none">

          {/* 제목 + 회사 정보 */}
          <div className="border-b-2 border-black grid grid-cols-3 items-stretch">
            <div className="text-xs px-3 py-2 border-r border-black flex items-center">
              NO. {header.quote_no}
            </div>
            <div className="text-3xl font-bold text-center py-3 tracking-[0.3em]">見&nbsp;積&nbsp;書</div>
            <div className="text-xs px-3 py-2 border-l border-black flex flex-col justify-center">
              <div className="font-bold text-sm">{company?.company_name ?? "주식회사 대솔이엘"}</div>
              <div className="font-mono mt-0.5">{company?.company_biz_no ?? ""}</div>
            </div>
          </div>

          {/* 견적 메타 + 회사 상세 */}
          <table className="w-full text-xs border-collapse">
            <tbody>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 w-24 font-semibold text-center">견적년월일</td>
                <td className="border border-black px-2 py-1.5">{fmtDate(header.quote_date)}</td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 w-24 font-semibold text-center">대표이사</td>
                <td className="border border-black px-2 py-1.5">{company?.company_ceo ?? ""} <span className="text-gray-400 ml-2">[인]</span></td>
              </tr>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">현장명</td>
                <td className="border border-black px-2 py-1.5">
                  {header.site_name ?? "-"}
                  {header.elevator_name && <span className="text-gray-600 ml-2">({header.elevator_name})</span>}
                  <span className="text-gray-500 ml-3 text-[10px]">귀중</span>
                </td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">본사</td>
                <td className="border border-black px-2 py-1.5">{company?.company_address ?? ""}</td>
              </tr>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">합계금액</td>
                <td className="border border-black px-2 py-1.5 font-bold">
                  ￦ {fmtNum(header.total_amount)} 원정
                  <div className="text-[10px] text-gray-500 mt-0.5">위 금액은 부가세 별도 금액임.</div>
                </td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">전화 / E-mail</td>
                <td className="border border-black px-2 py-1.5">
                  <div>{company?.company_phone ?? ""}</div>
                  <div className="font-mono text-[10px]">{company?.company_email ?? ""}</div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* 작업명 */}
          <div className="border border-t-0 border-black px-3 py-2 text-sm">
            <span className="text-xs text-gray-600 mr-3">작 업 명</span>
            <span className="font-bold">※ {header.work_title ?? ""}</span>
            <span className="block text-[11px] text-gray-600 mt-1">아래와 같이 見積 합니다.</span>
          </div>

          {/* 메인 테이블 */}
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-center font-bold">
                <th className="border border-black px-1 py-1.5 w-10">NO</th>
                <th className="border border-black px-2 py-1.5">품&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;목</th>
                <th className="border border-black px-2 py-1.5 w-14">단위</th>
                <th className="border border-black px-2 py-1.5 w-16">수량</th>
                <th className="border border-black px-2 py-1.5 w-24">단&nbsp;&nbsp;가</th>
                <th className="border border-black px-2 py-1.5 w-28">금&nbsp;&nbsp;액</th>
                <th className="border border-black px-2 py-1.5">비&nbsp;&nbsp;고</th>
              </tr>
            </thead>
            <tbody>
              {/* 1. 자재비 */}
              <tr>
                <td className="border border-black bg-gray-50 px-2 py-1 font-bold text-center">1</td>
                <td colSpan={6} className="border border-black bg-gray-50 px-2 py-1 font-bold">자 재 비</td>
              </tr>
              {items.length === 0 && (
                <tr><td colSpan={7} className="border border-black px-2 py-3 text-center text-gray-400">자재 라인 없음</td></tr>
              )}
              {items.map((it, idx) => (
                <tr key={it.id} className="hover:bg-yellow-50 print:hover:bg-transparent">
                  <td className="border border-black px-1 py-1 text-center">{idx + 1}</td>
                  <td className="border border-black px-2 py-1">
                    <div className="font-medium">{it.material_name}</div>
                    {it.spec && <div className="text-[10px] text-gray-600">{it.spec}</div>}
                  </td>
                  <td className="border border-black px-2 py-1 text-center">{it.unit ?? "EA"}</td>
                  <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(it.qty)}</td>
                  <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(it.unit_price)}</td>
                  <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(it.amount)}</td>
                  <td className="border border-black px-2 py-1">
                    <div className="flex items-center gap-2">
                      <span className="flex-1">{it.remark ?? ""}</span>
                      {(it.opinion_text || it.opinion_image_url) && (
                        <button type="button" onClick={() => setOpenOpinionId(it.id)}
                          className="text-[10px] text-blue-600 underline print:hidden">소견</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-bold">
                <td colSpan={5} className="border border-black px-2 py-1.5 text-right">소 계</td>
                <td className="border border-black px-2 py-1.5 text-right tabular-nums">{fmtNum(header.material_subtotal)}</td>
                <td className="border border-black px-2 py-1.5"></td>
              </tr>

              {/* 2. 인건비 */}
              <tr>
                <td className="border border-black bg-gray-50 px-2 py-1 font-bold text-center">2</td>
                <td colSpan={6} className="border border-black bg-gray-50 px-2 py-1 font-bold">인 건 비</td>
              </tr>
              <tr>
                <td className="border border-black"></td>
                <td className="border border-black px-2 py-1">직접인건비</td>
                <td className="border border-black px-2 py-1 text-center">공</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">1</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(header.direct_labor)}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(header.direct_labor)}</td>
                <td className="border border-black"></td>
              </tr>
              <tr>
                <td className="border border-black"></td>
                <td className="border border-black px-2 py-1">간접인건비 (직접인건비의 {header.indirect_labor_rate}%)</td>
                <td className="border border-black px-2 py-1 text-center">{header.indirect_labor_rate}%</td>
                <td className="border border-black"></td>
                <td className="border border-black"></td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(header.indirect_labor)}</td>
                <td className="border border-black"></td>
              </tr>
              <tr className="bg-gray-50 font-bold">
                <td colSpan={5} className="border border-black px-2 py-1.5 text-right">소 계</td>
                <td className="border border-black px-2 py-1.5 text-right tabular-nums">{fmtNum(header.direct_labor + header.indirect_labor)}</td>
                <td className="border border-black px-2 py-1.5"></td>
              </tr>

              {/* 3. 일반관리비 */}
              <tr>
                <td className="border border-black bg-gray-50 px-2 py-1 font-bold text-center">3</td>
                <td className="border border-black px-2 py-1">일반관리비 및 제경비 (1+2항)</td>
                <td className="border border-black px-2 py-1 text-center">{header.overhead_rate}%</td>
                <td className="border border-black"></td>
                <td className="border border-black"></td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(header.overhead)}</td>
                <td className="border border-black"></td>
              </tr>

              {/* 4. 이윤 */}
              <tr>
                <td className="border border-black bg-gray-50 px-2 py-1 font-bold text-center">4</td>
                <td className="border border-black px-2 py-1">이윤 (2+3항)</td>
                <td className="border border-black px-2 py-1 text-center">{header.profit_rate}%</td>
                <td className="border border-black"></td>
                <td className="border border-black"></td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(header.profit)}</td>
                <td className="border border-black"></td>
              </tr>

              {/* 5. 절사금액 */}
              <tr>
                <td className="border border-black bg-gray-50 px-2 py-1 font-bold text-center">5</td>
                <td className="border border-black px-2 py-1">절사금액</td>
                <td className="border border-black"></td>
                <td className="border border-black"></td>
                <td className="border border-black"></td>
                <td className="border border-black px-2 py-1 text-right tabular-nums text-red-600">- {fmtNum(header.truncate_amount)}</td>
                <td className="border border-black"></td>
              </tr>

              {/* 공급가액 */}
              <tr className="bg-yellow-50 print:bg-gray-100 font-bold text-base">
                <td colSpan={5} className="border border-black px-2 py-2 text-right">공 급 가 액</td>
                <td className="border border-black px-2 py-2 text-right tabular-nums">￦ {fmtNum(header.total_amount)}</td>
                <td className="border border-black"></td>
              </tr>
            </tbody>
          </table>

          {/* 특기사항 + 고객승인 */}
          <table className="w-full text-xs border-collapse mt-2">
            <tbody>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 w-28 font-semibold text-center">※ 특기사항</td>
                <td className="border border-black px-2 py-1.5 align-top" rowSpan={4} colSpan={1}>
                  <div className="whitespace-pre-wrap min-h-[60px]">{header.note ?? ""}</div>
                </td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 w-28 font-semibold text-center">&lt;고객승인&gt;</td>
                <td className="border border-black px-2 py-1.5">▣ 상기 부품 보안 작업 승인함을 확인합니다.</td>
              </tr>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">승인일</td>
                <td className="border border-black px-2 py-1.5">　　　년　　　월　　　일</td>
              </tr>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">고객명</td>
                <td className="border border-black px-2 py-1.5">{header.customer_name ?? ""} &nbsp;&nbsp; 연락처: {header.customer_phone ?? ""}</td>
              </tr>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">승인자</td>
                <td className="border border-black px-2 py-1.5">　　　　　　　　 (인)　　직위:</td>
              </tr>
            </tbody>
          </table>

          {/* 푸터 */}
          <div className="text-center text-[10px] text-gray-500 mt-3">2025년 승강기안전 국무총리상 수상기업 (주)대솔이엘</div>
        </div>
      </div>

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

      {/* 인쇄 스타일 */}
      <style jsx global>{`
        .quote-paper {
          width: 210mm;
          padding: 12mm 10mm;
          box-sizing: border-box;
        }
        @media print {
          @page { size: A4; margin: 8mm; }
          body, html { background: white !important; }
          .quote-paper { width: 100% !important; padding: 0 !important; box-shadow: none !important; }
        }
      `}</style>
    </>
  );
}
