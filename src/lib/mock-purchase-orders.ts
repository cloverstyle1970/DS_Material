// 헤더/라인 분리 스키마 (2026-08-11 이후).
// purchase_orders = 발주서 헤더, purchase_order_lines = 품목 라인.
// 부분입고 지원: received_qty 누적 관리, status='부분입고' 단계 존재.

export type OrderStatus = "발주" | "부분입고" | "입고완료" | "취소";

export interface PurchaseOrderLine {
  id: number;
  orderId: number;
  lineNo: number;
  materialId: string;
  materialName: string;
  qty: number;
  receivedQty: number;
  unitPrice: number | null;
  elevatorName: string | null;
  requestId: number | null;
  note: string | null;
  status: OrderStatus;
}

export interface PurchaseOrderHeader {
  id: number;
  orderNo: string | null;
  status: OrderStatus;
  vendorName: string | null;
  siteName: string | null;
  requesterName: string | null;
  orderedAt: string;
  receivedAt: string | null;
  orderRefNo: string | null;
  formType: "기본" | "긴급" | "수리";
  note: string | null;
  userId: number;
  userName: string;
  shipTo: string | null;
  shipDueDate: string | null;
  shipReceiver: string | null;
  shipContact: string | null;
  shipManager: string | null;
  shipNote: string | null;
}

// GET /api/purchase-orders 는 헤더 + 각 라인을 flat 하게 펼친 배열을 반환.
// (기존 리스트 UI가 라인 단위로 렌더링하므로 backward-compat 유지)
// - id            : line.id
// - orderId       : header.id
// - materialId/qty/receivedQty/unitPrice/elevatorName/requestId : line
// - orderNo/vendorName/siteName/requesterName/ship_* 등 : header
export interface PurchaseOrderRecord {
  id: number;             // line.id (라인 단위 primary key)
  orderId: number;        // header.id (같은 발주서 라인끼리 공유)
  lineNo: number;
  orderNo: string | null;
  status: OrderStatus;    // 라인 상태
  headerStatus: OrderStatus; // 헤더 상태 (표시용)
  materialId: string;
  materialName: string;
  qty: number;
  receivedQty: number;
  vendorName: string | null;
  unitPrice: number | null;
  requestId: number | null;
  siteName: string | null;
  elevatorName: string | null;
  requesterName: string | null;
  note: string | null;       // 라인 note (remark)
  headerNote: string | null; // 헤더 note (참조란)
  orderRefNo: string | null;
  formType: "기본" | "긴급" | "수리";
  userId: number;
  userName: string;
  orderedAt: string;
  receivedAt: string | null;
  shipTo: string | null;
  shipDueDate: string | null;
  shipReceiver: string | null;
  shipContact: string | null;
  shipManager: string | null;
  shipNote: string | null;
}
