import { NextRequest, NextResponse } from "next/server";
import { updateSite, deleteSite } from "@/lib/mock-sites";
import { requirePermission, isResponse } from "@/lib/auth-server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requirePermission(req, "manage_sites");
  if (isResponse(auth)) return auth;
  const { id } = await params;
  const patch = await req.json();
  const updated = updateSite(Number(id), patch);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requirePermission(req, "manage_sites");
  if (isResponse(auth)) return auth;
  const { id } = await params;
  const ok = deleteSite(Number(id));
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
