import { NextRequest, NextResponse } from "next/server";
import { getMaterialRequests, addMaterialRequest } from "@/lib/mock-material-requests";
import { requirePermission, isResponse } from "@/lib/auth-server";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  return NextResponse.json(getMaterialRequests(status));
}

export async function POST(req: NextRequest) {
  const auth = requirePermission(req, "mutate");
  if (isResponse(auth)) return auth;
  const data = await req.json();
  const record = addMaterialRequest(data);
  return NextResponse.json(record, { status: 201 });
}
