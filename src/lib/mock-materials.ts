import partListJson from "@/data/part-list.json";

export interface MaterialRecord {
  id: string;
  categoryCode: string;
  name: string;
  alias: string | null;
  modelNo: string | null;
  unit: string | null;
  buyPrice: number | null;
  sellPrice: number | null;
  storageLoc: string | null;
  stockQty: number;
  isRepair: boolean;
  eCountCd: string | null;
  createdAt: string;
}

let materials: MaterialRecord[] = partListJson as MaterialRecord[];

export function getMaterials(query?: string, matType?: "DS" | "TK"): MaterialRecord[] {
  let list = materials;
  if (matType === "DS") list = list.filter(m => m.id.startsWith("D"));
  if (matType === "TK") list = list.filter(m => !m.id.startsWith("D"));
  if (!query) return list;
  const q = query.toLowerCase();
  return list.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      (m.alias?.toLowerCase().includes(q) ?? false) ||
      (m.modelNo?.toLowerCase().includes(q) ?? false) ||
      (m.storageLoc?.toLowerCase().includes(q) ?? false)
  );
}

export function getNextSeq(major: string, mid: string, sub: string, isDs: boolean): number {
  const prefix = isDs ? "D" : "_";
  const pattern = `${prefix}${major}${mid}${sub}`;
  const existing = materials
    .filter((m) => m.id.startsWith(pattern))
    .map((m) => parseInt(m.id.slice(7, 11), 10))
    .filter(Number.isFinite);
  return existing.length > 0 ? Math.max(...existing) + 1 : 1;
}

export function addMaterial(material: MaterialRecord): MaterialRecord {
  materials = [material, ...materials];
  return material;
}

export function updateStock(id: string, qty: number): MaterialRecord | null {
  const idx = materials.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  materials[idx] = { ...materials[idx], stockQty: qty };
  return materials[idx];
}

/**
 * 재고 증감을 단일 동기 호출로 처리한다.
 * 호출 중간에 await가 들어가지 않도록 사용처는 절대 await을 끼우지 말 것.
 *
 * 반환:
 *   - 성공: { material, prevStock, afterStock }
 *   - 자재 없음: { error: "NOT_FOUND" }
 *   - 재고 부족: { error: "INSUFFICIENT", prevStock }
 */
export type AdjustStockResult =
  | { material: MaterialRecord; prevStock: number; afterStock: number; error?: undefined }
  | { error: "NOT_FOUND";   prevStock?: undefined; afterStock?: undefined; material?: undefined }
  | { error: "INSUFFICIENT"; prevStock: number; afterStock?: undefined; material?: undefined };

export function adjustStock(id: string, delta: number): AdjustStockResult {
  const idx = materials.findIndex((m) => m.id === id);
  if (idx === -1) return { error: "NOT_FOUND" };
  const prevStock = materials[idx].stockQty;
  const afterStock = prevStock + delta;
  if (afterStock < 0) return { error: "INSUFFICIENT", prevStock };
  materials[idx] = { ...materials[idx], stockQty: afterStock };
  return { material: materials[idx], prevStock, afterStock };
}

export function updateMaterial(id: string, patch: Partial<Omit<MaterialRecord, "id" | "categoryCode" | "createdAt">>): MaterialRecord | null {
  const idx = materials.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  materials[idx] = { ...materials[idx], ...patch };
  return materials[idx];
}
