"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Permission } from "@/lib/mock-users";
import { supabase } from "@/lib/supabase";

export interface AuthUser {
  id: number;
  name: string;
  dept: string;
  permissions: Permission[];
  theme?: "light" | "dark";
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
    const t = setTimeout(async () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          // 신DB accounts 에서 최신 권한·부서·테마 갱신 (재로그인 없이 반영)
          const { data: account } = await supabase
            .from("accounts")
            .select("username, name, permissions, dept, theme")
            .eq("id", parsed.id)
            .maybeSingle();

          let freshUser: AuthUser = parsed;
          if (account) {
            // accounts.permissions 가 단일 진리원. role 컬럼은 표시용일 뿐 권한에 영향 없음.
            const permissions = (Array.isArray(account.permissions) ? account.permissions : []) as Permission[];
            const theme = account.theme === "dark" ? "dark" : account.theme === "light" ? "light" : parsed.theme;

            freshUser = {
              ...parsed,
              name: account.username ?? parsed.name,
              dept: account.dept ?? "",
              permissions,
              theme,
            };
            applyTheme(theme);
          } else {
            applyTheme(parsed.theme);
          }

          setUser(freshUser);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(freshUser));
        }
      } catch {}
      setIsLoading(false);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  function login(u: AuthUser) {
    setUser(u);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    applyTheme(u.theme);
  }

  function logout() {
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
