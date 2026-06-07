"use client";

import { useAuth } from "@/context/AuthContext";

export default function Header({ title }: { title: string }) {
  const { user } = useAuth();
  const displayName = user?.name ?? "관리자";
  const initial = (user?.name ?? "관").slice(0, 1);

  return (
    <header className="h-14 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between px-4 md:px-6 shrink-0">
      <div className="flex items-center gap-2">
        <h1 className="text-base font-semibold text-gray-800 dark:text-white">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden sm:inline text-sm text-gray-500 dark:text-slate-400">{displayName}</span>
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white text-xs font-bold">
          {initial}
        </div>
      </div>
    </header>
  );
}
