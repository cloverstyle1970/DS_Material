import { NextRequest, NextResponse } from "next/server";
import { getUsers, type UserRecord, type Permission } from "@/lib/mock-users";

/**
 * 서버측 권한 가드.
 *
 * MVP 한계: 진짜 세션 토큰 대신 클라이언트가 X-User-Id 헤더로 user.id를 전달한다.
 * 헤더는 위변조 가능하므로 본격적인 보안 경계로 봐선 안 되고, 우발적 우회를 막는 1차
 * 가드 역할만 한다. (향후 httpOnly 세션 쿠키로 대체 예정.)
 */

export type Action = "mutate" | "manage_sites";

function isAdmin(u: UserRecord): boolean {
  return (u.permissions ?? []).includes("admin");
}

function isViewOnly(u: UserRecord): boolean {
  if (isAdmin(u)) return false;
  if ((u.permissions ?? []).includes("view_only")) return true;
  return u.dept === "공사팀" || (u.dept?.startsWith("보수") ?? false);
}

export interface AuthContext {
  user: UserRecord;
}

function readUser(req: NextRequest): UserRecord | null {
  const id = req.headers.get("x-user-id");
  if (!id) return null;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return null;
  return getUsers().find(u => u.id === numId) ?? null;
}

/**
 * 라우트 핸들러 진입부에서 호출. 권한 부족 시 NextResponse를 반환.
 * 호출부는 반환값이 NextResponse면 그대로 return, 아니면 user를 사용.
 */
export function requirePermission(
  req: NextRequest,
  action: Action,
): NextResponse | AuthContext {
  const user = readUser(req);
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } },
      { status: 401 },
    );
  }

  if (action === "mutate" && isViewOnly(user)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "조회 전용 권한입니다." } },
      { status: 403 },
    );
  }

  if (action === "manage_sites") {
    const ok = isAdmin(user) || (user.permissions ?? []).includes("site_manage");
    if (!ok) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "현장 관리 권한이 필요합니다." } },
        { status: 403 },
      );
    }
  }

  return { user };
}

export function isResponse(v: NextResponse | AuthContext): v is NextResponse {
  return v instanceof NextResponse;
}

export type { Permission };
