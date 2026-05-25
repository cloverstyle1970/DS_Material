"use client";

import { useState, useRef, useEffect } from "react";
import { fmtNum } from "@/lib/format";
import { tkPrintTextClass } from "@/lib/material-style";

export interface POPrintCompany {
  company_name:    string | null;
  company_biz_no:  string | null;
  company_address: string | null;
  company_phone:   string | null;
  company_email:   string | null;
  company_ceo:     string | null;
  company_stamp_url?: string | null;
}

export interface POPrintItem {
  materialId:   string;
  materialName: string;
  spec:         string;
  qty:          number;
  unitPrice:    number;
  elevatorName: string;
  remark:       string;
}

export interface POShipInfo {
  shipTo:   string;   // 발송지
  dueDate:  string;   // 납기 희망일
  receiver: string;   // 인수자
  contact:  string;   // 연락처
  manager:  string;   // 담당자
  note:     string;   // 특기사항
}

export interface POShipPlace {
  label:   string;   // 표시명 (본사·현장명 등)
  address: string;   // 선택 시 발송지에 입력될 주소
}

// 발주서 기록란 입력칸 — 인쇄 시 테두리·배경 없이 값만 출력
const SHIP_INPUT_CLS = "w-full bg-transparent text-black px-1 py-0.5 text-xs focus:outline-none focus:bg-yellow-50 print:!bg-transparent";

// 발송지 검색 선택 — 입력으로 검색(지정 장소가 상위 노출), 선택 시 주소 입력. 직접 입력도 가능. 인쇄 시 목록 숨김.
function ShipPlacePicker({ value, places, onChange }: {
  value: string;
  places: POShipPlace[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const q = value.trim().toLowerCase();
  const filtered = q
    ? places.filter(p => p.label.toLowerCase().includes(q) || p.address.toLowerCase().includes(q))
    : places;

  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <input type="text" lang="ko" value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="장소 검색 또는 직접 입력"
        className={SHIP_INPUT_CLS} />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 left-0 top-full mt-0.5 w-full max-w-md bg-white border border-gray-300 rounded-lg shadow-xl max-h-52 overflow-y-auto print:hidden">
          {filtered.map((p, i) => (
            <li key={i}>
              <button type="button" onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(p.address); setOpen(false); }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-blue-50 border-b border-gray-50 last:border-0">
                <span className="text-xs font-medium text-gray-800">{p.label}</span>
                <span className="block text-[10px] text-gray-400 truncate">{p.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Props {
  orderDate:    string;            // YYYY-MM-DD
  vendorName:   string;
  managerName:  string;            // 자재 신청자 (= 담당자)
  managerPhone: string;            // 신청자(담당자) 연락처
  ordererName:  string;            // 발주자 (발주서 작성자)
  siteName:     string;
  orderRefNo:   string;
  formType:     "기본" | "긴급" | "수리";
  reference:    string;
  items:        POPrintItem[];
  company:      POPrintCompany | null;
  shipInfo:         POShipInfo;
  onShipInfoChange: (patch: Partial<POShipInfo>) => void;
  shipPlaces:       POShipPlace[];   // 발송지 선택 후보 (본사·현장 등)
}

function fmtDate(iso: string): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso ?? "";
  return `${m[1]}년 ${m[2]}월 ${m[3]}일`;
}

export default function PurchaseOrderPrintPaper({
  orderDate, vendorName, managerName, managerPhone, ordererName, siteName, orderRefNo, formType, reference, items, company, shipInfo, onShipInfoChange, shipPlaces,
}: Props) {
  const validItems = items.filter(it => it.materialId || it.materialName.trim());
  const totalQty = validItems.reduce((s, it) => s + it.qty, 0);
  // A4 한 장이 비어 보이지 않도록 최소 행 수를 빈 행으로 채움 (품목이 많으면 빈 행 없음)
  const MIN_ROWS = 20;
  const emptyRowCount = Math.max(0, MIN_ROWS - validItems.length);

  return (
    <>
      <div className="po-paper bg-white text-black mx-auto shadow-lg print:shadow-none">

        {/* 제목 + 회사 정보 */}
        <div className="border-b-2 border-black grid grid-cols-3 items-stretch">
          <div className="text-xs px-3 py-2 border-r border-black flex items-center gap-2">
            <span>NO. {orderRefNo || "-"}</span>
            {formType !== "기본" && <span className="font-bold text-red-600">[{formType}]</span>}
          </div>
          <div className="text-3xl font-bold text-center py-3 tracking-[0.3em]">發&nbsp;注&nbsp;書</div>
          <div className="text-xs px-3 py-2 border-l border-black flex flex-col justify-center">
            <div className="font-bold text-sm">{company?.company_name ?? "주식회사 대솔이엘"}</div>
            <div className="font-mono mt-0.5">{company?.company_biz_no ?? ""}</div>
          </div>
        </div>

        {/* 메타 */}
        <table className="w-full text-xs border-collapse">
          <tbody>
            <tr>
              <td className="border border-black bg-gray-100 px-2 py-1.5 w-24 font-semibold text-center">발주일자</td>
              <td className="border border-black px-2 py-1.5">{fmtDate(orderDate)}</td>
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
                {vendorName || "-"}
                <span className="text-gray-500 ml-3 text-[10px]">귀중</span>
              </td>
              <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">본사</td>
              <td className="border border-black px-2 py-1.5">{company?.company_address ?? ""}</td>
            </tr>
            <tr>
              <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">현장명</td>
              <td className="border border-black px-2 py-1.5">{siteName || "-"}</td>
              <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">전화 / E-mail</td>
              <td className="border border-black px-2 py-1.5">
                <div>{company?.company_phone ?? ""}</div>
                <div className="font-mono text-[10px]">{company?.company_email ?? ""}</div>
              </td>
            </tr>
            <tr>
              <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">발주자</td>
              <td className="border border-black px-2 py-1.5">{ordererName || "-"}</td>
              <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">합계금액</td>
              <td className="border border-black px-2 py-1.5">&nbsp;</td>
            </tr>
          </tbody>
        </table>

        {/* 참조 */}
        <div className="border border-t-0 border-black px-3 py-2 text-sm">
          <span className="text-xs text-gray-600 mr-3">참&nbsp;&nbsp;&nbsp;조</span>
          <span className="font-bold">※ {reference || "-"}</span>
          <span className="block text-[11px] text-gray-600 mt-1">아래와 같이 발주합니다.</span>
        </div>

        {/* 품목 테이블 */}
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100 text-center font-bold">
              <th className="border border-black px-1 py-1.5 w-10">NO</th>
              <th className="border border-black px-2 py-1.5">품&nbsp;목&nbsp;명</th>
              <th className="border border-black px-2 py-1.5 w-16">규격</th>
              <th className="border border-black px-2 py-1.5 w-12">수량</th>
              <th className="border border-black px-2 py-1.5 w-16">단&nbsp;가</th>
              <th className="border border-black px-2 py-1.5 w-20">공급가액</th>
              <th className="border border-black px-2 py-1.5 w-16">호기</th>
              <th className="border border-black px-2 py-1.5">적요</th>
            </tr>
          </thead>
          <tbody>
            {validItems.map((it, idx) => (
              <tr key={idx}>
                <td className="border border-black px-1 py-1 text-center">{idx + 1}</td>
                <td className={`border border-black px-2 py-1 whitespace-nowrap ${tkPrintTextClass(it.materialId)}`}>{it.materialName}</td>
                <td className="border border-black px-2 py-1 whitespace-nowrap">{it.spec}</td>
                <td className="border border-black px-2 py-1 text-right tabular-nums">{fmtNum(it.qty)}</td>
                <td className="border border-black px-2 py-1">&nbsp;</td>
                <td className="border border-black px-2 py-1">&nbsp;</td>
                <td className="border border-black px-2 py-1 text-center whitespace-nowrap">{it.elevatorName}</td>
                <td className="border border-black px-2 py-1 whitespace-nowrap">{it.remark}</td>
              </tr>
            ))}
            {Array.from({ length: emptyRowCount }).map((_, i) => (
              <tr key={`empty-${i}`}>
                <td className="border border-black px-1 py-1 text-center text-gray-400">{validItems.length + i + 1}</td>
                <td className="border border-black px-2 py-1">&nbsp;</td>
                <td className="border border-black px-2 py-1">&nbsp;</td>
                <td className="border border-black px-2 py-1">&nbsp;</td>
                <td className="border border-black px-2 py-1">&nbsp;</td>
                <td className="border border-black px-2 py-1">&nbsp;</td>
                <td className="border border-black px-2 py-1">&nbsp;</td>
                <td className="border border-black px-2 py-1">&nbsp;</td>
              </tr>
            ))}
            <tr className="bg-gray-50 font-bold">
              <td colSpan={3} className="border border-black px-2 py-1.5 text-right">합&nbsp;계</td>
              <td className="border border-black px-2 py-1.5 text-right tabular-nums">{fmtNum(totalQty)}</td>
              <td className="border border-black"></td>
              <td className="border border-black"></td>
              <td className="border border-black" colSpan={2}></td>
            </tr>
          </tbody>
        </table>

        {/* 발주자 · 발송지 정보 */}
        <table className="w-full text-xs border-collapse mt-2">
          <tbody>
            <tr>
              <td className="border border-black bg-gray-100 px-2 py-1.5 w-28 font-semibold text-center">발송지</td>
              <td className="border border-black px-1 py-0.5" colSpan={3}>
                <ShipPlacePicker value={shipInfo.shipTo} places={shipPlaces}
                  onChange={v => onShipInfoChange({ shipTo: v })} />
              </td>
            </tr>
            <tr>
              <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">납기 희망일</td>
              <td className="border border-black px-1 py-0.5" colSpan={3}>
                <input type="text" lang="ko" value={shipInfo.dueDate}
                  onChange={e => onShipInfoChange({ dueDate: e.target.value })} className={SHIP_INPUT_CLS} />
              </td>
            </tr>
            <tr>
              <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center">연락처</td>
              <td className="border border-black px-2 py-1.5">{managerPhone || "-"}</td>
              <td className="border border-black bg-gray-100 px-2 py-1.5 w-24 font-semibold text-center">담당자</td>
              <td className="border border-black px-2 py-1.5">{managerName || "-"}</td>
            </tr>
            <tr>
              <td className="border border-black bg-gray-100 px-2 py-1.5 font-semibold text-center align-top">특기사항</td>
              <td className="border border-black px-1 py-0.5" colSpan={3}>
                <textarea lang="ko" value={shipInfo.note} rows={3}
                  onChange={e => onShipInfoChange({ note: e.target.value })}
                  className="w-full bg-transparent text-black px-1 py-0.5 text-xs resize-none focus:outline-none focus:bg-yellow-50 print:!bg-transparent min-h-[64px]" />
              </td>
            </tr>
          </tbody>
        </table>

      </div>

      {/* 인쇄 스타일 */}
      <style jsx global>{`
        .po-paper {
          width: 210mm;
          min-height: 297mm;
          padding: 22mm 10mm 12mm;
          box-sizing: border-box;
        }
        @media print {
          @page { size: A4 portrait; margin: 18mm 8mm 8mm; }
          body, html { background: white !important; }
          .po-paper { width: 100% !important; min-height: 0 !important; padding: 0 !important; box-shadow: none !important; }
        }
      `}</style>
    </>
  );
}
