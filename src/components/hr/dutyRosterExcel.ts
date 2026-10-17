// 월 근무표 엑셀·PDF 업로드, 엑셀 양식.
// 회사 근무표 양식("YY년 M월 근무자 명단"): 날짜 | 요일 | 사무실 숙직(2칸) | 숙직보조 | 파주대기(2칸) | 야간점검
//  - ○○숙직·숙직보조 → 당직 (평일=평일당직, 토·일·공휴일=휴일당직)
//  - ○○대기·파주○○   → 고장대기 (평일=고장대기, 토·일·공휴일=휴일고장대기)
//  - 야간점검        → 야간점검 (22:00~익일 06:00, 잔업 8H, 다음날 퇴근)
//  - 머리글이 평일당직·휴일당직·고장대기·휴일고장대기 이면 그 구분 그대로

import * as XLSX from "xlsx";
import { DOW_KR, empName, parseKey, ymd, type Employee } from "./attendanceShared";
import { DUTY_KINDS, type DutyKind } from "./workHoursCalc";
import { pdfItemsToSheet, readPdfItems, type SheetLike } from "./dutyRosterPdf";

export interface ParsedDuty { duty_date: string; account_id: number; duty_type: DutyKind; name: string; source: string; }
export interface ParseResult {
  year: number;
  month: number;
  entries: ParsedDuty[];
  errors: string[];
  ignored: string[]; // 저장하지 않는 열 (야간점검 등)
}

type ColRole = { group: string; role: "duty" | "standby" | DutyKind | "skip" };

function roleOf(group: string): ColRole["role"] {
  const g = group.replace(/\s/g, "");
  if ((DUTY_KINDS as string[]).includes(g)) return g as DutyKind;
  if (g.includes("야간점검")) return "야간점검"; // 평일·휴일 구분 없음
  if (g.includes("파주") || g.includes("대기")) return "standby"; // 파주는 숙직 표기여도 고장대기
  if (g.includes("숙직") || g.includes("당직")) return "duty";
  return "skip";
}

const splitNames = (v: unknown) => String(v ?? "").split(/[,，/\n·]+|\s+/).map(x => x.trim()).filter(Boolean);

// 날짜 셀: 엑셀 날짜(serial) 우선, 숫자 1~31·"10/1"·"2026-10-01" 도 허용
function parseDateCell(v: unknown, year: number, month: number): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    if (Number.isInteger(v) && v >= 1 && v <= 31) return ymd(year, month, v);
    const d = XLSX.SSF.parse_date_code(v);
    return d ? ymd(d.y, d.m, d.d) : null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\D+(\d{1,2})$/);
  if (m) return ymd(year, +m[1], +m[2]);
  m = s.match(/^(\d{1,2})일?$/);
  if (m) return ymd(year, month, +m[1]);
  return null;
}

// 엑셀(.xlsx/.xls) 또는 텍스트 PDF 근무표 → 등록 항목
export async function parseRosterFile(
  file: File,
  fallback: { year: number; month: number },
  candidates: Employee[],
  loadHolidays: (year: number, month: number) => Promise<Set<string>>,
): Promise<ParseResult> {
  let sheet: SheetLike;
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    const res = pdfItemsToSheet(await readPdfItems(file));
    if ("error" in res) return { ...fallback, entries: [], errors: [res.error], ignored: [] };
    sheet = res;
  } else {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
    const headerIdx = aoa.findIndex(r => r.some(c => ["날짜", "일자"].includes(String(c).replace(/\s/g, ""))));
    if (headerIdx < 0) return { ...fallback, entries: [], errors: ["'날짜' 머리글을 찾을 수 없습니다."], ignored: [] };
    const header = aoa[headerIdx].map(c => String(c ?? "").trim());
    // 병합된 머리글을 열마다 펼침 (사무실 숙직 C:D → C,D 모두 '사무실 숙직')
    const groups = [...header];
    for (const mg of ws["!merges"] ?? []) {
      if (mg.s.r > headerIdx || mg.e.r < headerIdx) continue;
      const name = String(aoa[mg.s.r]?.[mg.s.c] ?? "").trim();
      for (let c = mg.s.c; c <= mg.e.c; c++) groups[c] = name;
    }
    sheet = { aoa, groups, headerIdx, dateCol: header.findIndex(c => ["날짜", "일자"].includes(c.replace(/\s/g, ""))) };
  }
  return parseSheet(sheet, fallback, candidates, loadHolidays);
}

async function parseSheet(
  { aoa, groups, headerIdx, dateCol }: SheetLike,
  fallback: { year: number; month: number },
  candidates: Employee[],
  loadHolidays: (year: number, month: number) => Promise<Set<string>>,
): Promise<ParseResult> {
  const errors: string[] = [];
  const ignored = new Set<string>();
  const entries: ParsedDuty[] = [];

  // 대상 연월: 제목("26년 10월 근무자 명단") → 없으면 화면의 월
  let { year, month } = fallback;
  const title = aoa.slice(0, 5).flat().map(String).find(t => /\d{2,4}\s*년\s*\d{1,2}\s*월/.test(t));
  const tm = title?.match(/(\d{2,4})\s*년\s*(\d{1,2})\s*월/);
  if (tm) { year = tm[1].length === 2 ? 2000 + +tm[1] : +tm[1]; month = +tm[2]; }

  const cols: { i: number; group: string; role: Exclude<ColRole["role"], "skip"> }[] = [];
  groups.forEach((g, i) => {
    if (!g || i === dateCol || g.replace(/\s/g, "") === "요일") return;
    const role = roleOf(g);
    if (role === "skip") ignored.add(g);
    else cols.push({ i, group: g, role });
  });
  if (!cols.length) return { year, month, entries, errors: ["숙직·대기(또는 평일당직 등) 열을 찾을 수 없습니다."], ignored: [...ignored] };

  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const holidays = await loadHolidays(year, month);
  const isOff = (key: string) => { const w = parseKey(key).getDay(); return w === 0 || w === 6 || holidays.has(key); };
  const byName = new Map(candidates.map(e => [empName(e), e.id]));
  const seen = new Set<string>();

  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!cols.some(({ i }) => String(row[i] ?? "").trim())) continue;
    const date = parseDateCell(row[dateCol], year, month);
    if (!date) { errors.push(`${r + 1}행: 날짜 '${row[dateCol]}'를 읽을 수 없습니다.`); continue; }
    if (!date.startsWith(prefix)) { errors.push(`${r + 1}행: ${date}는 ${year}년 ${month}월이 아닙니다.`); continue; }
    const off = isOff(date);
    for (const { i, group, role } of cols) {
      const kind: DutyKind = role === "duty" ? (off ? "휴일당직" : "평일당직")
        : role === "standby" ? (off ? "휴일고장대기" : "고장대기")
        : role;
      for (const name of splitNames(row[i])) {
        const id = byName.get(name);
        if (id == null) { errors.push(`${r + 1}행 ${group}: '${name}' 사원을 찾을 수 없습니다.`); continue; }
        const key = `${date}|${id}|${kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ duty_date: date, account_id: id, duty_type: kind, name, source: group });
      }
    }
  }
  return { year, month, entries, errors, ignored: [...ignored] };
}

// 회사 양식과 같은 형태의 빈 근무표
export function downloadTemplate(year: number, month: number) {
  const last = new Date(year, month, 0).getDate();
  const rows: unknown[][] = [
    [` ${String(year).slice(2)}년 ${month}월 근무자 명단`], [], [],
    ["날짜", "요일", "사무실 숙직", "", "숙직보조", "파주대기", "", "야간점검", ""],
    [],
  ];
  for (let d = 1; d <= last; d++) {
    const key = ymd(year, month, d);
    rows.push([d, DOW_KR[parseKey(key).getDay()]]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 2, c: 5 } },
    { s: { r: 3, c: 0 }, e: { r: 4, c: 0 } }, { s: { r: 3, c: 1 }, e: { r: 4, c: 1 } },
    { s: { r: 3, c: 2 }, e: { r: 4, c: 3 } }, { s: { r: 3, c: 4 }, e: { r: 4, c: 4 } },
    { s: { r: 3, c: 5 }, e: { r: 4, c: 6 } }, { s: { r: 3, c: 7 }, e: { r: 4, c: 8 } },
  ];
  ws["!cols"] = [{ wch: 6 }, { wch: 5 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, `${year}.${String(month).padStart(2, "0")} 근무표.xlsx`);
}
