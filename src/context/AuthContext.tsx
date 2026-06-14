"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Permission } from "@/lib/mock-users";
import { supabase } from "@/lib/supabase";
import { setStoredViewMode, type ViewMode } from "@/context/ViewModeContext";

export interface AuthUser {
  id: number;
  name: string;
  dept: string;
  permissions: Permission[];
  theme?: "light" | "dark";
  viewMode?: ViewMode; // 화면 레이아웃 모드(pc/mobile) — 환경설정에서 선택, 세션동기화 때 로드
  groupName?: string | null; // 소속 권한그룹명 (비관리자 판정용 — 로그인/세션동기화 때 로드)
}

function applyTheme(theme: "light" | "dark" | null | undefined) {
  if (typeof document === "undefined") return;
  const t = theme === "dark" ? "dark" : "light";
  localStorage.setItem("app-theme", t);
  document.documentElement.classList.toggle("dark", t === "dark");
}

function perms(user: AuthUser): Permission[] {
  return user.permissions ?? [];
}

export function isAdmin(user: AuthUser): boolean {
  return perms(user).includes("admin");
}

// [규정] "비관리자" = 권한그룹이 "보수일반" 또는 "공사일반" 인 사용자(현장 일반 기사).
// 단가·금액·수익금 등 민감 데이터는 이들에게 숨긴다(showFin = !isNonManager). isAdmin과 무관.
const NON_MANAGER_GROUPS = ["보수일반", "공사일반"];
export function isNonManager(user: AuthUser | null): boolean {
  return !!user && NON_MANAGER_GROUPS.includes(user.groupName ?? "");
}

export function isViewOnly(user: AuthUser): boolean {
  if (isAdmin(user)) return false;
  if (perms(user).includes("view_only")) return true;
  return user.dept === "공사팀" || user.dept.startsWith("보수");
}

export function canManageSites(user: AuthUser): boolean {
  return isAdmin(user) || perms(user).includes("site_manage");
}

export function hasMenuPermission(
  user: AuthUser | null,
  href: string,
  type: "read" | "create" | "update" = "read"
): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return perms(user).includes(`menu:${href}:${type}`);
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: () => {},
  logout: () => {},
});

const STORAGE_KEY = "ds_auth_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // 유지보수 사이트(men.daesol.kr)에서 SSO 토큰을 hash로 넘겨온 경우 먼저 setSession.
    // 양쪽이 같은 Supabase 프로젝트라서 access_token/refresh_token을 그대로 신뢰 가능.
    async function consumeSsoHashIfPresent() {
      if (typeof window === "undefined") return;
      const hash = window.location.hash;
      if (!hash.includes("access_token=")) return;
      const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (!accessToken || !refreshToken) return;
      try {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      } catch {
        // 토큰이 유효하지 않거나 만료면 무시 — 평소 syncFromSession이 비세션 분기로 빠짐
      } finally {
        // 토큰이 URL 히스토리에 잔존하지 않도록 즉시 청소
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }

    // Supabase Auth 세션이 단일 진리원. localStorage[STORAGE_KEY]는 화면 표시용 캐시.
    // 세션의 user.email = `${accounts.id}@daesol.el` 규약(daesol.el은 가짜 도메인 — 키 용도).
    async function syncFromSession() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;

        const stored: AuthUser | null = (() => {
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? (JSON.parse(raw) as AuthUser) : null;
          } catch { return null; }
        })();

        if (!session) {
          // Auth 세션 없으면 localStorage 캐시도 무효화 (클라이언트만의 로그인 상태 방지)
          if (stored) localStorage.removeItem(STORAGE_KEY);
          setUser(null);
          return;
        }

        const email = session.user.email ?? "";
        const id = Number(email.split("@")[0]);
        if (!Number.isFinite(id) || id <= 0) {
          await supabase.auth.signOut();
          localStorage.removeItem(STORAGE_KEY);
          setUser(null);
          return;
        }

        const { data: account } = await supabase
          .from("accounts")
          .select("username, permissions, dept, theme, view_mode, permission_group_id")
          .eq("id", id)
          .maybeSingle();

        if (cancelled) return;

        if (account) {
          const permissions = (Array.isArray(account.permissions) ? account.permissions : []) as Permission[];
          const theme = account.theme === "dark" ? "dark" : account.theme === "light" ? "light" : stored?.theme;
          const viewMode: ViewMode = account.view_mode === "mobile" ? "mobile" : "pc";
          let groupName: string | null = null;
          if (account.permission_group_id != null) {
            const { data: g } = await supabase
              .from("permission_groups")
              .select("name")
              .eq("id", account.permission_group_id)
              .maybeSingle();
            if (cancelled) return;
            groupName = g?.name ?? null;
          }
          const freshUser: AuthUser = {
            id,
            name: account.username ?? stored?.name ?? "",
            dept: account.dept ?? "",
            permissions,
            theme,
            viewMode,
            groupName,
          };
          setUser(freshUser);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(freshUser));
          applyTheme(theme);
          setStoredViewMode(viewMode);
        } else {
          // 세션은 있는데 accounts 행이 없음 → 사고. 세션 정리.
          await supabase.auth.signOut();
          localStorage.removeItem(STORAGE_KEY);
          setUser(null);
        }
      } catch {
        // 무시 — 로딩 플래그만 푼다
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    (async () => {
      await consumeSsoHashIfPresent();
      await syncFromSession();
    })();

    // 다른 탭/창에서 로그아웃되면 즉시 반영. SIGNED_IN은 login() 또는 위 bootstrap이 처리.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        localStorage.removeItem(STORAGE_KEY);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  function login(u: AuthUser) {
    // signInWithPassword 는 로그인 페이지에서 이미 호출됨. 여기서는 user state + 캐시만.
    setUser(u);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    applyTheme(u.theme);
    if (u.viewMode) setStoredViewMode(u.viewMode);
  }

  function logout() {
    void supabase.auth.signOut().catch(() => {});
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
