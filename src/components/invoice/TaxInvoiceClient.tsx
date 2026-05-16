"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useInvoiceData, fmtNum, fmtDate } from "./InvoicePrintShared";

export default function TaxInvoiceClient() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-sm text-gray-500">로딩 중...</div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useSearchParams();
  const idStr = params.get("id");
  const id = idStr ? Number(idStr) : NaN;
  const { invoice, quote, items, company, loading, error } = useInvoiceData(id);

  if (loading) return <div className="p-12 text-center text-sm text-gray-500">로딩 중...</div>;
  if (error || !invoice || !quote) return <div className="p-12 text-center text-sm text-red-500">{error || "발행 정보를 찾을 수 없습니다."}</div>;

  return (
    <>
      {/* 화면 전용 툴바 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center gap-2 print:hidden">
        <Link href={`/quotes/detail?id=${quote.id}`} className="text-xs text-gray-500 hover:text-blue-600">← 견적서</Link>
        <span className="font-mono text-sm font-bold text-purple-600 dark:text-purple-400 ml-2">{invoice.invoice_no}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
          invoice.status === "발행" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
          : "bg-gray-100 text-gray-500"
        }`}>{invoice.status}</span>
        <span className="text-[10px] text-gray-400 ml-2">※ 외부 시스템(홈택스/위하고) 발급 전 사내 양식입니다.</span>
        <button type="button" onClick={() => window.print()}
          className="ml-auto px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-semibold">🖨 인쇄 / PDF로 저장</button>
      </div>

      <div className="p-6 print:p-0 bg-gray-100 dark:bg-gray-900 print:bg-white min-h-screen">
        <div className="invoice-paper bg-white text-black mx-auto shadow-lg print:shadow-none">

          {/* 제목 */}
          <div className="border-b-2 border-black grid grid-cols-3 items-stretch">
            <div className="text-xs px-3 py-2 border-r border-black flex items-center">
              NO. {invoice.invoice_no}
            </div>
            <div className="text-3xl font-bold text-center py-3 tracking-[0.3em]">稅 金 計 算 書</div>
            <div className="text-xs px-3 py-2 border-l border-black flex flex-col justify-center text-right">
              <div className="font-bold">공급자용</div>
              <div className="text-[10px] text-gray-500">사내 양식 (외부 발급 별도)</div>
            </div>
          </div>

          {/* 공급자/공급받는자 */}
          <table className="w-full text-xs border-collapse">
            <tbody>
              <tr>
                <td rowSpan={4} className="border border-black bg-blue-100 px-2 py-1.5 font-bold text-center text-blue-900 w-12">공급<br/>자</td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 w-24 font-semibold text-center">등록번호</td>
                <td className="border border-black px-2 py-1.5 font-mono" colSpan={2}>{company?.company_biz_no ?? ""}</td>
                <td rowSpan={4} className="border border-black bg-rose-100 px-2 py-1.5 font-bold text-center text-rose-900 w-12">공급<br/>받는<br/>자</td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 w-24 font-semibold text-center">등록번호</td>
                <td className="border border-black px-2 py-1.5 font-mono">{invoice.customer_biz_no ?? "-"}</td>
              </tr>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">상호</td>
                <td className="border border-black px-2 py-1.5 font-bold">{company?.company_name ?? ""}</td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 w-20 font-semibold text-center">대표자</td>
                <td className="border border-black px-2 py-1.5">{company?.company_ceo ?? ""}</td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">상호</td>
                <td className="border border-black px-2 py-1.5 font-bold">{invoice.customer_name ?? quote.customer_name ?? "-"}</td>
              </tr>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">사업장</td>
                <td className="border border-black px-2 py-1.5" colSpan={3}>{company?.company_address ?? ""}</td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">현장</td>
                <td className="border border-black px-2 py-1.5">{invoice.site_name ?? quote.site_name ?? "-"}</td>
              </tr>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">연락</td>
                <td className="border border-black px-2 py-1.5 font-mono" colSpan={3}>{company?.company_phone ?? ""} / {company?.company_email ?? ""}</td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">연락처</td>
                <td className="border border-black px-2 py-1.5 font-mono">{quote.customer_phone ?? "-"}</td>
              </tr>
            </tbody>
          </table>

          {/* 합계 */}
          <table className="w-full text-xs border-collapse mt-1">
            <tbody>
              <tr className="bg-yellow-100 font-bold">
                <td className="border border-black px-2 py-2 text-center w-24">작 성 일 자</td>
                <td className="border border-black px-2 py-2 text-center">{fmtDate(invoice.issued_at)}</td>
                <td className="border border-black px-2 py-2 text-center w-28">공 급 가 액</td>
                <td className="border border-black px-2 py-2 text-right tabular-nums">￦ {fmtNum(invoice.supply_amount)}</td>
                <td className="border border-black px-2 py-2 text-center w-24">세 액 (10%)</td>
                <td className="border border-black px-2 py-2 text-right tabular-nums">￦ {fmtNum(invoice.vat_amount)}</td>
                <td className="border border-black px-2 py-2 text-center w-24 bg-yellow-200">합 계</td>
                <td className="border border-black px-2 py-2 text-right tabular-nums bg-yellow-200">￦ {fmtNum(invoice.total_amount)}</td>
              </tr>
            </tbody>
          </table>

          {/* 라인 */}
          <table className="w-full text-xs border-collapse mt-2">
            <thead>
              <tr className="bg-gray-100 text-center font-bold">
                <th className="border border-black px-1 py-1.5 w-10">월/일</th>
                <th className="border border-black px-2 py-1.5">품 목</th>
                <th className="border border-black px-2 py-1.5">규격</th>
                <th className="border border-black px-2 py-1.5 w-14">단위</th>
                <th className="border border-black px-2 py-1.5 w-16">수량</th>
                <th className="border border-black px-2 py-1.5 w-24">단가</th>
                <th className="border border-black px-2 py-1.5 w-24">공급가액</th>
                <th className="border border-black px-2 py-1.5 w-24">세액</th>
                <th className="border border-black px-2 py-1.5">비고</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={9} className="border border-black px-2 py-3 text-center text-gray-400">자재 라인 없음</td></tr>
              )}
              {items.map((it, idx) => {
                const supply = it.amount;
                const vat = Math.round(supply / 10);
                const d = new Date(invoice.issued_at);
                return (
                  <tr key={it.id}>
                    <td className="border border-black px-1 py-1 text-center font-mono">{`${d.getMonth()+1}/${d.getDate()}`}</td>
                    <td className="border border-black px-2 py-1">{it.material_name}{idx === 0 && items.length > 1 ? "" : ""}</td>
                    <td className="border border-black px-2 py-1 text-[10px] text-gray-600">{it.spec ?? ""}</td>
                    <td className="border border-black px-2 py-1 text-center">{it.unit ?? "EA"}</td>
                    <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(it.qty)}</td>
                    <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(it.unit_price)}</td>
                    <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(supply)}</td>
                    <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(vat)}</td>
                    <td className="border border-black px-2 py-1">{it.remark ?? ""}</td>
                  </tr>
                );
              })}
              <tr className="bg-gray-50 font-bold">
                <td colSpan={6} className="border border-black px-2 py-1.5 text-right">합계</td>
                <td className="border border-black px-2 py-1.5 text-right tabular-nums">{fmtNum(invoice.supply_amount)}</td>
                <td className="border border-black px-2 py-1.5 text-right tabular-nums">{fmtNum(invoice.vat_amount)}</td>
                <td className="border border-black"></td>
              </tr>
            </tbody>
          </table>

          {/* 비고 */}
          <table className="w-full text-xs border-collapse mt-2">
            <tbody>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 w-28 font-semibold text-center">현금</td>
                <td className="border border-black px-2 py-1.5"></td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 w-28 font-semibold text-center">수표</td>
                <td className="border border-black px-2 py-1.5"></td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 w-28 font-semibold text-center">어음</td>
                <td className="border border-black px-2 py-1.5"></td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 w-28 font-semibold text-center">외상미수금</td>
                <td className="border border-black px-2 py-1.5 tabular-nums text-right">{fmtNum(invoice.total_amount)}</td>
                <td className="border border-black bg-yellow-100 px-2 py-1.5 w-20 font-semibold text-center">청구</td>
              </tr>
            </tbody>
          </table>

          <div className="text-center text-[10px] text-gray-500 mt-3">위 금액을 정히 청구합니다. (주)대솔이엘</div>
        </div>
      </div>

      <style jsx global>{`
        .invoice-paper {
          width: 210mm;
          padding: 12mm 10mm;
          box-sizing: border-box;
        }
        @media print {
          @page { size: A4; margin: 8mm; }
          body, html { background: white !important; }
          .invoice-paper { width: 100% !important; padding: 0 !important; box-shadow: none !important; }
        }
      `}</style>
    </>
  );
}
