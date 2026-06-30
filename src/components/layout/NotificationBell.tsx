"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { api, getErrorMessage } from "@/lib/api-client";
import type { NotificationItem } from "@/lib/mock-router";

const POLL_INTERVAL_MS = 60_000;
const TOAST_DURATION_MS = 5_000;
const LAST_SEEN_KEY_PREFIX = "ds_notif_lastSeenId_";

function isPcDevice() {
  if (typeof navigator === "undefined") return false;
  return !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export default function NotificationBell() {
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const lastSeenIdRef = useRef<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 새 알림 1건당 5초 후 자동 제거. 여러 건이 동시에 들어와도 각각 타이머가 돌도록 setTimeout 사용.
  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.get<NotificationItem[]>(`/api/notifications?userId=${user.id}&limit=20`);
      setItems(data);

      // PC에서만 새 알림 토스트. 모바일은 Web Push로 별도 알림.
      // 첫 폴링 시점에는 baseline만 잡고 토스트는 띄우지 않음 (페이지 진입 시 과거 알림이 한꺼번에 튀는 것 방지).
      if (isPcDevice()) {
        const lastSeen = lastSeenIdRef.current;
        if (lastSeen === null) {
          const maxId = data.reduce((m, n) => Math.max(m, n.id), 0);
          lastSeenIdRef.current = maxId;
          try { localStorage.setItem(LAST_SEEN_KEY_PREFIX + user.id, String(maxId)); } catch {}
        } else {
          const fresh = data.filter(n => n.id > lastSeen && !n.isRead).sort((a, b) => a.id - b.id);
          if (fresh.length > 0) {
            setToasts(prev => [...prev, ...fresh]);
            const maxId = fresh[fresh.length - 1].id;
            lastSeenIdRef.current = maxId;
            try { localStorage.setItem(LAST_SEEN_KEY_PREFIX + user.id, String(maxId)); } catch {}
          }
        }
      }
    } catch {
      // silent fail (서비스 영향 없음)
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    // 새로고침 후에도 같은 알림이 다시 토스트되지 않도록 localStorage 의 lastSeenId 복원
    try {
      const stored = localStorage.getItem(LAST_SEEN_KEY_PREFIX + user.id);
      lastSeenIdRef.current = stored ? Number(stored) : null;
    } catch {
      lastSeenIdRef.current = null;
    }
    refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [user, refresh]);

  // 토스트 자동 dismiss — toasts가 갱신될 때마다 추가된 항목에 대해 5초 타이머 설정
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map(t => window.setTimeout(() => dismissToast(t.id), TOAST_DURATION_MS));
    return () => { timers.forEach(id => window.clearTimeout(id)); };
  }, [toasts, dismissToast]);

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

  async function handleToastClick(n: NotificationItem) {
    dismissToast(n.id);
    await handleClick(n);
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

      {/* PC 모드 토스트 알림 — fixed 로 우측 상단에 누적 표시, 5초 자동 dismiss */}
      {toasts.length > 0 && (
        <div className="fixed top-16 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
          {toasts.map(n => (
            <div
              key={n.id}
              role="alert"
              onClick={() => handleToastClick(n)}
              className="pointer-events-auto w-80 bg-white dark:bg-slate-800 border-l-4 border-blue-500 shadow-xl rounded-lg overflow-hidden cursor-pointer hover:shadow-2xl transition-shadow animate-[slide-in-right_180ms_ease-out]"
            >
              <div className="flex items-start gap-2 px-4 py-3">
                <span className="text-lg leading-none">🔔</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-gray-900 dark:text-white truncate">{n.title}</div>
                  {n.message && (
                    <div className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-2">{n.message}</div>
                  )}
                  <div className="text-[10px] text-gray-400 mt-1">{new Date(n.createdAt).toLocaleString("ko-KR")}</div>
                </div>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); dismissToast(n.id); }}
                  aria-label="닫기"
                  className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 leading-none text-lg shrink-0"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <style jsx global>{`
        @keyframes slide-in-right {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
