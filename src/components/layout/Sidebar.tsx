"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, isViewOnly, isAdmin } from "@/context/AuthContext";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
};

type NavGroup = {
  id: string;
  label: string;
  color: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "data",
    label: "데이터관리",
    color: "text-sky-400",
    items: [
      { href: "/data/users",     label: "사용자 관리",    icon: "👤", adminOnly: true },
      { href: "/data/vendors",   label: "거래처 관리",    icon: "🤝" },
    ],
  },
  {
    id: "site",
    label: "현장관리",
    color: "text-emerald-400",
    items: [
      { href: "/site/units",     label: "현장/호기 관리",  icon: "🏢" },
    ],
  },
  {
    id: "material",
    label: "자재관리",
    color: "text-amber-400",
    items: [
      { href: "/material",         label: "자재품목 관리",      icon: "🗄️" },
      { href: "/requests",         label: "자재 신청 관리",     icon: "📋" },
      { href: "/purchase-orders",  label: "발주 관리",          icon: "📑" },
      { href: "/inbound",          label: "입고 관리",          icon: "📥" },
      { href: "/outbound",         label: "출고 관리",          icon: "📤" },
      { href: "/returns",          label: "회수/반납 관리",     icon: "↩️" },
      { href: "/stats/period",     label: "기간별 입출고 내역", icon: "📅" },
      { href: "/stats/sites",      label: "현장/호기별 현황",   icon: "📍" },
      { href: "/inventory-check",  label: "재고실사",           icon: "📊", adminOnly: true },
    ],
  },
  {
    id: "safety",
    label: "산업안전",
    color: "text-rose-400",
    items: [
      { href: "#safety", label: "준비중", icon: "🛡️" }
    ],
  },
  {
    id: "construction",
    label: "공사일정",
    color: "text-orange-400",
    items: [
      { href: "/construction/schedule", label: "일정 캘린더", icon: "📅" },
      { href: "/construction/requests", label: "공사 요청", icon: "📝" }
    ],
  },
  {
    id: "hr",
    label: "관리/인사",
    color: "text-purple-400",
    items: [
      { href: "#hr", label: "준비중", icon: "👥" }
    ],
  },
  {
    id: "accounting",
    label: "회계/세무",
    color: "text-indigo-400",
    items: [
      { href: "#accounting", label: "준비중", icon: "💳" }
    ],
  }
];

interface Props {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export default function Sidebar({ open, onToggle, onClose }: Props) {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, logout } = useAuth();
  const viewOnly = user ? isViewOnly(user) : false;
  const admin    = !viewOnly;

  function handleNavClick() {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      onClose();
    }
  }

  function isActive(href: string) {
    if (href === "/requests") return pathname === "/requests" || pathname.startsWith("/requests/");
    if (href === "/purchase-orders") return pathname === "/purchase-orders" || pathname.startsWith("/purchase-orders/");
    if (href === "/inbound") return pathname === "/inbound" || pathname.startsWith("/inbound/");
    if (href === "/outbound") return pathname === "/outbound" || pathname.startsWith("/outbound/");
    if (href === "/returns")  return pathname === "/returns"  || pathname.startsWith("/returns/");
    if (href === "/stats/period") return pathname === "/stats/period";
    if (href === "/stats/sites")  return pathname === "/stats/sites";
    if (href === "/inventory-check") return pathname === "/inventory-check";
    if (href === "/construction/schedule") return pathname === "/construction/schedule";
    if (href === "/construction/requests") return pathname === "/construction/requests";
    return pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
  }

  function activeGroupId() {
    for (const g of NAV_GROUPS) {
      if (g.items.some(item => isActive(item.href))) return g.id;
    }
    return null;
  }

  const [manualExpanded, setManualExpanded] = useState<Set<string>>(() => {
    const id = activeGroupId();
    return new Set(id ? [id] : [NAV_GROUPS[0].id]);
  });

  const activeId = NAV_GROUPS.find(g => g.items.some(item => isActive(item.href)))?.id ?? null;
  const expanded = activeId && !manualExpanded.has(activeId)
    ? new Set([...manualExpanded, activeId])
    : manualExpanded;

  function toggleGroup(id: string) {
    setManualExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  return (
    <>
      {/* 모바일 백드롭 — md 이상에서는 숨김 */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* 사이드바 본체 */}
      <aside
        className={[
          "shrink-0 bg-slate-900 text-white flex flex-col",
          "transition-[transform,width] duration-200",
          // 모바일: fixed 오버레이
          "fixed inset-y-0 left-0 z-50 w-64",
          // 데스크탑: 일반 플로우로 복귀
          "md:relative md:inset-auto md:z-auto",
          // 모바일: translate로 열기/닫기 / 데스크탑: 항상 translate-x-0
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          // 데스크탑 닫힘: width 0
          !open ? "md:w-0 md:overflow-hidden" : "",
        ].join(" ")}
      >
        {/* 로고 */}
        <div className="h-14 flex items-center px-4 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-blue-500 flex items-center justify-center text-xs font-black tracking-tighter shrink-0">
              DS
            </div>
            <span className="text-sm font-bold tracking-tight whitespace-nowrap text-white">
              자재관리 시스템
            </span>
          </div>
        </div>

        {/* 사용자 정보 */}
        <div className="px-4 py-3 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-slate-700 border border-white/10 flex items-center justify-center text-xs font-bold shrink-0 text-white">
              {user?.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${viewOnly ? "bg-yellow-400" : "bg-emerald-400"}`} />
                <p className="text-xs text-slate-300 truncate">
                  {user?.dept} · {viewOnly ? "조회 전용" : user && isAdmin(user) ? "시스템 관리자" : "관리자"}
                </p>
              </div>
            </div>
            <button type="button" onClick={handleLogout}
              className="shrink-0 text-xs text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-white/5 transition-colors">
              로그아웃
            </button>
          </div>
        </div>

        {/* 네비게이션 */}
        <nav className="flex-1 overflow-y-auto py-3">

          {/* 대시보드 */}
          <div className="px-2 mb-4">
            <Link href="/dashboard" onClick={handleNavClick}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors whitespace-nowrap ${
                pathname === "/dashboard"
                  ? "bg-white/10 text-white font-medium"
                  : "text-slate-200 hover:bg-white/5 hover:text-white"
              }`}>
              <span className="text-base w-5 text-center shrink-0">⊞</span>
              대시보드
              {pathname === "/dashboard" && (
                <span className="ml-auto w-1 h-4 rounded-full bg-blue-400 shrink-0" />
              )}
            </Link>
          </div>

          {/* 그룹 메뉴 */}
          {NAV_GROUPS.map((group, gi) => {
            const visibleItems = group.items.filter(item => !item.adminOnly || admin);
            if (visibleItems.length === 0) return null;
            const isExpanded = expanded.has(group.id);

            return (
              <div key={group.id} className={`px-2 ${gi < NAV_GROUPS.length - 1 ? "mb-2" : ""}`}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className="w-full px-3 mb-1 flex items-center gap-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <span className={`text-[13px] font-semibold tracking-wide whitespace-nowrap ${group.color}`}>
                    {group.label}
                  </span>
                  <div className="flex-1 h-px bg-white/10" />
                  <span className={`text-white/40 text-xs transition-transform duration-200 ${isExpanded ? "rotate-0" : "-rotate-90"}`}>
                    ▾
                  </span>
                </button>

                <div className={`overflow-hidden transition-all duration-200 ${isExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"}`}>
                  <div className="space-y-0.5 pb-1">
                    {visibleItems.map(item => {
                      const active = isActive(item.href);
                      return (
                        <Link key={item.href} href={item.href} onClick={handleNavClick}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors whitespace-nowrap ${
                            active
                              ? "bg-white/10 text-white font-medium"
                              : "text-slate-200 hover:bg-white/5 hover:text-white"
                          }`}>
                          <span className="text-base w-5 text-center shrink-0">{item.icon}</span>
                          <span className="flex-1">{item.label}</span>
                          {active && (
                            <span className="ml-auto w-1 h-4 rounded-full bg-blue-400 shrink-0" />
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        {/* 환경설정 */}
        <div className="px-2 pb-2">
          <Link href="/settings" onClick={handleNavClick}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors whitespace-nowrap ${
              pathname === "/settings"
                ? "bg-white/10 text-white font-medium"
                : "text-slate-200 hover:bg-white/5 hover:text-white"
            }`}>
            <span className="text-base w-5 text-center shrink-0">⚙️</span>
            <span className="flex-1">환경설정</span>
            {pathname === "/settings" && <span className="ml-auto w-1 h-4 rounded-full bg-blue-400 shrink-0" />}
          </Link>
        </div>
      </aside>

      {/* 데스크탑 토글 버튼 — 모바일에서는 숨김 */}
      <button
        type="button"
        onClick={onToggle}
        className="hidden md:flex shrink-0 self-start mt-3 w-5 h-10 items-center justify-center bg-slate-700 hover:bg-slate-600 text-white rounded-r-lg transition-colors z-10"
        title={open ? "메뉴 숨기기" : "메뉴 표시"}
      >
        <span className="text-xs">{open ? "‹" : "›"}</span>
      </button>
    </>
  );
}
