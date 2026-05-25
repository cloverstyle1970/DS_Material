/**
 * 자재 구분(DS/TK) 표시 스타일 공통 유틸.
 *
 * 자재코드(12자리)의 첫 글자가 'D' 면 DS(자사) 자재, 그 외(공백 등)는 TKE(외부) 자재.
 * 자재 리스트가 출력되는 모든 화면·출력물에서 TK 자재의 자재명·코드를
 * 파란색으로 표시하기 위한 단일 진리원.
 */

/** TK(외부) 자재 여부 — 자재코드 첫 글자가 'D'가 아니면 TK */
export function isTkMaterial(materialId: string | null | undefined): boolean {
  return !!materialId && !materialId.startsWith("D");
}

/** 수리품 여부 — 자재코드 기반 판별 (DS는 끝 글자 'R', TK는 첫 글자 'A') */
export function isRepairMaterial(materialId: string | null | undefined): boolean {
  if (!materialId) return false;
  return materialId.startsWith("D") ? materialId.endsWith("R") : materialId.startsWith("A");
}

/** 화면(라이트/다크 공용) TK 텍스트 색 */
export const TK_TEXT_CLASS = "text-blue-600 dark:text-blue-400";

/** 인쇄 문서(항상 흰 종이) TK 텍스트 색 */
export const TK_PRINT_TEXT_CLASS = "text-blue-700";

/**
 * 화면 리스트용 — TK면 파란색, 아니면 기존(base) 색 그대로 유지.
 * @param materialId 자재코드
 * @param base       DS·미상일 때 유지할 기존 텍스트 색 클래스
 */
export function tkTextClass(materialId: string | null | undefined, base = ""): string {
  return isTkMaterial(materialId) ? TK_TEXT_CLASS : base;
}

/**
 * 인쇄 문서용(흰 종이 고정) — TK면 파란색, 아니면 base.
 * @param materialId 자재코드
 * @param base       DS·미상일 때 유지할 기존 텍스트 색 클래스
 */
export function tkPrintTextClass(materialId: string | null | undefined, base = ""): string {
  return isTkMaterial(materialId) ? TK_PRINT_TEXT_CLASS : base;
}
