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
  elevator_name?: string | null;   // 비고란 앞에 [호기명] 으로 함께 표시
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
  // 인건비 표시 모드 (작업 라인 연동)
  labor_mode?: "공" | "식" | null;
  labor_manhours?: number | null;
  labor_unit_price?: number | null;
  // 부가세 포함 여부 (false=별도 기본)
  vat_included?: boolean | null;
  // 규격 표시 여부 (기본 true)
  show_spec?: boolean | null;
  // 견적 수정 내역 출력 여부 (기본 false)
  show_revisions?: boolean | null;
  // Nego 확정가 (VAT 별도, 0=미사용)
  nego_amount?: number | null;
}

export interface QuotePrintLaborLine {
  work_name: string;
  man_days: number;
  unit_price: number;
  amount: number;
}

export interface QuotePrintRevisionNote {
  revised_date: string;
  content: string;
}

interface Props {
  header: QuotePrintHeader;
  items: QuotePrintItem[];
  company: QuotePrintCompany | null;
  /** 교체공사 작업 라인 (있으면 인건비 섹션에 공정별/식 표시) */
  laborLines?: QuotePrintLaborLine[];
  /** 견적 수정 내역 (show_revisions=true 이고 내역 있으면 특기사항 아래 표시) */
  revisionNotes?: QuotePrintRevisionNote[];
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

// 견적서 표기 전용: DB의 "... 702(풍동 신성프라자)" → 화면에는 "... 702호" 로 표시
// (DB 데이터 자체는 보존)
function formatAddressForPrint(address: string | null | undefined): string {
  if (!address) return "";
  return address.replace(/\s*\([^)]*\)\s*$/, "호");
}

export default function QuotePrintPaper({ header, items, company, laborLines, revisionNotes, onOpenOpinion, preview, footerExtra }: Props) {
  const showRevisions = !!header.show_revisions && !!revisionNotes && revisionNotes.length > 0;
  const hasLaborLines = !!laborLines && laborLines.length > 0;
  const laborAsSik = hasLaborLines && header.labor_mode === "식";
  const vatIncluded = !!header.vat_included;
  const showSpec = header.show_spec !== false;  // 기본 표시
  // 인건비/요율 적용 여부 — 직접인건비가 0이면 미적용으로 보고 인건비 행 공란
  // (직접만 적용 케이스는 direct>0 이고 나머지(indirect/overhead/profit)는 0 → 행별로 개별 공란 처리)
  const laborApplied = header.direct_labor > 0;
  const fmtOrBlank = (n: number) => (n > 0 ? fmtNum(n) : "");
  const rateOrBlank = (n: number) => (n > 0 ? `${n}%` : "");
  // Nego 확정가가 있으면 부가세·합계는 그 금액 기준
  const negoAmount = header.nego_amount ?? 0;
  const negoActive = negoAmount > 0;
  const supplyAmount = header.total_amount;                    // 원 견적 공급가액
  const effectiveSupply = negoActive ? negoAmount : supplyAmount;
  const vatAmount = Math.round(effectiveSupply * 0.1);         // 실효 공급가액 기준 10%
  const grandTotal = effectiveSupply + vatAmount;

  // 항목표·총액표 컬럼 정렬 공유 (절사금액↔공급가액 사이 여백 분리용)
  const colGroup = (
    <colgroup>
      <col style={{ width: "3rem" }} />{/* NO */}
      <col />{/* 품목 */}
      <col style={{ width: "3.5rem" }} />{/* 단위 */}
      <col style={{ width: "4rem" }} />{/* 수량 */}
      <col style={{ width: "6rem" }} />{/* 단가 */}
      <col style={{ width: "7rem" }} />{/* 금액 */}
      <col style={{ width: "8rem" }} />{/* 비고 */}
    </colgroup>
  );
  return (
    <>
      <div className="quote-paper bg-white text-black mx-auto shadow-lg print:shadow-none relative">
        {preview && (
          <div className="absolute top-2 right-3 print:hidden text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 border border-amber-400">
            👁 미리보기
          </div>
        )}

        {/* 제목 */}
        <div className="border-b border-black grid grid-cols-[200px_1fr_200px] items-stretch">
          <div className="text-xs px-3 py-2 flex items-center">
            NO. {header.quote_no}
          </div>
          <div className="text-3xl font-bold text-center py-3 tracking-[0.3em]">견&nbsp;적&nbsp;서</div>
          <div></div>
        </div>

        {/* 견적 메타 + 회사 상세 */}
        <table className="w-full text-xs border-collapse">
          <tbody>
            <tr>
              <td className="border border-black bg-gray-100 px-2 py-1.5 w-24 font-semibold text-center">견적년월일</td>
              <td className="border border-black px-2 py-1.5">{fmtDate(header.quote_date)}</td>
              <td className="border border-black bg-gray-100 px-2 py-1.5 w-24 font-semibold text-center">회사명</td>
              <td className="border border-black px-2 py-1.5 font-bold">{company?.company_name ?? "주식회사 대솔이엘"}</td>
            </tr>
            <tr>
              <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">현장명</td>
              <td className="border border-black px-2 py-1.5">
                {header.site_name ?? "-"}
                <span className="ml-3 text-xs font-bold text-gray-800">귀중</span>
              </td>
              <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">대표이사</td>
              <td className="border border-black px-2 py-1.5 relative">
                {company?.company_ceo ?? ""}
                {company?.company_stamp_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={company.company_stamp_url} alt="인" className="inline-block h-[54px] align-middle ml-1 -my-3 -mr-3 relative z-10" />
                ) : <span className="text-gray-400 ml-2">[인]</span>}
              </td>
            </tr>
            <tr>
              <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center" rowSpan={2}>합계금액</td>
              <td className="border border-black px-2 py-1.5 font-bold align-middle text-right" rowSpan={2}>
                <span className="text-[16.57px]">￦ {fmtNum(vatIncluded ? grandTotal : effectiveSupply)} 원정</span>
                <div className="text-[10px] text-gray-500 mt-0.5">위 금액은 부가세 {vatIncluded ? "포함" : "별도"} 금액임.</div>
              </td>
              <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">회사주소</td>
              <td className="border border-black px-2 py-1.5">{formatAddressForPrint(company?.company_address)}</td>
            </tr>
            <tr>
              <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">전화 / E-mail</td>
              <td className="border border-black px-2 py-1.5">
                <span>{company?.company_phone ?? ""}</span>
                {company?.company_phone && company?.company_email && <span className="mx-1.5 text-gray-400">/</span>}
                <span className="font-mono text-[10px]">{company?.company_email ?? ""}</span>
              </td>
            </tr>
          </tbody>
        </table>

        {/* 작업명 */}
        <div className="border border-t-0 border-black px-3 py-2 text-sm">
          <span className="font-bold mr-2">작 업 명 :</span>
          <span className="font-bold">{header.work_title ?? ""}</span>
        </div>

        {/* 메인 테이블 (항목부: 자재비~절사금액) */}
        <table className="w-full text-xs border-collapse table-fixed">
          {colGroup}
          <thead>
            <tr className="bg-gray-100 text-center font-bold">
              <th className="border border-black px-1 py-1.5 w-12">NO</th>
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
                  {showSpec && it.spec && <div className="text-[10px] text-gray-600">{it.spec}</div>}
                </td>
                <td className="border border-black px-2 py-1 text-center">{it.unit ?? "EA"}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(it.qty)}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(it.unit_price)}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(it.amount)}</td>
                <td className="border border-black px-2 py-1">
                  <div className="flex items-center gap-2">
                    <span className="flex-1">
                      {/* 호기 정보 + 비고 — 호기가 있으면 같은 셀에 "#호기 " 형태로 먼저 표시 */}
                      {it.elevator_name && (
                        <span className="font-semibold">#{it.elevator_name} </span>
                      )}
                      {it.remark ?? ""}
                    </span>
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
            {!hasLaborLines && (
              /* 작업 라인 없음 — 기존 단일 직접인건비 행 */
              <tr>
                <td className="border border-black"></td>
                <td className="border border-black px-2 py-1">직접인건비</td>
                <td className="border border-black px-2 py-1 text-center">{laborApplied ? "공" : ""}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{laborApplied ? "1" : ""}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{laborApplied ? fmtNum(header.direct_labor) : ""}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{laborApplied ? fmtNum(header.direct_labor) : ""}</td>
                <td className="border border-black"></td>
              </tr>
            )}
            {hasLaborLines && laborAsSik && (
              /* "식" 모드 — 전체 공정을 일식 1줄로 묶음 */
              <tr>
                <td className="border border-black"></td>
                <td className="border border-black px-2 py-1">직접인건비</td>
                <td className="border border-black px-2 py-1 text-center">{laborApplied ? "식" : ""}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{laborApplied ? "1" : ""}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{laborApplied ? fmtNum(header.direct_labor) : ""}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{laborApplied ? fmtNum(header.direct_labor) : ""}</td>
                <td className="border border-black"></td>
              </tr>
            )}
            {hasLaborLines && !laborAsSik && laborLines!.map((l, i) => (
              /* "공" 모드 — 공정별 개별 행 (직접인건비 내역) */
              <tr key={i}>
                <td className="border border-black"></td>
                <td className="border border-black px-2 py-1">직접인건비({l.work_name.split(" · ")[0]} 작업 및 조정비용)</td>
                <td className="border border-black px-2 py-1 text-center">{laborApplied ? "공" : ""}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{laborApplied ? fmtNum(l.man_days) : ""}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{laborApplied ? fmtNum(l.unit_price) : ""}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{laborApplied ? fmtNum(l.amount) : ""}</td>
                <td className="border border-black"></td>
              </tr>
            ))}
            <tr>
              <td className="border border-black"></td>
              <td className="border border-black px-2 py-1">간접인건비 (직접인건비의 {header.indirect_labor_rate}%)</td>
              <td className="border border-black px-2 py-1 text-center">{header.indirect_labor > 0 ? rateOrBlank(header.indirect_labor_rate) : ""}</td>
              <td className="border border-black"></td>
              <td className="border border-black"></td>
              <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtOrBlank(header.indirect_labor)}</td>
              <td className="border border-black"></td>
            </tr>
            <tr className="bg-gray-50 font-bold">
              <td colSpan={5} className="border border-black px-2 py-1.5 text-right">소 계</td>
              <td className="border border-black px-2 py-1.5 text-right tabular-nums">{fmtOrBlank(header.direct_labor + header.indirect_labor)}</td>
              <td className="border border-black px-2 py-1.5"></td>
            </tr>

            {/* 3. 일반관리비 */}
            <tr>
              <td className="border border-black bg-gray-50 px-2 py-1 font-bold text-center">3</td>
              <td className="border border-black px-2 py-1">일반관리비 및 제경비 (1+2항)</td>
              <td className="border border-black px-2 py-1 text-center">{header.overhead > 0 ? rateOrBlank(header.overhead_rate) : ""}</td>
              <td className="border border-black"></td>
              <td className="border border-black"></td>
              <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtOrBlank(header.overhead)}</td>
              <td className="border border-black"></td>
            </tr>

            {/* 4. 이윤 */}
            <tr>
              <td className="border border-black bg-gray-50 px-2 py-1 font-bold text-center">4</td>
              <td className="border border-black px-2 py-1">이윤 (2+3항)</td>
              <td className="border border-black px-2 py-1 text-center">{header.profit > 0 ? rateOrBlank(header.profit_rate) : ""}</td>
              <td className="border border-black"></td>
              <td className="border border-black"></td>
              <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtOrBlank(header.profit)}</td>
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
          </tbody>
        </table>

        {/* 절사금액 ↔ 공급가액 사이 신축 여백 (A4 한 장 채움) */}
        <div className="flex-grow min-h-[8mm]" />

        {/* 총액부 (공급가액/부가세/합계) — 페이지 하단 */}
        <table className="w-full text-xs border-collapse table-fixed">
          {colGroup}
          <tbody>
            {/* Nego 확정가 (입력 시) — 공급가액 바로 위, 빨간색 강조 */}
            {negoActive && (
              <tr className="font-bold text-base">
                <td colSpan={5} className="border border-black px-2 py-2 text-right text-red-600">Nego확정가 (VAT별도)</td>
                <td className="border border-black px-2 py-2 text-right tabular-nums text-red-600">￦ {fmtNum(negoAmount)}</td>
                <td className="border border-black"></td>
              </tr>
            )}
            {/* 공급가액 (별도 모드면 대표 강조) */}
            <tr className={`font-bold ${!vatIncluded ? "bg-yellow-50 print:bg-gray-100" : ""}`}>
              <td colSpan={5} className="border border-black px-2 py-2 text-right">
                공 급 가 액{!vatIncluded && <span className="text-[10px] font-normal text-gray-500 ml-1">(부가세 별도)</span>}
              </td>
              <td className="border border-black px-2 py-2 text-right tabular-nums">￦ {fmtNum(supplyAmount)}</td>
              <td className="border border-black"></td>
            </tr>
            {/* 부가가치세 — 부가세 포함 모드에서만 표시 (별도 모드는 부가세 미적용·미표시) */}
            {vatIncluded && (
              <tr className="font-bold">
                <td colSpan={5} className="border border-black px-2 py-1.5 text-right">부 가 가 치 세 (10%)</td>
                <td className="border border-black px-2 py-1.5 text-right tabular-nums">￦ {fmtNum(vatAmount)}</td>
                <td className="border border-black"></td>
              </tr>
            )}
            {/* 합계 (부가세 포함 모드에서만 표시) */}
            {vatIncluded && (
              <tr className="font-bold bg-yellow-50 print:bg-gray-100 text-base">
                <td colSpan={5} className="border border-black px-2 py-2 text-right">합 계 (부가세 포함)</td>
                <td className="border border-black px-2 py-2 text-right tabular-nums">￦ {fmtNum(grandTotal)}</td>
                <td className="border border-black"></td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 특기사항 + 고객승인 */}
        <table className="w-full text-xs border-collapse mt-2">
          <tbody>
            <tr>
              <td className="border border-black bg-gray-100 px-2 py-1.5 w-28 font-semibold text-center" rowSpan={4}>※ 특기사항</td>
              <td className="border border-black px-2 py-1.5 align-top" rowSpan={4} style={{ width: "46.66%" }}>
                <div className="whitespace-pre-wrap min-h-[60px] text-blue-700">{header.note ?? ""}</div>
              </td>
              <td colSpan={2} className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">&lt;고객승인&gt;</td>
            </tr>
            <tr>
              <td colSpan={2} className="border border-black px-2 py-1.5">▣ 상기 부품 보완 작업 승인함을 확인합니다.</td>
            </tr>
            <tr>
              <td className="border border-black bg-gray-100 px-2 py-1.5 w-28 font-semibold text-center">승인일</td>
              <td className="border border-black px-2 py-1.5 whitespace-nowrap">　　　년　　　월　　　일</td>
            </tr>
            <tr>
              <td className="border border-black bg-gray-100 px-2 py-1.5 h-[72px] font-semibold text-center">승인자</td>
              <td className="border border-black px-2 py-1.5 h-[72px] whitespace-nowrap">직위: 　　　　　　　 (인)</td>
            </tr>
          </tbody>
        </table>

        {/* 견적 수정 내역 (토글 ON + 내역 있을 때만) */}
        {showRevisions && (
          <table className="w-full text-xs border-collapse mt-2">
            <tbody>
              <tr>
                <td colSpan={2} className="border border-black bg-gray-100 px-2 py-1 font-semibold">※ 견적 수정 내역</td>
              </tr>
              {revisionNotes!.map((r, i) => (
                <tr key={i}>
                  <td className="border border-black px-2 py-1 w-32 text-center whitespace-nowrap">{r.revised_date}</td>
                  <td className="border border-black px-2 py-1">{r.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* 푸터 */}
        <div className="text-right text-[10px] text-blue-600 mt-3">2025년 승강기안전 국무총리상 수상기업 (주)대솔이엘</div>
        {footerExtra}
      </div>

      {/* 인쇄 스타일 (글로벌) */}
      <style jsx global>{`
        .quote-paper {
          width: 210mm;
          min-height: 297mm;          /* A4 한 장 최소 높이 — 내용 짧아도 하단 승인란 고정 */
          padding: 12mm 10mm;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
        /* 행이 페이지 경계에서 잘리지 않도록 */
        .quote-paper tr { break-inside: avoid; page-break-inside: avoid; }
        @media print {
          @page { size: A4; margin: 8mm; }
          body, html { background: white !important; }
          .quote-paper { width: 100% !important; min-height: 277mm; padding: 0 !important; box-shadow: none !important; }
        }
      `}</style>
    </>
  );
}
