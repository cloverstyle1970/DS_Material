"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useInvoiceData, fmtNum, fmtDate } from "./InvoicePrintShared";
import { tkPrintTextClass } from "@/lib/material-style";

export default function DeliveryNoteClient() {
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
        <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400 ml-2">{invoice.invoice_no}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
          invoice.status === "발행" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-gray-100 text-gray-500"
        }`}>{invoice.status}</span>
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
            <div className="text-3xl font-bold text-center py-3 tracking-[0.4em]">去&nbsp;來&nbsp;明&nbsp;細&nbsp;書</div>
            <div className="text-xs px-3 py-2 border-l border-black flex flex-col justify-center">
              <div className="font-bold text-sm">{company?.company_name ?? "주식회사 대솔이엘"}</div>
              <div className="font-mono mt-0.5">{company?.company_biz_no ?? ""}</div>
            </div>
          </div>

          {/* 메타 */}
          <table className="w-full text-xs border-collapse">
            <tbody>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 w-24 font-semibold text-center">발행일</td>
                <td className="border border-black px-2 py-1.5">{fmtDate(invoice.issued_at)}</td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 w-24 font-semibold text-center">대표이사</td>
                <td className="border border-black px-2 py-1.5">
                  {company?.company_ceo ?? ""}
                  {company?.company_stamp_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={company.company_stamp_url} alt="인" className="inline-block h-9 align-middle ml-1" />
                  ) : <span className="text-gray-400 ml-2">[인]</span>}
                </td>
              </tr>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">거래처</td>
                <td className="border border-black px-2 py-1.5">
                  {invoice.customer_name ?? quote.customer_name ?? "-"}
                  <span className="text-gray-500 ml-3 text-[10px]">귀중</span>
                </td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">본사</td>
                <td className="border border-black px-2 py-1.5">{company?.company_address ?? ""}</td>
              </tr>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">현장명</td>
                <td className="border border-black px-2 py-1.5">
                  {invoice.site_name ?? quote.site_name ?? "-"}
                  {quote.elevator_name && <span className="text-gray-600 ml-2">({quote.elevator_name})</span>}
                </td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">전화 / E-mail</td>
                <td className="border border-black px-2 py-1.5">
                  <div>{company?.company_phone ?? ""}</div>
                  <div className="font-mono text-[10px]">{company?.company_email ?? ""}</div>
                </td>
              </tr>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">관련 견적</td>
                <td className="border border-black px-2 py-1.5 font-mono">{quote.quote_no}</td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">합계금액</td>
                <td className="border border-black px-2 py-1.5 font-bold">￦ {fmtNum(invoice.total_amount)} 원</td>
              </tr>
            </tbody>
          </table>

          {/* 작업명 */}
          <div className="border border-t-0 border-black px-3 py-2 text-sm">
            <span className="text-xs text-gray-600 mr-3">작 업 명</span>
            <span className="font-bold">※ {quote.work_title ?? ""}</span>
            <span className="block text-[11px] text-gray-600 mt-1">아래와 같이 거래하였음을 확인합니다.</span>
          </div>

          {/* 라인 */}
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-center font-bold">
                <th className="border border-black px-1 py-1.5 w-10">NO</th>
                <th className="border border-black px-2 py-1.5 w-16">호기</th>
                <th className="border border-black px-2 py-1.5">품목</th>
                <th className="border border-black px-2 py-1.5 w-14">단위</th>
                <th className="border border-black px-2 py-1.5 w-16">수량</th>
                <th className="border border-black px-2 py-1.5 w-24">단가</th>
                <th className="border border-black px-2 py-1.5 w-28">금액</th>
                <th className="border border-black px-2 py-1.5">비고</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={8} className="border border-black px-2 py-3 text-center text-gray-400">자재 라인 없음</td></tr>
              )}
              {items.map((it, idx) => (
                <tr key={it.id}>
                  <td className="border border-black px-1 py-1 text-center">{idx + 1}</td>
                  <td className="border border-black px-2 py-1 text-center">{it.elevator_name ?? "-"}</td>
                  <td className="border border-black px-2 py-1">
                    <div className={`font-medium ${tkPrintTextClass(it.material_id)}`}>{it.material_name}</div>
                    {it.spec && <div className="text-[10px] text-gray-600">{it.spec}</div>}
                  </td>
                  <td className="border border-black px-2 py-1 text-center">{it.unit ?? "EA"}</td>
                  <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(it.qty)}</td>
                  <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(it.unit_price)}</td>
                  <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(it.amount)}</td>
                  <td className="border border-black px-2 py-1">{it.remark ?? ""}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-bold">
                <td colSpan={6} className="border border-black px-2 py-1.5 text-right">자재비 소계</td>
                <td className="border border-black px-2 py-1.5 text-right tabular-nums">{fmtNum(items.reduce((s, it) => s + it.amount, 0))}</td>
                <td className="border border-black"></td>
              </tr>
              <tr className="bg-yellow-50 font-bold text-base">
                <td colSpan={6} className="border border-black px-2 py-2 text-right">합 계 (공급가액)</td>
                <td className="border border-black px-2 py-2 text-right tabular-nums">￦ {fmtNum(invoice.total_amount)}</td>
                <td className="border border-black"></td>
              </tr>
            </tbody>
          </table>

          {/* 확인란 */}
          <table className="w-full text-xs border-collapse mt-2">
            <tbody>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 w-28 font-semibold text-center">※ 특기사항</td>
                <td className="border border-black px-2 py-1.5 align-top" rowSpan={3}>
                  <div className="whitespace-pre-wrap min-h-[48px]">{invoice.note ?? ""}</div>
                </td>
                <td className="border border-black bg-gray-100 px-2 py-1.5 w-24 font-semibold text-center">인수자</td>
                <td className="border border-black px-2 py-1.5">　　　　　　　　 (인)</td>
              </tr>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">인수일자</td>
                <td className="border border-black px-2 py-1.5">　　　년　　월　　일</td>
              </tr>
              <tr>
                <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">발행자</td>
                <td className="border border-black px-2 py-1.5">{invoice.issued_by_name ?? "-"}</td>
              </tr>
            </tbody>
          </table>

          <div className="text-center text-[10px] text-gray-500 mt-3">2025년 승강기안전 국무총리상 수상기업 (주)대솔이엘</div>
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
