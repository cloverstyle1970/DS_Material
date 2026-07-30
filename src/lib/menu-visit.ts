import type { AuthUser } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

/**
 * 시스템접속통계용 "메뉴 방문" 기록.
 * openTab() 이 실제로 새 탭을 추가한 경우(added=true)에만 호출.
 * 이미 열린 탭 재클릭·탭바 스위칭은 카운트하지 않는다.
 * 실패해도 UI 흐름은 진행 — 콘솔 경고만.
 */
export function recordMenuVisit(user: AuthUser | null, href: string, label: string) {
  if (!user) return;
  void supabase.from("menu_visits").insert({
    user_id: user.id,
    username: user.name,
    href,
    menu_label: label,
  }).then(({ error }) => {
    if (error) console.warn("[menu-visit] 기록 실패:", error.message);
  });
}
