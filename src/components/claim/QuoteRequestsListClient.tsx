"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { useTabs, MAX_TABS } from "@/context/TabsContext";
import { supabase } from "@/lib/supabase";

interface QuoteRequest {
  id: number;
  request_no: string;
  requested_at: string;
  site_name: string | null;
  elevator_name: string | null;
  work_title: string | null;
  reason: string | null;
  requester_name: string | null;
  requester_dept: string | null;
  status: "신청" | "견적작성중" | "견적발행" | "취소";
  quote_id: number | null;
}

interface QuoteRequestItem {
  id: number;
  material_id: string | null;
  material_name: string;
  spec: string | null;
  unit: string | null;
  qty: number;
  elevator_name: string | null;
  remark: string | null;
  sort_order: number;
}

const STATUS_OPTIONS = ["전체", "신청", "견적작성중", "견적발행", "취소"] as const;
type StatusFilter = typeof STATUS_OPTIONS[number];

function statusBadge(s: QuoteRequest["status"]): string {
  switch (s) {
    case "신청":     return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
    case "견적작성중": return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
    case "견적발행":  return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
    case "취소":     return "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";
  }
}

function fmtDT(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

export default function QuoteRequestsListClient() {
  const { user } = useAuth();
  const admin = user ? isAdmin(user) : false;
  const router = useRouter();
  const { tabs, openTab } = useTabs();

  const [list, setList] = useState<QuoteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("신청");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedItems, setSelectedItems] = useState<QuoteRequestItem[]>([]);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("quote_requests")
      .select("*").order("requested_at", { ascending: false });
    setList((data ?? []) as QuoteRequest[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(
    () => filter === "전체" ? list : list.filter(r => r.status === filter),
    [list, filter],
  );

  async function openDetail(r: QuoteRequest) {
    setSelectedId(r.id);
    const { data } = await supabase.from("quote_request_items")
      .select("*").eq("quote_request_id", r.id).order("sort_order");
    setSelectedItems((data ?? []) as QuoteRequestItem[]);
  }

  function goToQuoteEntry(r: QuoteRequest) {
    const href = `/quotes/new?fromRequest=${r.id}`;
    const label = "견적서 작성";
    const alreadyOpen = tabs.some(t => t.href === href);
    if (!alreadyOpen && tabs.length >= MAX_TABS) {
      alert(`탭은 최대 ${MAX_TABS}개까지 열 수 있습니다.`);
      return;
    }
    openTab(href, label);
  }

  async function changeStatus(id: number, next: QuoteRequest["status"]) {
    const { error } = await supabase.from("quote_requests").update({ status: next }).eq("id", id);
    if (error) { alert(`상태 변경 실패: ${error.message}`); return; }
    setList(prev => prev.map(r => r.id === id ? { ...r, status: next } : r));
  }

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;

  const selected = selectedId ? list.find(r => r.id === selectedId) : null;

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900 p-6">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">📋 견적요청 목록</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">보수원의 유상 청구 — 견적 담당자가 견적서를 작성합니다.</p>
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl">
          {STATUS_OPTIONS.map(s => (
            <button key={s} type="button" onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                filter === s
                  ? "bg-white dark:bg-gray-900 text-gray-800 dark:text-white shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}>
              {s} <span className="opacity-60 ml-1">{s === "전체" ? list.length : list.filter(r => r.status === s).length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
        {/* 목록 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <tr className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-2">요청번호</th>
                  <th className="px-3 py-2">접수일시</th>
                  <th className="px-3 py-2">현장</th>
                  <th className="px-3 py-2">호기</th>
                  <th className="px-3 py-2">작업명</th>
                  <th className="px-3 py-2">신청자</th>
                  <th className="px-3 py-2 text-center">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-10 text-gray-500">로딩 중...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-10 text-gray-400">데이터가 없습니다.</td></tr>
                ) : filtered.map(r => (
                  <tr key={r.id} onClick={() => openDetail(r)}
                    className={`cursor-pointer transition-colors ${selectedId === r.id ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
                    <td className="px-3 py-2 font-mono text-xs font-bold text-blue-600 dark:text-blue-400">{r.request_no}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300 font-mono">{fmtDT(r.requested_at)}</td>
                    <td className="px-3 py-2 text-xs font-medium text-gray-800 dark:text-gray-100">{r.site_name ?? "-"}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">{r.elevator_name ?? "-"}</td>
                    <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-200 truncate max-w-[200px]">{r.work_title ?? "-"}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">{r.requester_name ?? "-"}{r.requester_dept && <span className="ml-1 text-gray-400">({r.requester_dept})</span>}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusBadge(r.status)}`}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 상세 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          {!selected ? (
            <div className="py-10 text-center text-sm text-gray-400">목록에서 견적요청을 선택하세요.</div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <span className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400">{selected.request_no}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusBadge(selected.status)}`}>{selected.status}</span>
                {selected.quote_id && (
                  <button type="button" onClick={() => { router.push(`/quotes/detail?id=${selected.quote_id}`); }}
                    className="ml-auto text-[10px] px-2 py-1 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 hover:bg-emerald-200">
                    → 견적서 #{selected.quote_id}
                  </button>
                )}
              </div>
              <dl className="space-y-1.5 text-xs">
                <FieldRow label="현장">{selected.site_name ?? "-"}</FieldRow>
                <FieldRow label="호기">{selected.elevator_name ?? "-"}</FieldRow>
                <FieldRow label="작업명">{selected.work_title ?? "-"}</FieldRow>
                <FieldRow label="사유">
                  <div className="whitespace-pre-wrap">{selected.reason ?? "-"}</div>
                </FieldRow>
                <FieldRow label="신청">
                  {selected.requester_name ?? "-"}
                  {selected.requester_dept && <span className="ml-1 text-gray-400">({selected.requester_dept})</span>}
                  <span className="ml-2 text-gray-400 font-mono">{fmtDT(selected.requested_at)}</span>
                </FieldRow>
              </dl>

              <div className="mt-4">
                <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1">요청 자재 ({selectedItems.length}건)</div>
                <table className="w-full text-[11px] border border-gray-200 dark:border-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr className="text-left text-gray-500 dark:text-gray-400">
                      <th className="px-2 py-1.5">호기</th>
                      <th className="px-2 py-1.5">품목</th>
                      <th className="px-2 py-1.5 text-right">수량</th>
                      <th className="px-2 py-1.5">비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedItems.length === 0 ? (
                      <tr><td colSpan={4} className="text-center py-3 text-gray-400">자재 없음</td></tr>
                    ) : selectedItems.map(it => (
                      <tr key={it.id} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="px-2 py-1 text-center">{it.elevator_name ?? "-"}</td>
                        <td className="px-2 py-1">
                          <div className="font-medium">{it.material_name}</div>
                          {it.spec && <div className="text-[10px] text-gray-500">{it.spec}</div>}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{it.qty} {it.unit ?? ""}</td>
                        <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{it.remark ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {admin && (
                <div className="mt-4 flex gap-2 flex-wrap">
                  {selected.status === "신청" && (
                    <button type="button" onClick={() => goToQuoteEntry(selected)}
                      className="flex-1 px-3 py-2 rounded bg-blue-600 text-white text-xs font-bold hover:bg-blue-700">
                      📝 견적서 작성
                    </button>
                  )}
                  {(selected.status === "신청" || selected.status === "견적작성중") && (
                    <button type="button" onClick={() => { if (confirm("취소 처리하시겠습니까?")) changeStatus(selected.id, "취소"); }}
                      className="px-3 py-2 rounded text-xs font-semibold border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30">
                      취소
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-gray-500 dark:text-gray-400 w-14 shrink-0">{label}</dt>
      <dd className="flex-1 text-gray-800 dark:text-gray-100">{children}</dd>
    </div>
  );
}
