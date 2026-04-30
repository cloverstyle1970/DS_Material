import { NextRequest, NextResponse } from "next/server";
import {
  getCategories, addMajor, updateMajor, deleteMajor,
  addMid, updateMid, deleteMid,
  addSub, updateSub, deleteSub,
} from "@/lib/mock-categories";

export async function GET() {
  return NextResponse.json(getCategories());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { level, majorCode, midCode, label } = body;

  if (level === "major") return NextResponse.json(addMajor(label), { status: 201 });
  if (level === "mid") return NextResponse.json(addMid(majorCode, label), { status: 201 });
  if (level === "sub") return NextResponse.json(addSub(majorCode, midCode, label), { status: 201 });
  return NextResponse.json({ error: "invalid level" }, { status: 400 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { level, majorCode, midCode, code, label } = body;

  if (level === "major") { updateMajor(code, label); return NextResponse.json({ ok: true }); }
  if (level === "mid") { updateMid(majorCode, code, label); return NextResponse.json({ ok: true }); }
  if (level === "sub") { updateSub(majorCode, midCode, code, label); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: "invalid level" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { level, majorCode, midCode, code } = body;

  if (level === "major") { deleteMajor(code); return NextResponse.json({ ok: true }); }
  if (level === "mid") { deleteMid(majorCode, code); return NextResponse.json({ ok: true }); }
  if (level === "sub") { deleteSub(majorCode, midCode, code); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: "invalid level" }, { status: 400 });
}
