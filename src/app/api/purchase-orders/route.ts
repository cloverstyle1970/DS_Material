import { NextRequest, NextResponse } from "next/server";
import { getPurchaseOrders, addPurchaseOrder } from "@/lib/mock-purchase-orders";
import { requirePermission, isResponse } from "@/lib/auth-server";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  return NextResponse.json(getPurchaseOrders(status));
}

export async function POST(req: NextRequest) {
  const auth = requirePermission(req, "mutate");
  if (isResponse(auth)) return auth;
  const data = await req.json();
  const record = addPurchaseOrder(data);
  return NextResponse.json(record, { status: 201 });
}
