"use client";

import { ReactNode } from "react";
import { fmtNum } from "@/lib/format";
import { tkPrintTextClass } from "@/lib/material-style";

export interface QuotePrintCompany {
  company_name:    string | null;
  company_biz_no:  string | null;
  company_address: string | null;
  company_phone:   string | null;
  company_email:   string | null;
  company_ceo:     string | null;
  company_stamp_url?: string | null;
}

export interface QuotePrintItem {
  id?: number | string;
  material_id?: string | null;
  material_name: string;
  spec?: string | null;
  unit?: string | null;
  qty: number;
  unit_price: number;
  amount: number;
  remark?: string | null;
  opinion_text?: string | null;
  opinion_image_url?: string | null;
}

export interface QuotePrintHeader {
  quote_no: string;
  quote_date: string;            // YYYY-MM-DD
  site_name: string | null;
  elevator_name: string | null;
  work_title: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  material_subtotal: number;
  direct_labor: number;
  indirect_labor: number;
  indirect_labor_rate: number;
  overhead: number;
  overhead_rate: number;
  profit: number;
  profit_rate: number;
  truncate_amount: number;
  total_amount: number;
  note: string | null;
}

interface Props {
  header: QuotePrintHeader;
  items: QuotePrintItem[];
  company: QuotePrintCompany | null;
  /** 소견 버튼(상세 페이지 전용). 미지정 시 버튼 숨김 */
  onOpenOpinion?: (id: number | string) => void;
  /** 미리보기 모드 — 우상단에 워터마크 뱃지 표시 */
  preview?: boolean;
  /** 푸터 자리에 노출할 보조 콘텐츠 */
  footerExtra?: ReactNode;
}

function fmtDate(iso: string): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso ?? "";
  return `${m[1]}년 ${m[2]}월 ${m[3]}일`;
}

export default function QuotePrintPaper({ header, items, company, onOpenOpinion, preview, footerExtra }: Props) {
  return (
    <>
      <div className="quote-paper bg-white text-black mx-auto shadow-lg print:shadow-none relative">
        {preview && (
          <div className="absolute top-2 right-3 print:hidden text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 border border-amber-400">
            👁 미리보기
          </div>
        )}

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
              <td className="border border-black px-2 py-1.5 relative">
                {company?.company_ceo ?? ""}
                {company?.company_stamp_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={company.company_stamp_url} alt="인" className="inline-block h-9 align-middle ml-1" />
                ) : <span className="text-gray-400 ml-2">[인]</span>}
              </td>
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
              <tr key={it.id ?? idx} className="hover:bg-yellow-50 print:hover:bg-transparent">
                <td className="border border-black px-1 py-1 text-center">{idx + 1}</td>
                <td className="border border-black px-2 py-1">
                  <div className={`font-medium ${tkPrintTextClass(it.material_id)}`}>{it.material_name}</div>
                  {it.spec && <div className="text-[10px] text-gray-600">{it.spec}</div>}
                </td>
                <td className="border border-black px-2 py-1 text-center">{it.unit ?? "EA"}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(it.qty)}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(it.unit_price)}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(it.amount)}</td>
                <td className="border border-black px-2 py-1">
                  <div className="flex items-center gap-2">
                    <span className="flex-1">{it.remark ?? ""}</span>
                    {(it.opinion_text || it.opinion_image_url) && onOpenOpinion && it.id !== undefined && (
                      <button type="button" onClick={() => onOpenOpinion(it.id!)}
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
        {footerExtra}
      </div>

      {/* 인쇄 스타일 (글로벌) */}
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
