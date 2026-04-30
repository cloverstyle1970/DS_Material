import { NextRequest, NextResponse } from "next/server";
import { getSites, addSite } from "@/lib/mock-sites";
import { requirePermission, isResponse } from "@/lib/auth-server";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? undefined;
  return NextResponse.json(getSites(q));
}

export async function POST(req: NextRequest) {
  const auth = requirePermission(req, "manage_sites");
  if (isResponse(auth)) return auth;
  const body = await req.json();
  const site = addSite(body);
  return NextResponse.json(site, { status: 201 });
}
