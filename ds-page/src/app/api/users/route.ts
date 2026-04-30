import { NextRequest, NextResponse } from "next/server";
import { getUsers, addUser } from "@/lib/mock-users";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? undefined;
  return NextResponse.json(getUsers(q));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const user = addUser(body);
  return NextResponse.json(user, { status: 201 });
}
