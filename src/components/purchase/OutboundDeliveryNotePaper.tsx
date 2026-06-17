"use client";

import { useState, useRef, useEffect } from "react";
import { fmtNum } from "@/lib/format";

// 공급자(대솔) 고정 정보 — 거래명세서-대솔.xlsx 기준
const SUPPLIER = {
  bizNo:   "128-86-58162",
  name:    "주식회사 대솔이엘",
  ceo:     "송영권",
  address: "경기도 고양시 일산동구 숲속마을로 48, 702호",
  phone:   "031-938-0257",
  fax:     "031-938-0259",
};

export interface DNReceiver {
  name:    string;   // 상호(법인명)
  bizNo:   string;   // 등록번호
  address: string;   // 사업장 주소
  phone:   string;   // 전화번호
}

export interface DNItem {
  materialId:   string;
  materialName: string;
  spec:         string;
  qty:          number;
  unitPrice:    number;
}

const MIN_ROWS = 10;
const DN_INPUT = "w-full bg-transparent text-black px-1 text-[11px] focus:outline-none focus:bg-yellow-50 print:!bg-transparent";

export interface DNVendor {
  name:    string;
  bizNo:   string;
  address: string;
  phone:   string;
}

// 공급받는자(거래처) 검색 선택 — 선택 시 등록번호·주소·전화 자동 채움. 직접 입력도 가능. 인쇄 시 목록 숨김.
function VendorPicker({ value, vendors, onPick, onChangeName }: {
  value: string;
  vendors: DNVendor[];
  onPick: (v: DNVendor) => void;
  onChangeName: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const q = value.trim().toLowerCase();
  const filtered = (q ? vendors.filter(v => v.name.toLowerCase().includes(q)) : vendors).slice(0, 15);
  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <input className={DN_INPUT} value={value} lang="ko"
        onChange={e => { onChangeName(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="거래처 검색 또는 직접 입력" />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 left-0 top-full mt-0.5 w-72 bg-white border border-gray-300 rounded-lg shadow-xl max-h-52 overflow-y-auto print:hidden">
          {filtered.map((v, i) => (
            <li key={i}>
              <button type="button" onMouseDown={e => e.preventDefault()}
                onClick={() => { onPick(v); setOpen(false); }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-blue-50 border-b border-gray-50 last:border-0 text-black">
                <span className="text-xs font-medium">{v.name}</span>
                {v.bizNo && <span className="block text-[10px] text-gray-400">{v.bizNo}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Props {
  outboundDate:     string;       // YYYY-MM-DD
  items:            DNItem[];
  receiver:         DNReceiver;
  onReceiverChange: (patch: Partial<DNReceiver>) => void;
  vendors:          DNVendor[];
  stampUrl?:        string;       // 공급자(대솔) 인감도장
  recipientName?:   string;       // 인수자(수령인) 자동기입 — 출고전표 첫 행 수령인
}

export default function OutboundDeliveryNotePaper({ outboundDate, items, receiver, onReceiverChange, vendors, stampUrl, recipientName }: Props) {
  const valid     = items.filter(it => it.materialId || it.materialName.trim());
  const supplySum = valid.reduce((s, it) => s + it.qty * it.unitPrice, 0);
  const vatSum    = valid.reduce((s, it) => s + Math.round(it.qty * it.unitPrice * 0.1), 0);
  const totalSum  = supplySum + vatSum;
  const qtySum    = valid.reduce((s, it) => s + it.qty, 0);
  const m = outboundDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const [yy, mm, dd] = m ? [m[1].slice(2), m[2], m[3]] : ["", "", ""];
  const emptyCount = Math.max(0, MIN_ROWS - valid.length);

  // bd: 테두리 색 클래스, lc: 항목명(라벨) 글자색 클래스. 입력값·데이터는 항상 검정(text-black).
  const renderCopy = (label: string, bd: string, lc: string) => (
    <div>
      <div className={`text-center font-bold text-base py-1 ${lc}`}>
        거 래 명 세 표 <span className="text-xs font-normal">({label})</span>
      </div>

      {/* 공급받는자(좌) / 공급자(우) */}
      <table className="w-full text-[11px] border-collapse">
        <tbody>
          <tr>
            <td rowSpan={4} className={`border ${bd} bg-gray-100 text-center font-bold w-5 ${lc}`}>
              <span className="[writing-mode:vertical-rl] tracking-widest">공급받는자</span>
            </td>
            <td className={`border ${bd} bg-gray-100 text-center px-1 py-1 w-20 ${lc}`}>상호(법인명)</td>
            <td className={`border ${bd} px-1 py-0.5 text-black`} colSpan={2}>
              <VendorPicker value={receiver.name} vendors={vendors}
                onPick={v => onReceiverChange({ name: v.name, bizNo: v.bizNo, address: v.address, phone: v.phone })}
                onChangeName={name => onReceiverChange({ name })} />
            </td>
            <td rowSpan={4} className={`border ${bd} bg-gray-100 text-center font-bold w-5 ${lc}`}>
              <span className="[writing-mode:vertical-rl] tracking-widest">공급자</span>
            </td>
            <td className={`border ${bd} bg-gray-100 text-center px-1 py-1 w-20 ${lc}`}>등록번호</td>
            <td className={`border ${bd} px-1 py-1 font-mono text-black`} colSpan={2}>{SUPPLIER.bizNo}</td>
          </tr>
          <tr>
            <td className={`border ${bd} bg-gray-100 text-center px-1 py-1 ${lc}`}>등록번호</td>
            <td className={`border ${bd} px-1 py-0.5 text-black`} colSpan={2}>
              <input className={DN_INPUT} value={receiver.bizNo} onChange={e => onReceiverChange({ bizNo: e.target.value })} />
            </td>
            <td className={`border ${bd} bg-gray-100 text-center px-1 py-1 ${lc}`}>상호(법인명)</td>
            <td className={`border ${bd} px-1 py-1 text-black`} colSpan={2}>
              {SUPPLIER.name} <span className="text-gray-500 ml-1">{SUPPLIER.ceo}</span>
              {stampUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={stampUrl} alt="인" className="inline-block h-8 align-middle ml-1" />
              ) : <span className="text-gray-500 ml-1">(인)</span>}
            </td>
          </tr>
          <tr>
            <td className={`border ${bd} bg-gray-100 text-center px-1 py-1 ${lc}`}>사업장주소</td>
            <td className={`border ${bd} px-1 py-0.5 text-black`} colSpan={2}>
              <input className={DN_INPUT} value={receiver.address} onChange={e => onReceiverChange({ address: e.target.value })} />
            </td>
            <td className={`border ${bd} bg-gray-100 text-center px-1 py-1 ${lc}`}>사업장주소</td>
            <td className={`border ${bd} px-1 py-1 text-[10px] text-black`} colSpan={2}>{SUPPLIER.address}</td>
          </tr>
          <tr>
            <td className={`border ${bd} bg-gray-100 text-center px-1 py-1 ${lc}`}>전화번호</td>
            <td className={`border ${bd} px-1 py-0.5 text-black`} colSpan={2}>
              <input className={DN_INPUT} value={receiver.phone} onChange={e => onReceiverChange({ phone: e.target.value })} />
            </td>
            <td className={`border ${bd} bg-gray-100 text-center px-1 py-1 ${lc}`}>전화 / 팩스</td>
            <td className={`border ${bd} px-1 py-1 text-[10px] text-black`} colSpan={2}>{SUPPLIER.phone} / {SUPPLIER.fax}</td>
          </tr>
          <tr>
            <td className={`border ${bd} bg-gray-100 text-center px-1 py-1 font-semibold ${lc}`} colSpan={2}>합계금액 (VAT포함)</td>
            <td className={`border ${bd} px-2 py-1 text-right font-bold text-black`} colSpan={6}>￦ {fmtNum(totalSum)} 원</td>
          </tr>
        </tbody>
      </table>

      {/* 품목 */}
      <table className="w-full text-[11px] border-collapse mt-0.5">
        <thead>
          <tr className={`bg-gray-100 text-center font-bold ${lc}`}>
            <th className={`border ${bd} px-1 py-1 w-7`}>년</th>
            <th className={`border ${bd} px-1 py-1 w-7`}>월</th>
            <th className={`border ${bd} px-1 py-1 w-7`}>일</th>
            <th className={`border ${bd} px-1 py-1`}>품&nbsp;목</th>
            <th className={`border ${bd} px-1 py-1 w-20`}>규격</th>
            <th className={`border ${bd} px-1 py-1 w-10`}>수량</th>
            <th className={`border ${bd} px-1 py-1 w-16`}>단가</th>
            <th className={`border ${bd} px-1 py-1 w-20`}>공급가액</th>
            <th className={`border ${bd} px-1 py-1 w-16`}>세액</th>
          </tr>
        </thead>
        <tbody className="text-black">
          {valid.map((it, i) => {
            const supply = it.qty * it.unitPrice;
            const vat = Math.round(supply * 0.1);
            return (
              <tr key={i}>
                <td className={`border ${bd} px-1 py-0.5 text-center`}>{i === 0 ? yy : ""}</td>
                <td className={`border ${bd} px-1 py-0.5 text-center`}>{i === 0 ? mm : ""}</td>
                <td className={`border ${bd} px-1 py-0.5 text-center`}>{i === 0 ? dd : ""}</td>
                <td className={`border ${bd} px-1 py-0.5 whitespace-nowrap`}>{it.materialName}</td>
                <td className={`border ${bd} px-1 py-0.5 whitespace-nowrap`}>{it.spec}</td>
                <td className={`border ${bd} px-1 py-0.5 text-right tabular-nums`}>{fmtNum(it.qty)}</td>
                <td className={`border ${bd} px-1 py-0.5 text-right tabular-nums`}>{fmtNum(it.unitPrice)}</td>
                <td className={`border ${bd} px-1 py-0.5 text-right tabular-nums`}>{fmtNum(supply)}</td>
                <td className={`border ${bd} px-1 py-0.5 text-right tabular-nums`}>{fmtNum(vat)}</td>
              </tr>
            );
          })}
          {Array.from({ length: emptyCount }).map((_, i) => (
            <tr key={`e${i}`}>
              <td className={`border ${bd} px-1 py-0.5`}>&nbsp;</td>
              <td className={`border ${bd} px-1 py-0.5`}></td>
              <td className={`border ${bd} px-1 py-0.5`}></td>
              <td className={`border ${bd} px-1 py-0.5`}></td>
              <td className={`border ${bd} px-1 py-0.5`}></td>
              <td className={`border ${bd} px-1 py-0.5`}></td>
              <td className={`border ${bd} px-1 py-0.5`}></td>
              <td className={`border ${bd} px-1 py-0.5`}></td>
              <td className={`border ${bd} px-1 py-0.5`}></td>
            </tr>
          ))}
          <tr className="bg-gray-50 font-bold">
            <td colSpan={5} className={`border ${bd} px-1 py-1 text-right ${lc}`}>합&nbsp;계</td>
            <td className={`border ${bd} px-1 py-1 text-right tabular-nums text-black`}>{fmtNum(qtySum)}</td>
            <td className={`border ${bd}`}></td>
            <td className={`border ${bd} px-1 py-1 text-right tabular-nums text-black`}>{fmtNum(supplySum)}</td>
            <td className={`border ${bd} px-1 py-1 text-right tabular-nums text-black`}>{fmtNum(vatSum)}</td>
          </tr>
        </tbody>
      </table>

      {/* 인수자 / 납품자 / 미수금 */}
      <table className="w-full text-[11px] border-collapse mt-0.5">
        <tbody>
          <tr>
            <td className={`border ${bd} bg-gray-100 text-center px-2 py-1.5 w-20 ${lc}`}>인 수 자</td>
            <td className={`border ${bd} px-2 py-1.5 text-black`}>　　　　　　　 (인)</td>
            <td className={`border ${bd} bg-gray-100 text-center px-2 py-1.5 w-20 ${lc}`}>납 품 자</td>
            <td className={`border ${bd} px-2 py-1.5 text-black`}>{recipientName || "　　　　　　　　　　"}</td>
            <td className={`border ${bd} bg-gray-100 text-center px-2 py-1.5 w-16 ${lc}`}>미수금</td>
            <td className={`border ${bd} px-2 py-1.5 text-right tabular-nums w-24 text-black`}>￦ {fmtNum(totalSum)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="dn-paper bg-white text-black mx-auto shadow-lg print:shadow-none">
        {renderCopy("공급자 보관용", "border-blue-600", "text-blue-700")}
        <div className="border-t-2 border-dashed border-gray-400 my-3 print:my-2"></div>
        {renderCopy("공급받는자 보관용", "border-red-600", "text-red-700")}
      </div>

      <style jsx global>{`
        .dn-paper { width: 210mm; padding: 12mm 10mm; box-sizing: border-box; }
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          body, html { background: white !important; }
          .dn-paper { width: 100% !important; padding: 0 !important; box-shadow: none !important; }
        }
      `}</style>
    </>
  );
}
