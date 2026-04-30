import { NextRequest, NextResponse } from "next/server";
import { getTransactions, addTransaction } from "@/lib/mock-transactions";

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") ?? undefined;
  return NextResponse.json(getTransactions(type));
}

export async function POST(req: NextRequest) {
  const data = await req.json();
  const { record, error } = addTransaction(data);
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json(record, { status: 201 });
}
