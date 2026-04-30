"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Permission } from "@/lib/mock-users";

export interface AuthUser {
  id: number;
  name: string;
  dept: string;
  permissions: Permission[];
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
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // 구버전 localStorage에 permissions 없을 경우 보정
        setUser({ ...parsed, permissions: parsed.permissions ?? [] });
      }
    } catch {}
    setIsLoading(false);
  }, []);

  function login(u: AuthUser) {
    setUser(u);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
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
