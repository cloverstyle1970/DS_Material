// 현장관리 일괄 등록용 빈 엑셀 양식 생성기.
// 실행: node scripts/generate-sites-template.mjs
// 결과: 프로젝트 루트에 `현장관리_양식.xlsx`
//
// 시트 구성:
//   1) 현장        — sites 테이블 컬럼 (한글 헤더, 예시 1행)
//   2) 호기        — elevators 테이블 컬럼 (현장명으로 연결)
//   3) 비상통화장치 — sites.emergency_devices(JSON)를 풀어 입력하는 보조 시트

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "현장관리_양식.xlsx");

// ── 시트 1: 현장 ──────────────────────────────────────────────
const SITE_HEADERS = [
  "현장명",            // name (필수)
  "회사구분",          // company_type — TK / DS / (공란)
  "계약구분",          // contract_type — 유지보수 / 하자 / FM 등
  "계약일자",          // contract_date — YYYY-MM-DD
  "계약시작",          // contract_start
  "계약만료",          // contract_end
  "주점검자",          // primary_inspector
  "보조점검자1",       // sub_inspector
  "보조점검자2",       // sub_inspector2
  "현장전화",          // site_phone
  "현장핸드폰",        // site_mobile
  "팩스",              // fax
  "담당자HP",          // manager_phone
  "담당자메일",        // manager_email
  "소재지",            // address
  "출입정보",          // entry_info
  "거래처",            // vendor
  "고객메일",          // customer_email
  "Job번호",           // job_no
  "비고",              // note
  "하자기대수",        // warranty_count (정수)
  "하자기호기정보",    // warranty_units (메모)
  "하자기간시작",      // warranty_start
  "하자기간종료",      // warranty_end
];

const SITE_SAMPLE = {
  "현장명":         "예시 빌딩",
  "회사구분":       "TK",
  "계약구분":       "유지보수",
  "계약일자":       "2026-05-12",
  "계약시작":       "2026-05-12",
  "계약만료":       "2027-05-11",
  "주점검자":       "홍길동",
  "보조점검자1":    "",
  "보조점검자2":    "",
  "현장전화":       "031-000-0000",
  "현장핸드폰":     "010-0000-0000",
  "팩스":           "",
  "담당자HP":       "010-1111-2222",
  "담당자메일":     "manager@example.com",
  "소재지":         "경기도 ○○시 ○○로 1",
  "출입정보":       "",
  "거래처":         "",
  "고객메일":       "",
  "Job번호":        "",
  "비고":           "",
  "하자기대수":     2,
  "하자기호기정보": "1호기, 3호기",
  "하자기간시작":   "2026-05-12",
  "하자기간종료":   "2027-05-11",
};

// ── 시트 2: 호기 ──────────────────────────────────────────────
const ELEVATOR_HEADERS = [
  "현장명",        // site_name — 시트1의 현장명과 정확히 일치해야 매칭
  "호기명",        // unit_name (예: 1호기)
  "승강기번호",    // elevator_no
  "비상통화장치",  // emergency_phone
];

const ELEVATOR_SAMPLE_ROWS = [
  { "현장명": "예시 빌딩", "호기명": "1호기", "승강기번호": "2163209", "비상통화장치": "012-2080-3565" },
  { "현장명": "예시 빌딩", "호기명": "2호기", "승강기번호": "2163210", "비상통화장치": "" },
];

// ── 시트 3: 비상통화장치 (현장 단위, 다건 보조 입력) ─────────
const DEVICE_HEADERS = [
  "현장명",  // 시트1의 현장명과 일치
  "번호",    // 비상통화장치 번호
  "비고",    // 예: "1~3호기"
];

const DEVICE_SAMPLE_ROWS = [
  { "현장명": "예시 빌딩", "번호": "012-2080-3565", "비고": "1~3호기" },
];

// ── 시트 4: 안내 ──────────────────────────────────────────────
const README_ROWS = [
  { 항목: "필수 컬럼", 설명: "[현장] 현장명 / [호기] 현장명·호기명" },
  { 항목: "현장명 매칭", 설명: "호기·비상통화장치 시트의 '현장명'은 시트1 '현장명'과 정확히 동일해야 매칭" },
  { 항목: "날짜 형식", 설명: "YYYY-MM-DD (예: 2026-05-12). 시스템 등록 폼은 8자리 입력(20260512)도 허용." },
  { 항목: "회사구분 값", 설명: "TK / DS / (공란=기타)" },
  { 항목: "하자기간",   설명: "하자기 대수가 0 또는 비어있으면 하자 정보 표시 생략 가능" },
  { 항목: "비상통화장치", 설명: "호기별은 [호기] 시트의 비상통화장치 컬럼, 현장 단위 다건은 [비상통화장치] 시트 사용" },
];

// ── 빌드 ──────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();

const wsSite = XLSX.utils.json_to_sheet([SITE_SAMPLE], { header: SITE_HEADERS });
const wsElevator = XLSX.utils.json_to_sheet(ELEVATOR_SAMPLE_ROWS, { header: ELEVATOR_HEADERS });
const wsDevice = XLSX.utils.json_to_sheet(DEVICE_SAMPLE_ROWS, { header: DEVICE_HEADERS });
const wsReadme = XLSX.utils.json_to_sheet(README_ROWS, { header: ["항목", "설명"] });

// 컬럼 폭 보기 좋게 설정
function setColWidths(ws, widths) {
  ws["!cols"] = widths.map(w => ({ wch: w }));
}
setColWidths(wsSite, [
  20, 8, 10, 12, 12, 12, 10, 10, 10, 14, 14, 12, 14, 22, 30, 12, 14, 22, 12, 24, 10, 22, 12, 12,
]);
setColWidths(wsElevator, [20, 10, 14, 16]);
setColWidths(wsDevice, [20, 16, 18]);
setColWidths(wsReadme, [16, 80]);

XLSX.utils.book_append_sheet(wb, wsSite, "현장");
XLSX.utils.book_append_sheet(wb, wsElevator, "호기");
XLSX.utils.book_append_sheet(wb, wsDevice, "비상통화장치");
XLSX.utils.book_append_sheet(wb, wsReadme, "안내");

const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
writeFileSync(OUT, buf);
console.log(`생성됨: ${OUT}`);
