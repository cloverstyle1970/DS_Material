"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, hasMenuPermission, isAdmin } from "@/context/AuthContext";
import { matchMenuHref } from "@/lib/permissions";
import { PAGE_REGISTRY } from "@/lib/page-registry";
import { TabsProvider, useTabs, MAX_TABS } from "@/context/TabsContext";
import Sidebar from "./Sidebar";
import TabBar from "./TabBar";
import SidebarContext from "@/context/SidebarContext";

function AdminShellInner({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { tabs, activeHref, openTab, isLimitReached } = useTabs();

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

  // 라우트 가드
  useEffect(() => {
    if (isLoading || !isAuthenticated || !user) return;
    if (isAdmin(user)) return;
    const canonicalHref = matchMenuHref(pathname);
    if (canonicalHref && !hasMenuPermission(user, canonicalHref, "read")) {
      router.replace("/dashboard");
    }
  }, [pathname, user, isLoading, isAuthenticated, router]);

  // pathname → 탭 자동 동기화 (URL 직접 진입, 뒤로가기 등)
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const entry = PAGE_REGISTRY[pathname];
    if (entry) {
      const allowed = isAdmin(user) || hasMenuPermission(user, pathname, "read");
      if (allowed) {
        const alreadyOpen = tabs.some(t => t.href === pathname);
        if (!alreadyOpen && isLimitReached) {
          alert(`탭은 최대 ${MAX_TABS}개까지 열 수 있습니다. 다른 탭을 닫고 다시 시도해주세요.`);
          router.replace(activeHref || "/dashboard");
          return;
        }
        openTab(pathname, entry.label);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isAuthenticated, user]);

  // activeHref → URL 동기화 (TabBar 탭 클릭으로 활성이 바뀐 경우)
  useEffect(() => {
    if (!activeHref) return;
    if (activeHref !== pathname && PAGE_REGISTRY[activeHref]) {
      router.push(activeHref);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHref]);

  // 모든 탭이 닫혔으면 대시보드 자동 오픈
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (tabs.length === 0) {
      openTab("/dashboard", "대시보드");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length, isAuthenticated, user]);

  const blockedByPermission = (() => {
    if (!user || isAdmin(user)) return false;
    const canonical = matchMenuHref(pathname);
    return !!canonical && !hasMenuPermission(user, canonical, "read");
  })();

  const showShell = !isLoading && isAuthenticated;
  const isPathATab = !!PAGE_REGISTRY[pathname];

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
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {showShell && !blockedByPermission && (
            <>
              <TabBar />
              {/* 탭 페이지: 등록된 모든 탭을 마운트하고 현재 pathname에 매칭되는 탭만 표시.
                  서브 라우트(예: /inbound/new)면 모든 탭을 숨기고 children 표시. */}
              <div className="flex-1 min-h-0 relative">
                {tabs.map(tab => {
                  const entry = PAGE_REGISTRY[tab.href];
                  if (!entry) return null;
                  const isVisible = isPathATab && tab.href === pathname;
                  return (
                    <div
                      key={tab.href}
                      className="absolute inset-0 flex flex-col overflow-auto"
                      style={{ display: isVisible ? "flex" : "none" }}
                    >
                      {entry.render()}
                    </div>
                  );
                })}
                {!isPathATab && (
                  <div className="absolute inset-0 flex flex-col overflow-auto">
                    {children}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </SidebarContext.Provider>
  );
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <TabsProvider>
      <AdminShellInner>{children}</AdminShellInner>
    </TabsProvider>
  );
}
