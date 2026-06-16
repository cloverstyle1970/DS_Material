import { AuthUser, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "./supabase";

/**
 * 견적요청·자재신청 가시성 범위 — 같은 팀(users.dept) 사원의 user.id 목록을 반환.
 * - admin                         → null  (전체 조회: 호출 측에서 .in() 적용 생략)
 * - menuHref + read 권한 부여자    → null  (권한그룹에서 메뉴 read 권한을 받은 경우 전체 조회)
 * - dept 없음                     → [user.id]  (본인만)
 * - dept 있음                     → 같은 dept 사원 전원의 id (본인 포함)
 *
 * 조(crew) 단위 공유는 현재 사용하지 않음. 조 구조는 /hr/team-crew 조직도 관리용.
 */
export async function visibleUserIds(
  user: AuthUser,
  menuHref?: string,
): Promise<number[] | null> {
  if (isAdmin(user)) return null;
  if (menuHref && hasMenuPermission(user, menuHref, "read")) return null;
  const dept = (user.dept ?? "").trim();
  if (!dept) return [user.id];
  const { data } = await supabase.from("accounts").select("id").eq("dept", dept);
  const ids = (data ?? []).map(r => r.id as number);
  return ids.length ? ids : [user.id];
}
