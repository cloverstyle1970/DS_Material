"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";

// 알림 한 행 (DB 컬럼 그대로 — mock-router를 거치지 않고 직접 supabase 호출).
interface NotificationRow {
  id: number;
  user_id: number;
  type: string;
  title: string;
  message: string;
  link: string | null;
  ref_type: string | null;
  ref_id: number | null;
  is_read: boolean;
  created_at: string;
}

const PAGE_SIZE = 50;
const TYPE_LABELS: Record<string, string> = {
  improvement_response: "개선요청",
  request_outbound:     "자재신청 출고",
  request_status:       "자재신청 상태",
  purchase_received:    "발주 입고",
  request_inbound:      "신청 입고",
  schedule_created:     "공사일정 등록",
  schedule_updated:     "공사일정 수정",
  schedule_cancelled:   "공사일정 취소",
  quote_request:        "견적요청",
  quote_published:      "견적 발행",
  info:                 "일반",
  verify:               "검증",
};

function typeLabel(t: string) { return TYPE_LABELS[t] ?? t; }

function fmtKoDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

// 같은 날짜끼리 그룹핑 키 (YYYY-MM-DD)
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

type ReadFilter = "전체" | "안읽음" | "읽음";

export default function NotificationsClient() {
  const { user } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [readFilter, setReadFilter] = useState<ReadFilter>("전체");
  const [typeFilter, setTypeFilter] = useState<string>("전체");
  const [busy, setBusy] = useState(false);

  // 초기 로드 + 사용자 변경 시 리로드
  const loadFirstPage = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(0, PAGE_SIZE - 1);
    const list = (data ?? []) as NotificationRow[];
    setRows(list);
    setHasMore(list.length === PAGE_SIZE);
    setLoading(false);
  }, [user]);

  useEffect(() => { void loadFirstPage(); }, [loadFirstPage]);
  useReloadOnActivate(() => { void loadFirstPage(); });

  async function loadMore() {
    if (!user || busy || !hasMore) return;
    setBusy(true);
    const offset = rows.length;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    const list = (data ?? []) as NotificationRow[];
    setRows(prev => [...prev, ...list]);
    setHasMore(list.length === PAGE_SIZE);
    setBusy(false);
  }

  async function markRead(id: number) {
    if (!user) return;
    const target = rows.find(r => r.id === id);
    if (!target || target.is_read) return;
    setRows(prev => prev.map(r => r.id === id ? { ...r, is_read: true } : r));
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  }

  async function markAllRead() {
    if (!user || busy) return;
    if (rows.every(r => r.is_read)) return;
    setBusy(true);
    setRows(prev => prev.map(r => ({ ...r, is_read: true })));
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
    setBusy(false);
  }

  async function handleClick(n: NotificationRow) {
    await markRead(n.id);
    if (n.link && n.link.startsWith("/")) {
      router.push(n.link);
    }
  }

  // 사용 가능한 타입 목록 (현재 로드된 행에서 추출)
  const availableTypes = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.type);
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (readFilter === "안읽음" && r.is_read) return false;
      if (readFilter === "읽음"   && !r.is_read) return false;
      if (typeFilter !== "전체" && r.type !== typeFilter) return false;
      return true;
    });
  }, [rows, readFilter, typeFilter]);

  // 날짜별 그룹
  const grouped = useMemo(() => {
    const m = new Map<string, NotificationRow[]>();
    for (const r of filtered) {
      const k = dayKey(r.created_at);
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const unreadCount = rows.filter(r => !r.is_read).length;

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;

  return (
    <div className="p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">🔔 내 알림</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            {unreadCount > 0 ? `${unreadCount}건 안 읽음 · ` : ""}총 {rows.length}건 (최근순)
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            모두 읽음 표시
          </button>
        )}
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-3 flex-wrap bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-2">
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
          {(["전체", "안읽음", "읽음"] as ReadFilter[]).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setReadFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                readFilter === f
                  ? "bg-slate-700 text-white"
                  : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              {f}
              {f === "안읽음" && unreadCount > 0 && <span className="ml-1 opacity-80">({unreadCount})</span>}
            </button>
          ))}
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
        >
          <option value="전체">전체 종류</option>
          {availableTypes.map(t => (
            <option key={t} value={t}>{typeLabel(t)}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{filtered.length}건</span>
      </div>

      {/* 목록 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">불러오는 중...</div>
        ) : grouped.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            {rows.length === 0 ? "알림이 없습니다." : "조건에 맞는 알림이 없습니다."}
          </div>
        ) : (
          <div>
            {grouped.map(([dayK, items]) => (
              <div key={dayK}>
                <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700/50 text-[11px] font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  {dayK}
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {items.map(n => (
                    <li
                      key={n.id}
                      onClick={() => handleClick(n)}
                      className={`px-4 py-3 cursor-pointer transition-colors ${
                        n.is_read
                          ? "hover:bg-gray-50 dark:hover:bg-gray-700/40"
                          : "bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.is_read ? "bg-transparent" : "bg-red-500"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                              {typeLabel(n.type)}
                            </span>
                            <span className={`text-sm ${n.is_read ? "font-medium text-gray-700 dark:text-gray-300" : "font-bold text-gray-900 dark:text-white"}`}>
                              {n.title}
                            </span>
                          </div>
                          {n.message && (
                            <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 break-all">{n.message}</div>
                          )}
                          <div className="text-[10px] text-gray-400 mt-1 font-mono">{fmtKoDateTime(n.created_at)}</div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {hasMore && !loading && (
          <div className="border-t border-gray-100 dark:border-gray-700 text-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={busy}
              className="w-full py-3 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
            >
              {busy ? "불러오는 중..." : `이전 ${PAGE_SIZE}건 더 보기`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
