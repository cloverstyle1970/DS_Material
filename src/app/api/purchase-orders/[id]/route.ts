import { NextRequest, NextResponse } from "next/server";
import { updatePurchaseOrder, getPurchaseOrders } from "@/lib/mock-purchase-orders";
import { addTransaction } from "@/lib/mock-transactions";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = Number(id);
  const body = await req.json();
  const { action, userId, userName } = body;

  const all = getPurchaseOrders();
  const order = all.find(o => o.id === numId);
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (action === "입고완료") {
    // 입고 트랜잭션 생성 → 재고 증가
    const { record, error } = addTransaction({
      type: "입고",
      materialId: order.materialId,
      materialName: order.materialName,
      qty: order.qty,
      siteName: null,
      note: `발주 #${numId} 입고완료`,
      userId,
      userName,
    });
    if (error) return NextResponse.json({ error }, { status: 400 });
    const updated = updatePurchaseOrder(numId, {
      status: "입고완료",
      receivedAt: new Date().toISOString(),
    });
    return NextResponse.json({ order: updated, transaction: record });
  }

  if (action === "취소") {
    const updated = updatePurchaseOrder(numId, { status: "취소" });
    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
