import { NextRequest, NextResponse } from "next/server";
import { getElevators, addElevator } from "@/lib/mock-elevators";

export async function GET(req: NextRequest) {
  const siteName = req.nextUrl.searchParams.get("site") ?? undefined;
  return NextResponse.json(getElevators(siteName));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { siteName, unitName, elevatorNo } = body;
  if (!siteName) return NextResponse.json({ error: "siteName 필수" }, { status: 400 });
  const record = addElevator({ siteName, unitName: unitName || null, elevatorNo: elevatorNo || null });
  return NextResponse.json(record, { status: 201 });
}
