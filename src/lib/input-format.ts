/**
 * 공용 입력 자동 포맷 유틸
 *
 * 모든 페이지·컴포넌트의 날짜·전화번호·주민번호 입력 onChange에서 사용한다.
 * 모든 함수는 순수함수이며 빈 문자열도 안전하게 처리한다.
 */

// ============================================================
// 날짜 — YYYYMMDD → YYYY-MM-DD
// ------------------------------------------------------------
// 사용자가 "20260514" 입력 시 "2026-05-14"로 자동 변환.
// 8자리 초과는 절단. type="date" 가 아닌 type="text"용.
// ============================================================
export function formatDate(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}

// ============================================================
// 전화번호 — 휴대폰·서울(02)·지역번호·대표번호·인터넷 전화 통합
// ------------------------------------------------------------
// 예시 입력 → 출력
//   01047021608      → 010-4702-1608   (휴대폰 11자리)
//   0102345678       → 010-234-5678    (휴대폰 10자리, 구형)
//   023532255        → 02-353-2255     (서울 9자리)
//   0223532255       → 02-2353-2255    (서울 10자리)
//   0314561234       → 031-456-1234    (지역 10자리)
//   03145612345      → 031-4561-2345   (지역 11자리)
//   15881234         → 1588-1234       (대표번호 4-4)
//   07012345678      → 070-1234-5678   (인터넷전화)
// ============================================================
export function formatPhone(value: string): string {
  const d = value.replace(/\D/g, "");
  if (d.length === 0) return "";

  // 02 — 서울 (2자리 국번)
  if (d.startsWith("02")) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `02-${d.slice(2)}`;
    if (d.length <= 9) return `02-${d.slice(2, 5)}-${d.slice(5)}`;        // 02-XXX-XXXX (9)
    return `02-${d.slice(2, 6)}-${d.slice(6, 10)}`;                       // 02-XXXX-XXXX (10)
  }

  // 1588, 1577 등 4자리 대표번호 (0으로 시작 안함)
  if (!d.startsWith("0") && d.length >= 1 && d[0] === "1") {
    if (d.length <= 4) return d;
    return `${d.slice(0, 4)}-${d.slice(4, 8)}`;
  }

  // 0XX — 휴대폰/지역(3자리 국번)
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;   // 0XX-XXX-XXXX (10)
  // 11자리: 0XX-XXXX-XXXX (휴대폰 표준)
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
}

// ============================================================
// 금액/수량 — 입력 중 천 단위 콤마 자동 삽입
// ------------------------------------------------------------
// 정수만 지원 (소수점 없는 통화 입력 기준). 음수는 허용하지 않음.
// 빈 값은 빈 문자열 반환 (placeholder 유지).
// 저장 시 숫자 변환은 `parseNum` (format.ts) 사용.
// ============================================================
export function formatMoney(value: string | number | null | undefined): string {
  if (value == null) return "";
  const d = String(value).replace(/[^0-9]/g, "");
  if (d === "") return "";
  return Number(d).toLocaleString();
}

// ============================================================
// 주민등록번호 — 13자리 → XXXXXX-XXXXXXX
// ============================================================
export function formatSsn(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 13);
  if (d.length <= 6) return d;
  return d.slice(0, 6) + "-" + d.slice(6);
}

// ============================================================
// 주민번호 7번째 자리로 성별 자동 추정
// 1·3·5·7 → 남, 2·4·6·8 → 여
// ============================================================
export function genderFromSsn(ssn: string): "M" | "F" | "" {
  const d = ssn.replace(/\D/g, "");
  if (d.length < 7) return "";
  const c = d[6];
  if ("1357".includes(c)) return "M";
  if ("2468".includes(c)) return "F";
  return "";
}
