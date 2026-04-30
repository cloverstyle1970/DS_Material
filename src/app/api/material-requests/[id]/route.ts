import { NextRequest, NextResponse } from "next/server";
import { updateMaterialRequest, getMaterialRequests } from "@/lib/mock-material-requests";
import { addTransaction } from "@/lib/mock-transactions";
import { requirePermission, isResponse } from "@/lib/auth-server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requirePermission(req, "mutate");
  if (isResponse(auth)) return auth;
  const { id } = await params;
  const numId = Number(id);
  const body = await req.json();
  const { action, processorId, processorName } = body;

  const all = getMaterialRequests();
  const request = all.find(r => r.id === numId);
  if (!request) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (action === "처리중") {
    const updated = updateMaterialRequest(numId, { status: "처리중" });
    return NextResponse.json(updated);
  }

  if (action === "출고처리") {
    // 모든 자재에 대해 출고 트랜잭션 생성 → 재고 감소
    const records = [];
    for (const item of request.items) {
      const { record, error } = addTransaction({
        type: "출고",
        materialId: item.materialId,
        materialName: item.materialName,
        qty: item.qty,
        siteName: request.siteName,
        note: `신청 #${numId} 출고처리${item.elevatorName ? ` (${item.elevatorName})` : ""}`,
        userId: processorId,
        userName: processorName,
      });
      if (error) return NextResponse.json({ error }, { status: 400 });
      records.push(record);
    }
    const updated = updateMaterialRequest(numId, {
      status: "완료",
      processedAt: new Date().toISOString(),
      processorId,
      processorName,
    });
    return NextResponse.json({ request: updated, transactions: records });
  }

  if (action === "취소") {
    const updated = updateMaterialRequest(numId, {
      status: "취소",
      processedAt: new Date().toISOString(),
      processorId,
      processorName,
    });
    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
