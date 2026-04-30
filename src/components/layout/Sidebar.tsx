"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
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
    id: "master",
    label: "기준 정보 관리",
    color: "text-sky-400",
    items: [
      { href: "/users",     label: "사용자 관리",    icon: "👤", adminOnly: true },
      { href: "/vendors",   label: "거래처 관리",    icon: "🤝" },
      { href: "/sites",     label: "현장/호기 관리", icon: "🏢" },
      { href: "/materials", label: "자재품목 관리",  icon: "🗄️" },
    ],
  },
  {
    id: "stock",
    label: "자재 수불 관리",
    color: "text-amber-400",
    items: [
      { href: "/requests",         label: "자재 신청 관리", icon: "📋" },
      { href: "/purchase-orders",  label: "발주 관리",      icon: "📑" },
      { href: "/inbound",          label: "입고 관리",      icon: "📥" },
      { href: "/outbound",         label: "출고 관리",      icon: "📤" },
    ],
  },
  {
    id: "stats",
    label: "현황 및 통계",
    color: "text-emerald-400",
    items: [
      { href: "/stats/period", label: "기간별 입출고 내역",    icon: "📅" },
      { href: "/stats/sites",  label: "현장/호기별 투입 현황", icon: "📍" },
      { href: "/materials",    label: "현재고 현황",           icon: "📦" },
    ],
  },
];

interface Props {
  open: boolean;
  onToggle: () => void;
}

export default function Sidebar({ open, onToggle }: Props) {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, logout } = useAuth();
  const viewOnly = user ? isViewOnly(user) : false;
  const admin    = !viewOnly;

  function isActive(href: string) {
    if (href === "/requests") return pathname === "/requests" || pathname.startsWith("/requests/");
    if (href === "/purchase-orders") return pathname === "/purchase-orders" || pathname.startsWith("/purchase-orders/");
    if (href === "/inbound") return pathname === "/inbound" || pathname.startsWith("/inbound/");
    if (href === "/outbound") return pathname === "/outbound" || pathname.startsWith("/outbound/");
    if (href === "/stats/period") return pathname === "/stats/period";
    if (href === "/stats/sites")  return pathname === "/stats/sites";
    return pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
  }

  function activeGroupId() {
    for (const g of NAV_GROUPS) {
      if (g.items.some(item => isActive(item.href))) return g.id;
    }
    return null;
  }

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const id = activeGroupId();
    return new Set(id ? [id] : [NAV_GROUPS[0].id]);
  });

  useEffect(() => {
    const id = activeGroupId();
    if (id) setExpanded(prev => prev.has(id) ? prev : new Set([...prev, id]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function toggleGroup(id: string) {
    setExpanded(prev => {
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
      {/* 사이드바 */}
      <aside
        className={`shrink-0 bg-slate-900 text-white flex flex-col transition-all duration-200 ${
          open ? "w-64" : "w-0 overflow-hidden"
        }`}
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

          {/* 대시보드 - 그룹 없는 단독 항목 */}
          <div className="px-2 mb-4">
            <Link href="/dashboard"
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
                {/* 그룹 헤더 (클릭 토글) */}
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

                {/* 그룹 항목 (아코디언) */}
                <div className={`overflow-hidden transition-all duration-200 ${isExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"}`}>
                  <div className="space-y-0.5 pb-1">
                    {visibleItems.map(item => {
                      const active = isActive(item.href);
                      return (
                        <Link key={item.href} href={item.href}
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
          <Link href="/settings"
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

      {/* 토글 버튼 */}
      <button
        type="button"
        onClick={onToggle}
        className="shrink-0 self-start mt-3 w-5 h-10 flex items-center justify-center bg-slate-700 hover:bg-slate-600 text-white rounded-r-lg transition-colors z-10"
        title={open ? "메뉴 숨기기" : "메뉴 표시"}
      >
        <span className="text-xs">{open ? "‹" : "›"}</span>
      </button>
    </>
  );
}
