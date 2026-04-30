import { NextRequest, NextResponse } from "next/server";
import { getMaterials, addMaterial, getNextSeq } from "@/lib/mock-materials";
import { generateMaterialCode } from "@/lib/category-codes";
import { requirePermission, isResponse } from "@/lib/auth-server";

export async function GET(req: NextRequest) {
  const q       = req.nextUrl.searchParams.get("q") ?? undefined;
  const matType = req.nextUrl.searchParams.get("matType");
  const type    = matType === "DS" || matType === "TK" ? matType : undefined;
  return NextResponse.json(getMaterials(q, type));
}

export async function POST(req: NextRequest) {
  const auth = requirePermission(req, "mutate");
  if (isResponse(auth)) return auth;
  const body = await req.json();
  const { directId, categoryCode: directCatCode, isDs, major, mid, sub, isRepair, name, alias, modelNo, unit, buyPrice, sellPrice, storageLoc, stockQty, eCountCd } = body;

  // 수리품 등록 등 직접 ID 지정 경우
  const id = directId ?? (() => {
    const seq = getNextSeq(major, mid, sub, isDs);
    return generateMaterialCode({ isDs, major, mid, sub, seq, isRepair });
  })();
  const categoryCode = directCatCode ?? `${major}${mid}${sub}`;

  const existing = getMaterials().find(m => m.id === id);
  if (existing) return NextResponse.json({ error: `이미 존재하는 코드입니다: ${id}` }, { status: 409 });

  const material = addMaterial({
    id,
    categoryCode,
    name,
    alias: alias || null,
    modelNo: modelNo || null,
    unit: unit || null,
    buyPrice: buyPrice !== undefined && buyPrice !== "" ? Number(buyPrice) : null,
    sellPrice: sellPrice !== undefined && sellPrice !== "" ? Number(sellPrice) : null,
    storageLoc: storageLoc || null,
    stockQty: Number(stockQty) || 0,
    isRepair: isRepair ?? true,
    eCountCd: eCountCd || null,
    createdAt: new Date().toISOString(),
  });

  return NextResponse.json(material, { status: 201 });
}
