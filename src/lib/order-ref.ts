/**
 * 발주 참조번호 추출 — `purchase_orders.order_no`(자동채번 `B-YY-MM-NNN`) 도입 전에
 * 들어온 발주(외부 시스템 경로)는 참조번호가 `note` 컬럼의 첫 `[...]` 태그에
 * `MNG2026MMNNN` 형태로 저장되어 있다. formType 태그(`[긴급]`, `[수리]`)는
 * 참조번호가 아니므로 제외한다.
 *
 * 표시 우선순위: `order_no` > `extractOrderRef(note)` > `"-"`.
 */
export function extractOrderRef(note: string | null | undefined): string {
  if (!note) return "";
  const m = note.match(/^\[([^\]]+)\]/);
  if (!m) return "";
  const tag = m[1];
  if (tag === "긴급" || tag === "수리") return "";
  return tag;
}
