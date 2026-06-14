"use client";

import { useTabs, MAX_TABS } from "@/context/TabsContext";
import { useSidebar } from "@/context/SidebarContext";
import { useViewMode } from "@/context/ViewModeContext";
import NotificationBell from "./NotificationBell";

export default function TabBar() {
  const { tabs, activeHref, setActive, closeTab } = useTabs();
  const { openSidebar } = useSidebar();
  const { viewMode } = useViewMode();
  const isPc = viewMode === "pc";

  if (tabs.length === 0) return null;

  return (
    <div className="no-print flex items-center bg-gray-100 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700 px-2 pt-1.5 gap-1 overflow-x-auto shrink-0">
      {/* 모바일 모드 햄버거 버튼 — 오버레이 사이드바 열기 (PC 모드에서는 사이드바가 고정이라 숨김) */}
      {!isPc && (
        <button
          type="button"
          onClick={openSidebar}
          className="shrink-0 self-center mb-1.5 p-2 rounded-lg text-gray-500 hover:bg-gray-200 dark:text-slate-400 dark:hover:bg-slate-700 transition-colors"
          aria-label="메뉴 열기"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="2" y1="4" x2="16" y2="4" />
            <line x1="2" y1="9" x2="16" y2="9" />
            <line x1="2" y1="14" x2="16" y2="14" />
          </svg>
        </button>
      )}
      {tabs.map(tab => {
        const active = tab.href === activeHref;
        return (
          <div
            key={tab.href}
            onClick={() => setActive(tab.href)}
            className={[
              "group flex items-center justify-between px-3 py-1.5 rounded-t-md cursor-pointer transition-colors w-[160px] shrink-0 border border-b-0 border-black dark:border-white",
              active
                ? "bg-slate-800 dark:bg-white text-white dark:text-gray-900 shadow-sm"
                : "bg-gray-200/60 dark:bg-slate-800/40 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-800/70",
            ].join(" ")}
            title={tab.href}
          >
            <span className={`text-[13px] truncate antialiased ${active ? "font-bold tracking-tight" : "font-semibold"}`}>
              {tab.label}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.href);
              }}
              className={[
                "shrink-0 w-5 h-5 rounded flex items-center justify-center text-base leading-none transition-colors ml-1",
                active
                  ? "text-gray-300 dark:text-gray-600 hover:bg-slate-700 dark:hover:bg-gray-200 hover:text-white dark:hover:text-gray-700"
                  : "text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-slate-700 hover:text-gray-700 dark:hover:text-white",
              ].join(" ")}
              aria-label="탭 닫기"
            >
              ×
            </button>
          </div>
        );
      })}
      <div className="ml-auto pr-1.5 text-[11px] text-gray-400 dark:text-gray-500 shrink-0 flex items-center gap-1">
        <span>{tabs.length} / {MAX_TABS}</span>
        <NotificationBell />
      </div>
    </div>
  );
}
