"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { api, getErrorMessage } from "@/lib/api-client";
import type { NotificationItem } from "@/lib/mock-router";

const POLL_INTERVAL_MS = 60_000;

export default function NotificationBell() {
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.get<NotificationItem[]>(`/api/notifications?userId=${user.id}&limit=20`);
      setItems(data);
    } catch {
      // silent fail (서비스 영향 없음)
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [user, refresh]);

  // 바깥 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function handleClick(n: NotificationItem) {
    try {
      if (!n.isRead) {
        await api.patch(`/api/notifications/${n.id}/read`, {});
        setItems(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
      }
      setOpen(false);
      if (n.link && typeof window !== "undefined") {
        window.location.href = n.link;
      }
    } catch (e) {
      alert(getErrorMessage(e));
    }
  }

  async function handleReadAll() {
    if (!user) return;
    try {
      await api.post("/api/notifications/read-all", { userId: user.id });
      setItems(prev => prev.map(x => ({ ...x, isRead: true })));
    } catch (e) {
      alert(getErrorMessage(e));
    }
  }

  if (!user) return null;

  const unread = items.filter(n => !n.isRead).length;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); if (!open) refresh(); }}
        className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
        aria-label="알림"
      >
        <span className="text-lg leading-none">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[70vh] bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-gray-200 dark:border-slate-700 overflow-hidden z-50 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
            <span className="font-bold text-gray-800 dark:text-gray-100 text-sm">알림 {unread > 0 ? `(${unread}건 안 읽음)` : ""}</span>
            {unread > 0 && (
              <button onClick={handleReadAll} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                모두 읽음
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">알림이 없습니다.</div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-slate-700">
                {items.map(n => (
                  <li
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`px-4 py-2.5 cursor-pointer transition-colors ${
                      n.isRead
                        ? "hover:bg-gray-50 dark:hover:bg-slate-700/40"
                        : "bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.isRead && <span className="mt-1.5 w-2 h-2 rounded-full bg-red-500 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs ${n.isRead ? "font-medium text-gray-700 dark:text-gray-300" : "font-bold text-gray-900 dark:text-white"}`}>
                          {n.title}
                        </div>
                        {n.message && (
                          <div className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5 truncate">{n.message}</div>
                        )}
                        <div className="text-[10px] text-gray-400 mt-0.5">{new Date(n.createdAt).toLocaleString("ko-KR")}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="px-4 py-2 border-t border-gray-100 dark:border-slate-700 text-center">
            <a href="/me/notifications" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
              전체 알림 보기 →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
