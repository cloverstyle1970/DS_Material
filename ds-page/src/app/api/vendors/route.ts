import { NextRequest, NextResponse } from "next/server";
import { getVendors, addVendor } from "@/lib/mock-vendors";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q") ?? undefined;
  const type  = req.nextUrl.searchParams.get("type") ?? undefined;
  return NextResponse.json(getVendors(query, type as any));
}

export async function POST(req: NextRequest) {
  const data = await req.json();
  const record = addVendor(data);
  return NextResponse.json(record, { status: 201 });
}
