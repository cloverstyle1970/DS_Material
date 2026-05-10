"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

const MENU_HREF = "/quotes";

type Status = "작성중" | "발행" | "승인" | "취소";
type StatusFilter = Status | "all";

interface QuoteRow {
  id: number;
  quote_no: string;
  quote_date: string;
  site_name: string | null;
  elevator_name: string | null;
  work_title: string | null;
  customer_name: string | null;
  total_amount: number;
  status: Status;
  created_by_name: string | null;
  created_at: string;
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

export default function QuotesListClient() {
  const { user } = useAuth();
  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo, setDateTo]     = useState(today);

  // 처리 중
  const [actionId, setActionId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("quotes")
      .select("id, quote_no, quote_date, site_name, elevator_name, work_title, customer_name, total_amount, status, created_by_name, created_at")
      .order("quote_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(500);
    setRows((data ?? []) as QuoteRow[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  const admin = isAdmin(user);
  const canRead = admin || hasMenuPermission(user, MENU_HREF, "read");
  const canDelete = admin;
  if (!canRead) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
      </div>
    );
  }

  const filtered = rows
    .filter(r => statusFilter === "all" ? true : r.status === statusFilter)
    .filter(r => {
      const d = r.quote_date;
      return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
    })
    .filter(r => {
      if (!search.trim()) return true;
      const s = search.trim().toLowerCase();
      return (r.quote_no?.toLowerCase().includes(s))
        || ((r.site_name ?? "").toLowerCase().includes(s))
        || ((r.work_title ?? "").toLowerCase().includes(s))
        || ((r.customer_name ?? "").toLowerCase().includes(s));
    });

  async function deleteQuote(id: number, quoteNo: string) {
    if (!canDelete) return;
    if (!confirm(`견적서 ${quoteNo} 을(를) 삭제하시겠습니까?\n(라인도 함께 삭제됩니다)`)) return;
    setActionId(id);
    try {
      const { error } = await supabase.from("quotes").delete().eq("id", id);
      if (error) throw error;
      await load();
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setActionId(null);
    }
  }

  async function changeStatus(id: number, next: Status) {
    setActionId(id);
    try {
      const { error } = await supabase.from("quotes").update({ status: next, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      await load();
    } catch (e) {
      alert(`상태 변경 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setActionId(null);
    }
  }

  const counts = {
    작성중: rows.filter(r => r.status === "작성중").length,
    발행:   rows.filter(r => r.status === "발행").length,
    승인:   rows.filter(r => r.status === "승인").length,
    취소:   rows.filter(r => r.status === "취소").length,
  };

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">견적서 목록</h1>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">총 {rows.length}건</p>
        </div>
        <Link href="/quotes/new"
          className="px-4 py-2 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
          + 견적서 작성
        </Link>
      </div>

      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs" />
          <span className="text-gray-400 text-xs">~</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs" />
        </div>
        <div className="flex gap-1">
          {(["all","작성중","발행","승인","취소"] as StatusFilter[]).map(f => (
            <button key={f} type="button" onClick={() => setStatusFilter(f)}
              className={`px-3 py-1 text-[11px] font-semibold rounded-full border ${
                statusFilter === f
                  ? "bg-slate-700 text-white border-slate-700"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600"
              }`}>
              {f === "all" ? `전체 (${rows.length})` : `${f} (${counts[f as Status]})`}
            </button>
          ))}
        </div>
        <input type="text" lang="ko" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="견적번호·현장·작업명·고객 검색"
          className="flex-1 max-w-md px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs" />
        <span className="ml-auto text-xs text-gray-400">{filtered.length}건</span>
      </div>

      <div className="px-6 py-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <tr className="text-center text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  <th className="px-3 py-2.5">견적번호</th>
                  <th className="px-3 py-2.5">일자</th>
                  <th className="px-3 py-2.5">현장 / 호기</th>
                  <th className="px-3 py-2.5">작업명</th>
                  <th className="px-3 py-2.5">고객</th>
                  <th className="px-3 py-2.5">금액</th>
                  <th className="px-3 py-2.5">상태</th>
                  <th className="px-3 py-2.5">작성자</th>
                  <th className="px-3 py-2.5">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading && <tr><td colSpan={9} className="text-center py-8 text-xs text-gray-500">로딩 중...</td></tr>}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-12 text-xs text-gray-500">조건에 맞는 견적서가 없습니다.</td></tr>
                )}
                {!loading && filtered.map(r => (
                  <tr key={r.id} className="text-center hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-3 py-2.5 font-mono text-xs text-blue-600 dark:text-blue-400">
                      <Link href={`/quotes/detail?id=${r.id}`} className="hover:underline">{r.quote_no}</Link>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-gray-400">{r.quote_date}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-700 dark:text-gray-300">
                      {r.site_name ?? "-"}{r.elevator_name && <span className="text-gray-400 ml-1">({r.elevator_name})</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-700 dark:text-gray-300 max-w-xs truncate">{r.work_title ?? "-"}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-700 dark:text-gray-300">{r.customer_name ?? "-"}</td>
                    <td className="px-3 py-2.5 text-xs font-bold text-gray-800 dark:text-gray-100 tabular-nums">{fmtNum(r.total_amount)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        r.status === "발행"   ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                        : r.status === "승인" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                        : r.status === "취소" ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300"
                        :                      "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                      }`}>{r.status}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400">{r.created_by_name ?? "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex justify-center gap-1">
                        <Link href={`/quotes/detail?id=${r.id}`}
                          className="px-2 py-0.5 text-[11px] rounded bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100">상세</Link>
                        {admin && r.status === "작성중" && (
                          <button type="button" disabled={actionId === r.id} onClick={() => changeStatus(r.id, "발행")}
                            className="px-2 py-0.5 text-[11px] rounded bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 disabled:opacity-50">발행</button>
                        )}
                        {canDelete && (
                          <button type="button" disabled={actionId === r.id} onClick={() => deleteQuote(r.id, r.quote_no)}
                            className="px-2 py-0.5 text-[11px] rounded bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-100 disabled:opacity-50">삭제</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
