/**
 * 공용 숫자 표시 포맷 유틸
 *
 * 모든 페이지·팝업에서 화면에 숫자를 표시할 때 사용한다.
 * - 천 단위 구분 콤마 (1,000)
 * - null/undefined/NaN/0 안전 처리
 * - 입출고·재고·수량·금액 모두 공통 사용. 단, 자재코드는 제외.
 *
 * 사용자 입력란 onChange 자동 포맷은 `input-format.ts` 참조.
 */

/** 일반 숫자(금액·수량·재고) → 천 단위 콤마. null/undefined/NaN은 "0". */
export function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "0";
  return n.toLocaleString();
}

/** 빈 값을 placeholder(기본 "-")로 표시. 0은 "0"으로 유지. */
export function fmtNumOr(n: number | null | undefined, placeholder = "-"): string {
  if (n == null || Number.isNaN(n)) return placeholder;
  return n.toLocaleString();
}

/** 입력 문자열 → 숫자 (콤마/공백 제거). 빈 값은 0. */
export function parseNum(s: string): number {
  const v = String(s ?? "").replace(/[^0-9.\-]/g, "");
  if (v === "" || v === "-" || v === ".") return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}
