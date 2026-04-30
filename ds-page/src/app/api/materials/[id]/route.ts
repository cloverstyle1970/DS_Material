import { NextRequest, NextResponse } from "next/server";
import { updateStock, updateMaterial } from "@/lib/mock-materials";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  if (Object.keys(body).length === 1 && "stockQty" in body) {
    const updated = updateStock(decodeURIComponent(id), Number(body.stockQty));
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(updated);
  }

  const { stockQty, name, alias, modelNo, unit, buyPrice, sellPrice, storageLoc, isRepair } = body;
  const updated = updateMaterial(decodeURIComponent(id), {
    ...(name        !== undefined && { name }),
    ...(alias       !== undefined && { alias:      alias || null }),
    ...(modelNo     !== undefined && { modelNo:    modelNo || null }),
    ...(unit        !== undefined && { unit:       unit || null }),
    ...(buyPrice    !== undefined && { buyPrice:   buyPrice !== "" ? Number(buyPrice) : null }),
    ...(sellPrice   !== undefined && { sellPrice:  sellPrice !== "" ? Number(sellPrice) : null }),
    ...(storageLoc  !== undefined && { storageLoc: storageLoc || null }),
    ...(stockQty    !== undefined && { stockQty:   Number(stockQty) }),
    ...(isRepair    !== undefined && { isRepair }),
  });
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
}
