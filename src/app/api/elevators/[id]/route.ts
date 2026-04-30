import { NextRequest, NextResponse } from "next/server";
import { updateElevator, deleteElevator } from "@/lib/mock-elevators";
import { requirePermission, isResponse } from "@/lib/auth-server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requirePermission(req, "manage_sites");
  if (isResponse(auth)) return auth;
  const { id } = await params;
  const body  = await req.json();
  const record = updateElevator(Number(id), body);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(record);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requirePermission(req, "manage_sites");
  if (isResponse(auth)) return auth;
  const { id } = await params;
  const ok = deleteElevator(Number(id));
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
