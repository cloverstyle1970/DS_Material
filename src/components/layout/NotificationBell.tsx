"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useTabs, MAX_TABS } from "@/context/TabsContext";
import { PAGE_REGISTRY } from "@/lib/page-registry";
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
  const { tabs, openTab } = useTabs();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const lastSeenIdRef = useRef<number | null>(null);

  // 알림벨 클릭 → 내 대시보드 탭 열기
  function openMyDashboard() {
    const alreadyOpen = tabs.some(t => t.href === "/me");
    if (!alreadyOpen && tabs.length >= MAX_TABS) {
      alert(`탭은 최대 ${MAX_TABS}개까지 열 수 있습니다. 다른 탭을 닫고 다시 시도해주세요.`);
      return;
    }
    const label = PAGE_REGISTRY["/me"]?.label ?? "내 대시보드";
    openTab("/me", label);
  }

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

  async function handleToastClick(n: NotificationItem) {
    dismissToast(n.id);
    try {
      if (!n.isRead) {
        await api.patch(`/api/notifications/${n.id}/read`, {});
        setItems(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
      }
      if (n.link && typeof window !== "undefined") {
        window.location.href = n.link;
      }
    } catch (e) {
      alert(getErrorMessage(e));
    }
  }

  if (!user) return null;

  const unread = items.filter(n => !n.isRead).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openMyDashboard}
        className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
        aria-label="알림 — 내 대시보드로 이동"
      >
        <span className="text-lg leading-none">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

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
