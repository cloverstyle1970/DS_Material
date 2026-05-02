"use client";

import { useSidebar } from "@/context/SidebarContext";

export default function Header({ title }: { title: string }) {
  const { openSidebar } = useSidebar();

  return (
    <header className="h-14 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between px-4 md:px-6 shrink-0">
      <div className="flex items-center gap-2">
        {/* 모바일 햄버거 버튼 */}
        <button
          type="button"
          onClick={openSidebar}
          className="md:hidden -ml-1 p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700 transition-colors"
          aria-label="메뉴 열기"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="2" y1="4" x2="16" y2="4" />
            <line x1="2" y1="9" x2="16" y2="9" />
            <line x1="2" y1="14" x2="16" y2="14" />
          </svg>
        </button>
        <h1 className="text-base font-semibold text-gray-800 dark:text-white">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden sm:inline text-sm text-gray-500 dark:text-slate-400">관리자</span>
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white text-xs font-bold">
          관
        </div>
      </div>
    </header>
  );
}
