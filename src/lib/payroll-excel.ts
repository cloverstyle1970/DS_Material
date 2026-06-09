import * as XLSX from "xlsx";

// ─── 한 시트에 여러 명세서 양식이 세로로 반복되는 형식 ──────────
//
// 블록 구조:
//   [A열 = "no."]                                  ← 명세서 시작 마커
//   D열 = "YY년 MM월분 급여명세서"
//   ...
//   B열 = "회사명:" / "성 명:" / "직 책:" 등 라벨로 인적사항
//   B열 = "월 급 여 지 급 내 역" (병합 셀)         ← 지급/공제 표 시작
//      C/D열 = 지급 항목명, E열 = 지급 금액
//      G/H열 = 공제 항목명, I열 = 공제 금액
//   B열 = "월간 급여 총액"                          ← 표 끝
//      E열 = 지급 합계, I열 = 공제 합계
//   B열 = "실 수령금액:"  F열 = 실수령
//   B열 = "한달동안 수고많으셨습니다..."             ← 명세서 끝

type CellValue = string | number | boolean | null | undefined;

export interface ParsedItem {
  label: string;
  amount: number;
  sort: number;
}

export interface PayrollCalcInfo {
  pay_schedule?: string | null;          // 급여지급일 (예: "매월 10일")
  hourly_wage?: number | null;           // 통상시급
  base_hours?: number | null;            // 기본시간
  overtime_hours?: number | null;        // 당직(가산)
  extra_overtime?: number | null;        // 추가연장근로
  extra_holiday?: number | null;         // 추가휴일근로
  absence_days?: number | null;          // 결근 일수
  tardy_minutes?: number | null;         // 지각 조퇴 시간
  extra_holiday_overtime?: number | null;// 추가휴일연장
}

export interface ParsedPayslip {
  rowIndex: number;
  empName: string;
  dept: string | null;       // 이 양식엔 부서 없음 → null
  rank: string | null;
  birthYymmdd: string | null;
  companyName: string | null;
  gross: number;
  deduction: number;
  net: number;
  earnings: ParsedItem[];
  deductions: ParsedItem[];
  calcInfo: PayrollCalcInfo;
  remark: string | null;
  warnings: string[];
}

export interface ParseResult {
  payslips: ParsedPayslip[];
  warnings: string[];
  sheetName: string;
  allSheets: string[];
  detectedYear: number | null;     // 엑셀에서 추출한 귀속년 (YY → 20YY)
  detectedMonth: number | null;    // 엑셀에서 추출한 귀속월
}

function normalize(s: CellValue): string {
  return String(s ?? "").replace(/\s+/g, "");
}

function trimText(s: CellValue): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function toAmount(v: CellValue): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Math.round(v);
  const cleaned = String(v).replace(/[,\s]/g, "").replace(/[^\d.-]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

const START_MARKER_A = /^no\.?$/i;                // A열에 "no." 가 있으면 명세서 시작
const END_MARKER_B   = /수고\s*많|감사합니다/;     // B열에 마감 문구

function parseBlock(rows: CellValue[][], start: number, end: number): ParsedPayslip | null {
  let empName = "";
  let rank: string | null = null;
  let birthYymmdd: string | null = null;
  let companyName: string | null = null;
  let gross = 0, deduction = 0, net = 0;
  let remark: string | null = null;
  const earnings: ParsedItem[] = [];
  const deductions: ParsedItem[] = [];
  const calcInfo: PayrollCalcInfo = {};

  let itemStartRow = -1, itemEndRow = -1;

  // 숫자 변환 (소수도 허용 — 임금계산 기초사항용)
  const toNum = (v: CellValue): number | null => {
    if (v == null || v === "" || v === "-") return null;
    if (typeof v === "number") return v;
    const cleaned = String(v).replace(/[,\s]/g, "").replace(/[^\d.-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  for (let r = start; r <= end; r++) {
    const row = rows[r] ?? [];
    const b = normalize(row[1]);  // B
    const d = trimText(row[3]);   // D
    const e = row[4];             // E (값 셀로 자주 쓰임)
    const f = normalize(row[5]);  // F
    const fVal = row[5];          // F 값
    const h = trimText(row[7]);   // H (값 셀)
    const hVal = row[7];          // H 값
    const iVal = row[8];          // I

    // 1. 기본 인적사항
    if (/회사명/.test(b)) {
      if (d) companyName = d;
    }
    if (/성\s*명/.test(b) || /성명/.test(b)) {
      if (d) empName = d;
    }
    // 같은 행에 [F=생년월일][H=6자리]
    if (/생년월일/.test(f)) {
      if (h) birthYymmdd = h;
    }
    // 같은 행에 [F=직책][H=값]
    if (/직\s*책/.test(f) || /직책/.test(f) || /직급/.test(f)) {
      if (h) rank = h;
    }

    // 2. 임금계산 기초사항
    // 행 구조: [B=라벨1][D=값1]  [E=라벨2][F=값2]  [H=라벨3][I=값3]
    const labelB = b;          // B 라벨
    const valD = row[3];       // D 값
    const labelE = normalize(row[4]);  // E 라벨
    const valF = row[5];       // F 값
    const labelH = normalize(row[7]);  // H 라벨
    const valI = row[8];       // I 값

    // 좌측 (B, D)
    if (/급여지급일/.test(labelB)) calcInfo.pay_schedule = trimText(valD);
    if (/당직.*가산/.test(labelB))  calcInfo.overtime_hours = toNum(valD);
    if (/결근/.test(labelB))        calcInfo.absence_days  = toNum(valD);

    // 가운데 (E, F)
    if (/통상시급/.test(labelE))      calcInfo.hourly_wage    = toNum(valF);
    if (/추가연장근로/.test(labelE))  calcInfo.extra_overtime = toNum(valF);
    if (/지각.*조퇴/.test(labelE))    calcInfo.tardy_minutes  = toNum(valF);

    // 우측 (H, I)
    if (/기본시간/.test(labelH))      calcInfo.base_hours            = toNum(valI);
    if (/추가휴일근로/.test(labelH))  calcInfo.extra_holiday         = toNum(valI);
    if (/추가휴일연장/.test(labelH))  calcInfo.extra_holiday_overtime = toNum(valI);

    // 3. 임금 지급내역 및 공제내역 범위 마킹
    if (/월급여지급내역/.test(b)) itemStartRow = r;
    if (/월간급여총액|지급총액|급여총액/.test(b)) {
      itemEndRow = r - 1;
      gross = toAmount(row[4]);       // E
      deduction = toAmount(row[8]);   // I
    }
    if (/실수령금액/.test(b)) {
      net = toAmount(row[5]);         // F
    }
  }

  // 양식 외 부가 안내 (예: "* 4월 추가연장 1HR(25,090원) 지급")
  // A~D 열 중 어디에 있어도 잡고, 같은 문구가 셀 병합으로 여러 위치에 나와도 중복 제거
  const remarkSet = new Set<string>();
  for (let r = start; r <= end; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c <= 3; c++) {  // A(0), B(1), C(2), D(3)
      const txt = trimText(row[c]);
      if (txt && /^\*/.test(txt) && !/^\*+\s*$/.test(txt)) {
        remarkSet.add(txt);
      }
    }
  }
  if (remarkSet.size > 0) remark = Array.from(remarkSet).join("\n");

  // 지급/공제 항목 행 추출
  if (itemStartRow >= 0) {
    const ie = itemEndRow >= 0 ? itemEndRow : end;
    let sort = 0;
    for (let r = itemStartRow; r <= ie; r++) {
      const row = rows[r] ?? [];
      // 지급: C열 항목명 (D열은 병합으로 같이 사용), E열 금액
      const earnLabel  = trimText(row[2]);
      const earnAmount = toAmount(row[4]);
      // 공제: G열 항목명 (H열 병합), I열 금액
      const dedLabel   = trimText(row[6]);
      const dedAmount  = toAmount(row[8]);

      // 항목명이 있으면 금액이 0/빈칸이라도 보존 (인쇄 양식에서 항목 라벨 유지)
      if (earnLabel) {
        earnings.push({ label: earnLabel, amount: earnAmount, sort });
      }
      if (dedLabel) {
        deductions.push({ label: dedLabel, amount: dedAmount, sort });
      }
      sort++;
    }
  }

  if (!net) net = gross - deduction;

  // 성명이 없으면 유효하지 않은 블록 (빈 양식 등)
  if (!empName) return null;

  // 무결성 검증
  const earningSum   = earnings.reduce((s, it) => s + it.amount, 0);
  const deductionSum = deductions.reduce((s, it) => s + it.amount, 0);
  const warnings: string[] = [];
  if (gross && earningSum !== gross) {
    warnings.push(`지급 항목 합계(${earningSum.toLocaleString()}) ≠ 월간 급여 총액(${gross.toLocaleString()})`);
  }
  if (deduction && deductionSum !== deduction) {
    warnings.push(`공제 항목 합계(${deductionSum.toLocaleString()}) ≠ 공제 금액 합계(${deduction.toLocaleString()})`);
  }
  if (net && gross - deduction !== net) {
    warnings.push(`실수령(${net.toLocaleString()}) ≠ 지급−공제(${(gross - deduction).toLocaleString()})`);
  }

  return {
    rowIndex: start + 1,
    empName,
    dept: null,
    rank,
    birthYymmdd,
    companyName,
    gross,
    deduction,
    net,
    earnings,
    deductions,
    calcInfo,
    remark,
    warnings,
  };
}

export async function parsePayrollExcel(file: File, preferredSheet?: string): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const sheetNames = wb.SheetNames;
  if (sheetNames.length === 0) throw new Error("엑셀에서 시트를 찾지 못했습니다.");

  // 시트 자동 선택
  let targetSheetName: string | null = null;
  if (preferredSheet && sheetNames.includes(preferredSheet)) {
    targetSheetName = preferredSheet;
  }
  if (!targetSheetName) {
    targetSheetName = sheetNames.find(n => /명세|급여/.test(n)) ?? null;
  }
  // 자동 탐색: A열에 "no." 가 있는 시트
  if (!targetSheetName) {
    for (const name of sheetNames) {
      const s = wb.Sheets[name];
      const rs = XLSX.utils.sheet_to_json<CellValue[]>(s, { header: 1, defval: null }) as CellValue[][];
      if (rs.some(row => START_MARKER_A.test(normalize((row ?? [])[0])))) {
        targetSheetName = name;
        break;
      }
    }
  }
  if (!targetSheetName) targetSheetName = sheetNames[0];

  const sheet = wb.Sheets[targetSheetName];
  const rows = XLSX.utils.sheet_to_json<CellValue[]>(sheet, { header: 1, defval: null }) as CellValue[][];

  const warnings: string[] = [];
  if (sheetNames.length > 1) {
    warnings.push(`시트 ${sheetNames.length}개 중 '${targetSheetName}' 시트를 파싱했습니다.`);
  }

  // 블록 시작 위치(= A열 "no.") 모음
  const blockStarts: number[] = [];
  let detectedYear: number | null = null;
  let detectedMonth: number | null = null;

  for (let r = 0; r < rows.length; r++) {
    const a = normalize((rows[r] ?? [])[0]);
    if (START_MARKER_A.test(a)) {
      blockStarts.push(r);
      // 같은 행의 D열에서 귀속년월 추출 ("26년 05월분 급여명세서")
      if (detectedYear == null) {
        const d = trimText((rows[r] ?? [])[3]);
        const m = d.match(/(\d{2,4})\s*년\s*(\d{1,2})\s*월/);
        if (m) {
          const y = Number(m[1]);
          detectedYear = y < 100 ? 2000 + y : y;
          detectedMonth = Number(m[2]);
        }
      }
    }
  }

  if (blockStarts.length === 0) {
    // 진단 미리보기
    const preview = rows.slice(0, 50).map((row, i) => {
      const cells = (row ?? []).map((c, ci) => c != null && String(c).trim() ? `[${XLSX.utils.encode_col(ci)}]${String(c).replace(/\s+/g, " ").slice(0, 30)}` : "").filter(Boolean);
      return cells.length > 0 ? `${i + 1}행: ${cells.slice(0, 10).join(" | ")}` : null;
    }).filter(Boolean).join("\n");
    throw new Error(
      `시트 '${targetSheetName}' 에서 명세서 시작 마커(A열 "no.")를 찾지 못했습니다.\n` +
      `전체 시트 목록: ${sheetNames.join(" / ")}\n\n` +
      `시트 첫 50행 미리보기:\n${preview}`
    );
  }

  // 각 블록 파싱
  const payslips: ParsedPayslip[] = [];
  for (let i = 0; i < blockStarts.length; i++) {
    const start = blockStarts[i];
    let end = (i + 1 < blockStarts.length) ? blockStarts[i + 1] - 1 : rows.length - 1;
    // 끝마감 문구 (B열 "수고많으셨습니다") 만나면 그 행까지를 종료점으로
    for (let r = start; r <= end; r++) {
      const b = normalize((rows[r] ?? [])[1]);
      if (END_MARKER_B.test(b)) { end = r; break; }
    }
    const parsed = parseBlock(rows, start, end);
    if (parsed) payslips.push(parsed);
  }

  return {
    payslips,
    warnings,
    sheetName: targetSheetName,
    allSheets: sheetNames,
    detectedYear,
    detectedMonth,
  };
}
