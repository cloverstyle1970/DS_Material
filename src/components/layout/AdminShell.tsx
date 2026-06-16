"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, hasMenuPermission, isAdmin } from "@/context/AuthContext";
import { matchMenuHref } from "@/lib/permissions";
import { PAGE_REGISTRY } from "@/lib/page-registry";
import { TabsProvider, useTabs, MAX_TABS } from "@/context/TabsContext";
import { TabActivationProvider } from "@/context/TabActivationContext";
import { useViewMode } from "@/context/ViewModeContext";
import Sidebar from "./Sidebar";
import TabBar from "./TabBar";
import SidebarContext from "@/context/SidebarContext";

function AdminShellInner({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { tabs, activeHref, openTab, setActive, isLimitReached } = useTabs();
  const { viewMode } = useViewMode();
  const isPc = viewMode === "pc";

  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 화면 모드(pc/mobile)에 따라 사이드바 기본 상태를 강제 설정.
  // PC: 펼침(고정), 모바일: 접힘(오버레이). 모드 전환 시에도 재적용.
  useEffect(() => {
    setSidebarOpen(isPc);
  }, [isPc]);

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

  // Service Worker 메시지 수신: push 알림 클릭 → SPA 라우팅
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const handler = (e: MessageEvent) => {
      const data = e.data as { action?: string; link?: string } | undefined;
      if (data?.action === "navigate" && typeof data.link === "string" && data.link.startsWith("/")) {
        router.push(data.link);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [router]);

  // pathname → 탭 자동 동기화 (URL 직접 진입, 뒤로가기, hydration 후 등)
  // tabs를 deps에 포함해 TabsProvider의 localStorage 복원 이후에도 재실행되도록 함
  const prevTabsRef = useRef<typeof tabs>([]);
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const entry = PAGE_REGISTRY[pathname];
    if (!entry) { prevTabsRef.current = tabs; return; }
    // 이미 열려 있으면 activeHref만 동기화 (새로고침 후 active 표시 복원)
    if (tabs.some(t => t.href === pathname)) {
      if (activeHref !== pathname) setActive(pathname);
      prevTabsRef.current = tabs;
      return;
    }
    // 활성 탭 X 클릭으로 닫는 중인 상태:
    // closeTab이 activeHref를 다음 탭으로 바꾼 직후, URL이 아직 옛 pathname을 가리키므로
    // 아래 #2 useEffect의 router.push로 곧 정리됨. 그 사이 방금 닫힌 탭을 다시 추가하지 않도록 보류.
    // 단순히 activeHref ≠ pathname 만으로 판단하면 다른 페이지에서 router.push 로 들어온 경우도
    // 막혀 버리므로, 직전 tabs 에서 pathname 이 제거되었을 때만 skip.
    const wasJustClosed = prevTabsRef.current.some(t => t.href === pathname);
    prevTabsRef.current = tabs;
    if (wasJustClosed) return;
    // me/dashboard/settings/profile/manual는 메뉴 외 공통 페이지 — 권한 체크 우회
    const isAlwaysAllowed = pathname === "/me" || pathname === "/me/notifications" || pathname === "/dashboard" || pathname === "/settings" || pathname === "/data/profile" || pathname === "/manual";
    const allowed = isAlwaysAllowed || isAdmin(user) || hasMenuPermission(user, pathname, "read");
    if (!allowed) return;
    if (isLimitReached) {
      alert(`탭은 최대 ${MAX_TABS}개까지 열 수 있습니다. 다른 탭을 닫고 다시 시도해주세요.`);
      router.replace(activeHref || "/dashboard");
      return;
    }
    openTab(pathname, entry.label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isAuthenticated, user, tabs, activeHref]);

  // activeHref → URL 동기화 (TabBar 탭 클릭으로 활성이 바뀐 경우)
  useEffect(() => {
    if (!activeHref) return;
    if (activeHref !== pathname && PAGE_REGISTRY[activeHref]) {
      router.push(activeHref);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHref]);

  // 모든 탭이 닫혔으면 '내 대시보드' 자동 오픈 (로그인 후 기본 진입 탭)
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (tabs.length === 0) {
      openTab("/me", "내 대시보드");
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
            isPc={isPc}
            onToggle={() => setSidebarOpen(o => !o)}
            onClose={() => setSidebarOpen(false)}
          />
        )}
        <div
          className={[
            "flex-1 flex flex-col min-h-0 overflow-hidden",
            // 모바일 모드: 콘텐츠를 모바일 폭 프레임으로 제한해 모바일 화면을 강제 재현
            isPc ? "" : "mx-auto w-full max-w-md border-x border-gray-200 dark:border-gray-700 shadow-sm",
          ].join(" ")}
        >
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
                      <TabActivationProvider isActive={isVisible}>
                        {entry.render()}
                      </TabActivationProvider>
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
