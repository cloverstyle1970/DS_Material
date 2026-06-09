"use client";

import type { PayrollCalcInfo } from "@/lib/payroll-excel";

interface PayslipItem {
  id: number;
  type: "earning" | "deduction";
  label: string;
  amount: number;
  sort: number;
}

interface Payslip {
  id: number;
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
  items: PayslipItem[];
}

interface Props {
  year: number;
  month: number;
  payDate: string;
  payslip: Payslip;
  allPayslips: Payslip[];   // 미사용 (1페이지 1명) — 추후 전체 일괄 인쇄 확장용으로 보존
  currentIndex: number;
}

function fmt(n: number): string {
  return n.toLocaleString("ko-KR");
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "-";
  // 정수면 그대로, 소수면 1자리로 (통상시급 71770.33… → 71,770.3)
  if (Number.isInteger(n)) return n.toLocaleString("ko-KR");
  return Number(n.toFixed(1)).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const FIXED_EARNING_ROWS = 12;
const FIXED_DEDUCTION_ROWS = 12;

const CALC_METHOD_LINES = [
  "1. 일할계산 : 월임금 / 당월총일수 * (당월재직일수-결근등)",
  "2. 근태공제 : 통상시급 * 시각 또는 조퇴 시간",
  "3. 추가연장수당 : 통상시급 * 연장시간 * 1.5",
  "4. 추가휴일수당 : 통상시급 * 휴일근로시간 * 1.5 (8시간을 초과하는 부분은 2.0)",
  "5. 고용보험 : 당월급여 * 0.9%",
  "6. 건강보험 : 2026년 건강보험 고시금액 반영",
  "7. 장기요양 : 2026년 장기요양보험 고시금액 반영",
  "8. 국민연금 : 2026년 국민연금 고시금액 반영",
  "9. 근로소득세 : 국세청 간이세액표 적용",
  "10. 주민세 : 근로소득세 * 10%",
];

export function PayslipCard({ payslip, year, month, payDate, no }: {
  payslip: Payslip;
  year: number;
  month: number;
  payDate: string;
  no: number;
}) {
  const earnings = payslip.items.filter(i => i.type === "earning").sort((a, b) => a.sort - b.sort);
  const deductions = payslip.items.filter(i => i.type === "deduction").sort((a, b) => a.sort - b.sort);
  const info = payslip.calc_info ?? {};
  const yy = String(year).slice(-2);

  const earnRows = Array.from({ length: Math.max(FIXED_EARNING_ROWS, earnings.length) }, (_, i) => earnings[i] ?? null);
  const dedRows = Array.from({ length: Math.max(FIXED_DEDUCTION_ROWS, deductions.length) }, (_, i) => deductions[i] ?? null);

  return (
    <div className="payslip-card border-2 border-black bg-white text-black flex flex-col" style={{ fontFamily: "'맑은 고딕', 'Malgun Gothic', sans-serif" }}>
      {/* 상단 헤더 */}
      <div className="flex items-center border-b-2 border-black px-2 py-1.5">
        <div className="text-[8px] w-12 flex items-baseline gap-1">
          <span>no.</span>
          <span className="font-bold">{no}</span>
        </div>
        <div className="flex-1 text-center text-base font-black tracking-wider">{yy}년 {String(month).padStart(2, "0")}월분 급여명세서</div>
        <div className="w-12" />
      </div>

      {/* 1. 기본 인적사항 */}
      <div className="px-2 pt-1.5">
        <div className="text-[9px] font-bold mb-0.5">1. 기본 인적사항</div>
        <table
          className="w-full border-collapse text-[8px]"
          style={{ tableLayout: "fixed" }}
        >
          <tbody>
            <tr>
              <th className="border border-black bg-gray-100 px-0.5 py-0.5 text-center" style={{ width: "18%", whiteSpace: "nowrap" }}>회사명:</th>
              <td className="border border-black px-1 py-0.5 text-center" style={{ width: "32%", whiteSpace: "nowrap", overflow: "hidden" }}>{payslip.company_name ?? "㈜대솔이엘"}</td>
              <th className="border border-black bg-gray-100 px-0.5 py-0.5 text-center" style={{ width: "18%", whiteSpace: "nowrap" }}>생년월일 :</th>
              <td className="border border-black px-1 py-0.5 text-center" style={{ width: "32%", whiteSpace: "nowrap" }}>{payslip.birth_yymmdd ?? "-"}</td>
            </tr>
            <tr>
              <th className="border border-black bg-gray-100 px-0.5 py-0.5 text-center" style={{ whiteSpace: "nowrap" }}>성 명:</th>
              <td className="border border-black px-1 py-0.5 text-center font-semibold" style={{ whiteSpace: "nowrap" }}>{payslip.emp_name}</td>
              <th className="border border-black bg-gray-100 px-0.5 py-0.5 text-center" style={{ whiteSpace: "nowrap" }}>직 책 :</th>
              <td className="border border-black px-1 py-0.5 text-center" style={{ whiteSpace: "nowrap" }}>{payslip.rank ?? "-"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 2. 임금계산 기초사항 및 임금지급일 — 셀이 좁으면 폰트 자동 축소 (white-space: nowrap) */}
      <div className="px-2 pt-1.5">
        <div className="text-[9px] font-bold mb-0.5">2. 임금계산 기초사항 및 임금지급일</div>
        <table
          className="w-full border-collapse text-[7px]"
          style={{ tableLayout: "fixed" }}
        >
          <tbody>
            <tr>
              <th className="border border-black bg-gray-100 px-0.5 py-0.5 text-center" style={{ width: "20%", whiteSpace: "nowrap" }}>급여지급일 :</th>
              <td className="border border-black px-1 py-0.5 text-center" style={{ width: "13%", whiteSpace: "nowrap", overflow: "hidden" }}>{info.pay_schedule ?? (payDate ? payDate : "매월 10일")}</td>
              <th className="border border-black bg-gray-100 px-0.5 py-0.5 text-center" style={{ width: "17%", whiteSpace: "nowrap" }}>통상시급 :</th>
              <td className="border border-black px-1 py-0.5 text-right" style={{ width: "14%", whiteSpace: "nowrap" }}>
                {info.hourly_wage != null ? Math.round(info.hourly_wage).toLocaleString("ko-KR") : "-"}
              </td>
              <th className="border border-black bg-gray-100 px-0.5 py-0.5 text-center" style={{ width: "17%", whiteSpace: "nowrap" }}>기본시간:</th>
              <td className="border border-black px-1 py-0.5 text-right" style={{ width: "19%", whiteSpace: "nowrap" }}>{fmtNum(info.base_hours)}</td>
            </tr>
            <tr>
              <th className="border border-black bg-gray-100 px-0.5 py-0.5 text-center" style={{ whiteSpace: "nowrap" }}>당직(가산) :</th>
              <td className="border border-black px-1 py-0.5 text-right" style={{ whiteSpace: "nowrap" }}>{fmtNum(info.overtime_hours)}</td>
              <th className="border border-black bg-gray-100 px-0.5 py-0.5 text-center" style={{ whiteSpace: "nowrap" }}>추가연장근로 :</th>
              <td className="border border-black px-1 py-0.5 text-right" style={{ whiteSpace: "nowrap" }}>{fmtNum(info.extra_overtime)}</td>
              <th className="border border-black bg-gray-100 px-0.5 py-0.5 text-center" style={{ whiteSpace: "nowrap" }}>추가휴일근로 :</th>
              <td className="border border-black px-1 py-0.5 text-right" style={{ whiteSpace: "nowrap" }}>{fmtNum(info.extra_holiday)}</td>
            </tr>
            <tr>
              <th className="border border-black bg-gray-100 px-0.5 py-0.5 text-center" style={{ whiteSpace: "nowrap" }}>결근 일수</th>
              <td className="border border-black px-1 py-0.5 text-right" style={{ whiteSpace: "nowrap" }}>{fmtNum(info.absence_days)}</td>
              <th className="border border-black bg-gray-100 px-0.5 py-0.5 text-center" style={{ whiteSpace: "nowrap" }}>지각 조퇴 시간</th>
              <td className="border border-black px-1 py-0.5 text-right" style={{ whiteSpace: "nowrap" }}>{fmtNum(info.tardy_minutes)}</td>
              <th className="border border-black bg-gray-100 px-0.5 py-0.5 text-center" style={{ whiteSpace: "nowrap" }}>추가휴일연장</th>
              <td className="border border-black px-1 py-0.5 text-right" style={{ whiteSpace: "nowrap" }}>{fmtNum(info.extra_holiday_overtime)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 3. 임금 지급내역 및 공제내역 */}
      <div className="px-2 pt-1.5">
        <div className="text-[9px] font-bold mb-0.5">3. 임금 지급내역 및 공제내역</div>
        <table className="w-full border-collapse text-[8px]">
          <thead>
            <tr>
              <th className="border border-black bg-gray-100 px-1 py-0.5 text-center" colSpan={3}>항 목</th>
              <th className="border border-black bg-gray-100 px-1 py-0.5 text-center">금 액</th>
              <th className="border border-black bg-gray-100 px-1 py-0.5 text-center" colSpan={3}>항 목</th>
              <th className="border border-black bg-gray-100 px-1 py-0.5 text-center">금 액</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.max(earnRows.length, dedRows.length) }).map((_, i) => {
              const e = earnRows[i];
              const d = dedRows[i];
              const isFirst = i === 0;
              const earnRowSpan = isFirst ? earnRows.length : 0;
              const dedRowSpan = isFirst ? dedRows.length : 0;
              return (
                <tr key={i} style={{ height: "14px" }}>
                  {isFirst && (
                    <th
                      className="border border-black bg-gray-50 text-center align-middle font-bold"
                      style={{
                        width: "4%",
                        writingMode: "vertical-rl",
                        textOrientation: "upright",
                        letterSpacing: "0.05em",
                      }}
                      rowSpan={earnRowSpan}
                    >
                      월급여지급내역
                    </th>
                  )}
                  <td className="border border-black px-1 py-0 text-center" colSpan={2}>{e?.label ?? ""}</td>
                  <td className="border border-black px-1 py-0 text-right tabular-nums">{e && e.amount !== 0 ? fmt(e.amount) : ""}</td>
                  {isFirst && (
                    <th
                      className="border border-black bg-gray-50 text-center align-middle font-bold"
                      style={{
                        width: "4%",
                        writingMode: "vertical-rl",
                        textOrientation: "upright",
                        letterSpacing: "0.05em",
                      }}
                      rowSpan={dedRowSpan}
                    >
                      4대보험및제세공과금등
                    </th>
                  )}
                  <td className="border border-black px-1 py-0 text-center" colSpan={2}>{d?.label ?? ""}</td>
                  <td className="border border-black px-1 py-0 text-right tabular-nums">{d && d.amount !== 0 ? fmt(d.amount) : ""}</td>
                </tr>
              );
            })}
            {/* 합계 행 */}
            <tr style={{ height: "16px" }}>
              <th className="border-2 border-black bg-gray-200 px-1 py-0.5 text-center" colSpan={3}>월간 급여 총액</th>
              <td className="border-2 border-black bg-gray-100 px-1 py-0.5 text-right tabular-nums font-bold">{fmt(payslip.gross)}</td>
              <th className="border-2 border-black bg-gray-200 px-1 py-0.5 text-center" colSpan={3}>공제 금액 합계</th>
              <td className="border-2 border-black bg-gray-100 px-1 py-0.5 text-right tabular-nums font-bold">{fmt(payslip.deduction)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 실 수령금액 */}
      <div className="px-2 pt-2 text-center">
        <span className="text-base font-black tracking-wider">실 수령금액:</span>
        <span className="text-xl font-black ml-2 tabular-nums">₩{fmt(payslip.net)}</span>
      </div>

      {/* 양식 외 부가 안내 — 원본 엑셀에서 빨간색으로 강조되어 동일하게 표시 */}
      {payslip.remark && (
        <div className="px-2 pt-1 text-[8px] font-semibold whitespace-pre-line" style={{ color: "#dc2626" }}>
          {payslip.remark}
        </div>
      )}

      {/* 4. 항목별 계산방법 — 내용을 박스로 묶어서 출력 */}
      <div className="px-2 pt-1.5">
        <div className="text-[9px] font-bold mb-0.5">4. 항목별 계산방법</div>
        <div className="text-[7px] leading-snug border border-black p-1.5">
          {CALC_METHOD_LINES.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      </div>

      {/* 하단 마감 문구 */}
      <div className="mt-auto px-2 pt-2 pb-1 text-center text-[8px] italic">
        한달동안 수고많으셨습니다. 감사합니다.
      </div>
    </div>
  );
}

export default function PayslipPrintPaper({ year, month, payDate, payslip, currentIndex }: Props) {
  const no = currentIndex + 1;

  return (
    <>
      <style jsx global>{`
        @page {
          size: A4 landscape;
          margin: 8mm;
        }
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body * {
            visibility: hidden !important;
          }
          .payslip-paper,
          .payslip-paper * {
            visibility: visible !important;
          }
          .payslip-paper {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            width: 100% !important;
            box-shadow: none !important;
            margin: 0 !important;
            display: flex !important;
            justify-content: center !important;
            align-items: flex-start !important;
          }
        }
      `}</style>

      {/* A4 가로 1페이지 = 1명. 가운데 정렬, 폭 98mm, 상하 여백 약 5%(10.5mm)씩 */}
      <div
        className="payslip-paper bg-white mx-auto shadow-md print:shadow-none flex justify-center items-start"
        style={{ width: "281mm", padding: "10.5mm 0", boxSizing: "border-box" }}
      >
        <div style={{ width: "98mm" }}>
          <PayslipCard payslip={payslip} year={year} month={month} payDate={payDate} no={no} />
        </div>
      </div>
    </>
  );
}
