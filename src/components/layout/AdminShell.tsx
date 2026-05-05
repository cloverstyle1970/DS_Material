"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, hasMenuPermission, isAdmin } from "@/context/AuthContext";
import { matchMenuHref } from "@/lib/permissions";
import Sidebar from "./Sidebar";
import SidebarContext from "@/context/SidebarContext";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // 데스크탑(md 이상)에서는 사이드바 기본 열림, 모바일에서는 닫힘
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (window.innerWidth >= 768) {
      setSidebarOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  // 라우트 가드: 메뉴 진입점에 read 권한이 없으면 대시보드로 리다이렉트
  useEffect(() => {
    if (isLoading || !isAuthenticated || !user) return;
    if (isAdmin(user)) return;
    const canonicalHref = matchMenuHref(pathname);
    if (canonicalHref && !hasMenuPermission(user, canonicalHref, "read")) {
      router.replace("/dashboard");
    }
  }, [pathname, user, isLoading, isAuthenticated, router]);

  const showShell = !isLoading && isAuthenticated;
  // 권한 없는 메뉴 진입 시 children 렌더 차단 (리다이렉트 진행 중 깜빡임 방지)
  const blockedByPermission = (() => {
    if (!user || isAdmin(user)) return false;
    const canonical = matchMenuHref(pathname);
    return !!canonical && !hasMenuPermission(user, canonical, "read");
  })();

  return (
    <SidebarContext.Provider value={{ openSidebar: () => setSidebarOpen(true) }}>
      <div className="flex h-full bg-gray-50 dark:bg-gray-900">
        {showShell && (
          <Sidebar
            open={sidebarOpen}
            onToggle={() => setSidebarOpen(o => !o)}
            onClose={() => setSidebarOpen(false)}
          />
        )}
        <div className="flex-1 flex flex-col min-h-0 overflow-auto">
          {showShell ? (blockedByPermission ? null : children) : null}
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
