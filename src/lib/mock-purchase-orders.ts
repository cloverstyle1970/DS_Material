export type OrderStatus = "발주" | "입고완료" | "취소";

export interface PurchaseOrderRecord {
  id: number;
  orderNo: string | null;  // 발주번호 (B-YY-MM-NNN) — 같은 batch 행에 동일값
  status: OrderStatus;
  materialId: string;
  materialName: string;
  qty: number;
  vendorName: string | null;
  unitPrice: number | null;
  requestId: number | null;
  siteName: string | null;
  elevatorName: string | null;
  requesterName: string | null;
  note: string | null;
  userId: number;
  userName: string;
  orderedAt: string;
  receivedAt: string | null;
  batchId: string | null;
  // 발송지/납품 기록란 (발주서 인쇄용, batch 단위 — 같은 batch 행에 중복 저장)
  shipTo:       string | null;
  shipDueDate:  string | null;
  shipReceiver: string | null;
  shipContact:  string | null;
  shipManager:  string | null;
  shipNote:     string | null;
}

const orders: PurchaseOrderRecord[] = [];
let nextId = 1;

export function getPurchaseOrders(status?: string): PurchaseOrderRecord[] {
  const result = [...orders].reverse();
  if (status) return result.filter(o => o.status === status);
  return result;
}

export function addPurchaseOrder(data: Omit<PurchaseOrderRecord, "id" | "status" | "orderedAt" | "receivedAt">): PurchaseOrderRecord {
  const record: PurchaseOrderRecord = {
    ...data,
    id: nextId++,
    status: "발주",
    orderedAt: new Date().toISOString(),
    receivedAt: null,
  };
  orders.push(record);
  return record;
}

export function updatePurchaseOrder(id: number, patch: Partial<PurchaseOrderRecord>): PurchaseOrderRecord | null {
  const idx = orders.findIndex(o => o.id === id);
  if (idx === -1) return null;
  orders[idx] = { ...orders[idx], ...patch };
  return orders[idx];
}
