"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, hasMenuPermission, isAdmin } from "@/context/AuthContext";
import { matchMenuHref } from "@/lib/permissions";
import { PAGE_REGISTRY } from "@/lib/page-registry";
import { TabsProvider, useTabs, MAX_TABS } from "@/context/TabsContext";
import { TabActivationProvider } from "@/context/TabActivationContext";
import { useViewMode } from "@/context/ViewModeContext";
import { supabase } from "@/lib/supabase";
import Sidebar from "./Sidebar";
import TabBar from "./TabBar";
import SidebarContext from "@/context/SidebarContext";

// 권한 없이도 승인자로 지정된 경우 접근 허용할 페이지
const APPROVER_GATED: Record<string, string> = {
  "/hr/overtime-ledger": "overtime_reports",
  "/hr/leave-ledger":    "leave_requests",
};

function AdminShellInner({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { tabs, activeHref, openTab, setActive, isLimitReached } = useTabs();
  const { viewMode } = useViewMode();
  const isPc = viewMode === "pc";

  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 메뉴 권한 없이도 승인자로 지정돼 접근이 허용된 href 목록
  const [approverGranted, setApproverGranted] = useState<Set<string>>(new Set());
  const approverCheckingRef = useRef<Set<string>>(new Set());

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
    if (!canonicalHref) return;
    if (hasMenuPermission(user, canonicalHref, "read")) return;
    if (approverGranted.has(canonicalHref)) return;

    const table = APPROVER_GATED[canonicalHref];
    if (!table) { router.replace("/dashboard"); return; }

    // 승인자 여부 비동기 확인 (중복 요청 방지)
    if (approverCheckingRef.current.has(canonicalHref)) return;
    approverCheckingRef.current.add(canonicalHref);
    supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("approver_id", user.id)
      .limit(1)
      .then(({ count }) => {
        approverCheckingRef.current.delete(canonicalHref);
        if ((count ?? 0) > 0) {
          setApproverGranted(prev => new Set([...prev, canonicalHref]));
        } else {
          router.replace("/dashboard");
        }
      });
  }, [pathname, user, isLoading, isAuthenticated, router, approverGranted]);

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
    const allowed = isAlwaysAllowed || isAdmin(user) || hasMenuPermission(user, pathname, "read") || approverGranted.has(pathname);
    if (!allowed) return;
    if (isLimitReached) {
      alert(`탭은 최대 ${MAX_TABS}개까지 열 수 있습니다. 다른 탭을 닫고 다시 시도해주세요.`);
      router.replace(activeHref || "/dashboard");
      return;
    }
    openTab(pathname, entry.label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isAuthenticated, user, tabs, activeHref, approverGranted]);

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
    if (!canonical) return false;
    if (hasMenuPermission(user, canonical, "read")) return false;
    return !approverGranted.has(canonical);
  })();

  const showShell = !isLoading && isAuthenticated;
  const isPathATab = !!PAGE_REGISTRY[pathname];

  return (
    <SidebarContext.Provider value={{ openSidebar: () => setSidebarOpen(true) }}>
      <div className="ds-admin-shell flex h-full bg-gray-50 dark:bg-gray-900">
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
            "ds-admin-main flex-1 flex flex-col min-h-0 overflow-hidden",
            // 모바일 모드: 콘텐츠를 모바일 폭 프레임으로 제한해 모바일 화면을 강제 재현
            isPc ? "" : "mx-auto w-full max-w-md border-x border-gray-200 dark:border-gray-700 shadow-sm",
          ].join(" ")}
        >
          {showShell && !blockedByPermission && (
            <>
              <TabBar />
              {/* 탭 페이지: 등록된 모든 탭을 마운트하고 현재 pathname에 매칭되는 탭만 표시.
                  서브 라우트(예: /inbound/new)면 모든 탭을 숨기고 children 표시. */}
              <div className="ds-admin-tabs flex-1 min-h-0 relative">
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

      {/* 글로벌 인쇄 격리 — 페이지 자체 인쇄(예: 견적서 상세) 시 사이드바·탭바를 숨기고,
          본문의 absolute 탭 컨테이너를 페이지 흐름으로 풀어 콘텐츠가 종이 박스에 자연 배치되게 한다.
          모달에서 portal로 띄우는 인쇄(발주서·견적 입력)와는 무관 — portal은 body 직접 자식이라
          여기 셀렉터 적용 대상이 아님. */}
      <style jsx global>{`
        @media print {
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          /* 사이드바 등 chrome 숨김 (.ds-admin-main이 아닌 외곽 자식) */
          .ds-admin-shell > *:not(.ds-admin-main) { display: none !important; }
          /* TabBar 등 본문 외 chrome 숨김 (.ds-admin-tabs가 아닌 메인 자식) */
          .ds-admin-main > *:not(.ds-admin-tabs) { display: none !important; }
          /* flex 컨테이너 풀어 페이지 흐름으로 */
          .ds-admin-shell, .ds-admin-main {
            display: block !important;
            height: auto !important;
            overflow: visible !important;
          }
          .ds-admin-tabs {
            position: static !important;
            min-height: 0 !important;
            overflow: visible !important;
          }
          /* 활성 탭(absolute + inline style display:flex) 만 페이지 흐름으로 풀기 */
          .ds-admin-tabs > div[style*="display: flex"],
          .ds-admin-tabs > div[style*="display:flex"] {
            position: static !important;
            inset: auto !important;
            overflow: visible !important;
          }
        }
      `}</style>
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
