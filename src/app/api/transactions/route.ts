import { NextRequest, NextResponse } from "next/server";
import { getTransactions, addTransaction } from "@/lib/mock-transactions";
import { requirePermission, isResponse } from "@/lib/auth-server";

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") ?? undefined;
  return NextResponse.json(getTransactions(type));
}

export async function POST(req: NextRequest) {
  const auth = requirePermission(req, "mutate");
  if (isResponse(auth)) return auth;
  const data = await req.json();
  const { record, error } = addTransaction(data);
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json(record, { status: 201 });
}
