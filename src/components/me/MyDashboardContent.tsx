"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { api, getErrorMessage } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import Header from "@/components/layout/Header";
import PushNotificationToggle from "@/components/me/PushNotificationToggle";
import type { ConstructionRequest, ConstructionSchedule, NotificationItem } from "@/lib/mock-router";

interface TbmRow {
  id: number;
  mode: string;
  sub_type: string | null;
  site_name: string;
  elevator_name: string;
  work_content: string;
  created_at: string;
}

const STATUS_COLORS: Record<ConstructionRequest["status"], string> = {
  "요청":      "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  "접수":      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "일정등록됨": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "완료":      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

const SECTION = "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm";

export default function MyDashboardContent() {
  const { user } = useAuth();

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [myRequests, setMyRequests] = useState<ConstructionRequest[]>([]);
  const [upcomingSchedules, setUpcomingSchedules] = useState<ConstructionSchedule[]>([]);
  const [myTbm, setMyTbm] = useState<TbmRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifEnabled, setNotifEnabled] = useState<boolean>(true);
  const [notifPrefSaving, setNotifPrefSaving] = useState(false);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const sevenDaysLater = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    // 신DB 스키마 전환 중 — 구 스키마 테이블(notifications/construction_*/tbm_records 등)이
    // 신DB에 없을 수 있다. 각 소스를 독립적으로 조회하고, 실패(테이블 없음 등) 시
    // 빈 값으로 degrade해 화면이 죽지 않게 한다.
    async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
      try {
        return await fn();
      } catch (e) {
        console.warn(`[대시보드] ${label} 조회 생략:`, getErrorMessage(e));
        return fallback;
      }
    }

    const name = user.name;

    // 알림
    const notifs = await safe("알림", () =>
      api.get<NotificationItem[]>(`/api/notifications?userId=${user.id}&limit=30`), []);

    // 내 공사요청
    const allReqs = await safe("공사요청", () =>
      api.get<ConstructionRequest[]>("/api/construction-requests"), []);
    const mine = allReqs.filter(r => r.requesterUserId === user.id || (!r.requesterUserId && r.requesterName === name));

    // 다가오는 일정 (담당자 또는 작업자에 내 이름 포함, 오늘~+7일)
    const allScheds = await safe("공사일정", () =>
      api.get<ConstructionSchedule[]>("/api/construction-schedules"), []);
    const upcoming = allScheds
      .filter(s => s.endDate >= today && s.startDate <= sevenDaysLater)
      .filter(s => s.manager.includes(name) || s.workers.includes(name))
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.startTime.localeCompare(b.startTime));

    // 최근 TBM 5건 (내가 작성)
    const tbmData = await safe<TbmRow[]>("TBM", async () => {
      const { data, error } = await supabase.from("tbm_records")
        .select("id, mode, sub_type, site_name, elevator_name, work_content, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as TbmRow[];
    }, []);

    // 알림 수신 설정
    const prefEnabled = await safe("알림설정", async () => {
      const { data, error } = await supabase.from("users")
        .select("notifications_enabled").eq("id", user.id).single();
      if (error) throw error;
      return data?.notifications_enabled !== false;
    }, true);

    setNotifications(notifs);
    setMyRequests(mine);
    setUpcomingSchedules(upcoming);
    setMyTbm(tbmData);
    setNotifEnabled(prefEnabled);
    setLoading(false);
  }, [user, today, sevenDaysLater]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleNotificationClick(n: NotificationItem) {
    try {
      if (!n.isRead) {
        await api.patch(`/api/notifications/${n.id}/read`, {});
        setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
      }
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
      setNotifications(prev => prev.map(x => ({ ...x, isRead: true })));
    } catch (e) {
      alert(getErrorMessage(e));
    }
  }

  async function toggleNotifEnabled() {
    if (!user || notifPrefSaving) return;
    const next = !notifEnabled;
    setNotifEnabled(next);
    setNotifPrefSaving(true);
    try {
      const { error } = await supabase.from("users")
        .update({ notifications_enabled: next }).eq("id", user.id);
      if (error) throw error;
    } catch (e) {
      setNotifEnabled(!next);
      alert(getErrorMessage(e));
    } finally {
      setNotifPrefSaving(false);
    }
  }

  const unreadCount = notifications.filter(n => !n.isRead).length;

  if (!user) {
    return (
      <>
        <Header title="내 대시보드" />
        <main className="flex-1 p-6"><div className="text-sm text-gray-500">로그인이 필요합니다.</div></main>
      </>
    );
  }

  return (
    <>
      <Header title="내 대시보드" />
      <main className="flex-1 p-6 space-y-5 bg-gray-50 dark:bg-gray-900 overflow-y-auto">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">안녕하세요, {user.name} 님</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">{user.dept}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 알림 */}
          <section className={SECTION + " lg:col-span-2"}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                🔔 알림
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 text-[11px] font-bold bg-red-500 text-white rounded-full">
                    {unreadCount}
                  </span>
                )}
              </h2>
              {unreadCount > 0 && (
                <button
                  onClick={handleReadAll}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  모두 읽음 처리
                </button>
              )}
            </div>
            <div className="flex items-center justify-between py-2 px-2 -mx-2 mb-2 rounded bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">인앱 알림 받기</span>
                <span className="text-[10px] text-gray-400">
                  {notifEnabled ? "켜짐" : "꺼짐 — 새 알림이 저장되지 않습니다"}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notifEnabled}
                onClick={toggleNotifEnabled}
                disabled={notifPrefSaving}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                  notifEnabled ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    notifEnabled ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <PushNotificationToggle />
            {loading ? (
              <div className="text-sm text-gray-400 py-4">불러오는 중...</div>
            ) : notifications.length === 0 ? (
              <div className="text-sm text-gray-400 py-4 text-center">알림이 없습니다.</div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {notifications.map(n => (
                  <li
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={`py-2.5 px-2 -mx-2 cursor-pointer rounded transition-colors ${
                      n.isRead
                        ? "hover:bg-gray-50 dark:hover:bg-gray-700/40"
                        : "bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.isRead && <span className="mt-1.5 w-2 h-2 rounded-full bg-red-500 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm ${n.isRead ? "font-medium text-gray-700 dark:text-gray-300" : "font-bold text-gray-900 dark:text-white"}`}>
                          {n.title}
                        </div>
                        {n.message && (
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 truncate">{n.message}</div>
                        )}
                        <div className="text-[10px] text-gray-400 mt-1">{new Date(n.createdAt).toLocaleString("ko-KR")}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 내 공사요청 현황 */}
          <section className={SECTION}>
            <h2 className="font-bold text-gray-800 dark:text-gray-100 mb-3">📝 내 공사요청 현황</h2>
            {loading ? (
              <div className="text-sm text-gray-400 py-4">불러오는 중...</div>
            ) : myRequests.length === 0 ? (
              <div className="text-sm text-gray-400 py-4 text-center">등록한 공사요청이 없습니다.</div>
            ) : (
              <ul className="space-y-2">
                {myRequests.slice(0, 10).map(r => (
                  <li key={r.id} className="flex items-start gap-2 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <span className={`shrink-0 px-2 py-0.5 text-[10px] rounded font-semibold ${STATUS_COLORS[r.status]}`}>
                      {r.status}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                        {r.siteName}{r.elevatorName ? ` · ${r.elevatorName}` : ""}
                      </div>
                      {r.details && <div className="text-xs text-gray-600 dark:text-gray-400 truncate">{r.details}</div>}
                      <div className="text-[10px] text-gray-400 mt-0.5">{new Date(r.requestedAt).toLocaleString("ko-KR")}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 다가오는 일정 */}
          <section className={SECTION}>
            <h2 className="font-bold text-gray-800 dark:text-gray-100 mb-3">📅 다가오는 일정 (오늘~7일)</h2>
            {loading ? (
              <div className="text-sm text-gray-400 py-4">불러오는 중...</div>
            ) : upcomingSchedules.length === 0 ? (
              <div className="text-sm text-gray-400 py-4 text-center">예정된 일정이 없습니다.</div>
            ) : (
              <ul className="space-y-2">
                {upcomingSchedules.map(s => (
                  <li key={s.id} className="p-2 rounded border border-gray-100 dark:border-gray-700">
                    <div className="text-xs font-mono text-gray-500 dark:text-gray-400">
                      {s.startDate === s.endDate ? s.startDate : `${s.startDate} ~ ${s.endDate}`}
                      {s.startTime ? ` ${s.startTime}` : ""}
                    </div>
                    <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                      {s.siteName}{s.elevatorName ? ` · ${s.elevatorName}` : ""}
                    </div>
                    {s.details && <div className="text-xs text-gray-600 dark:text-gray-400 truncate">{s.details}</div>}
                    {(s.workers || s.manager) && (
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {s.workers && <span>작업자: {s.workers}</span>}
                        {s.workers && s.manager && <span> · </span>}
                        {s.manager && <span>담당: {s.manager}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 최근 TBM */}
          <section className={SECTION + " lg:col-span-2"}>
            <h2 className="font-bold text-gray-800 dark:text-gray-100 mb-3">🛡️ 최근 TBM 작성 이력</h2>
            {loading ? (
              <div className="text-sm text-gray-400 py-4">불러오는 중...</div>
            ) : myTbm.length === 0 ? (
              <div className="text-sm text-gray-400 py-4 text-center">작성한 TBM이 없습니다.</div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {myTbm.map(t => (
                  <li key={t.id} className="py-2 flex items-start gap-3">
                    <span className={`shrink-0 px-2 py-0.5 text-[10px] rounded font-semibold ${
                      t.mode === "repair"
                        ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                        : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                    }`}>
                      {t.mode === "repair" ? "수리" : "보수"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                        {t.site_name}{t.elevator_name ? ` · ${t.elevator_name}` : ""}
                      </div>
                      {t.work_content && <div className="text-xs text-gray-600 dark:text-gray-400 truncate">{t.work_content}</div>}
                    </div>
                    <div className="shrink-0 text-[10px] text-gray-400">{new Date(t.created_at).toLocaleString("ko-KR")}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
