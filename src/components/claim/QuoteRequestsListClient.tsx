"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { useTabs, MAX_TABS } from "@/context/TabsContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import { visibleUserIds } from "@/lib/crew";
import { fmtNum } from "@/lib/format";
import { isTkMaterial, TK_TEXT_CLASS } from "@/lib/material-style";

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
  // 권한그룹에서 /claim/quote-requests:read 권한을 받은 사람도 전체 조회 가능
  const canViewAll = user ? (admin || hasMenuPermission(user, "/claim/quote-requests", "read")) : false;
  // update 권한 → 견적서 작성·상태 변경(견적작성중/취소)·삭제 가능
  const canEdit = user ? (admin || hasMenuPermission(user, "/claim/quote-requests", "update")) : false;
  const router = useRouter();
  const { tabs, openTab } = useTabs();

  const [list, setList] = useState<QuoteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("신청");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedItems, setSelectedItems] = useState<QuoteRequestItem[]>([]);
  // quote_requests 자체에는 DS/TK 구분이 없어, items 의 material_id 첫 글자(D=DS / 그 외=TK)로 판정.
  // 한 요청에 TK 자재가 한 건이라도 포함되면 행 텍스트를 파란색으로 표시한다.
  const [tkRequestIds, setTkRequestIds] = useState<Set<number>>(new Set());
  // 통합 검색: 요청번호·현장·호기·작업명·신청자·부서 부분일치
  const [query, setQuery] = useState("");
  // DS/TK 토글: "DS" = 순수 DS(TK 자재 없음), "TK" = TK 한 건이라도 포함, "전체" = 무조건
  const [matType, setMatType] = useState<"전체" | "DS" | "TK">("전체");

  async function load() {
    if (!user) return;
    setLoading(true);
    let query = supabase.from("quote_requests")
      .select("*").order("requested_at", { ascending: false });
    // 비관리자는 같은 팀(users.dept) 청구만 조회 — 단, 메뉴 read 권한자는 전체 조회
    const ids = await visibleUserIds(user, "/claim/quote-requests");
    if (ids) query = query.in("requester_id", ids);
    const { data } = await query;
    const requests = (data ?? []) as QuoteRequest[];
    setList(requests);
    setLoading(false);

    // TK 여부 일괄 조회 (요청 ID 단위로 묶음)
    const reqIds = requests.map(r => r.id);
    if (reqIds.length === 0) { setTkRequestIds(new Set()); return; }
    const { data: items } = await supabase.from("quote_request_items")
      .select("quote_request_id, material_id")
      .in("quote_request_id", reqIds);
    const tkSet = new Set<number>();
    for (const it of (items ?? []) as { quote_request_id: number; material_id: string | null }[]) {
      if (isTkMaterial(it.material_id)) tkSet.add(it.quote_request_id);
    }
    setTkRequestIds(tkSet);
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id, canViewAll]);
  // 탭 비활성 → 활성 전환 시점에 목록 새로고침 (상태·검색 입력은 보존)
  useReloadOnActivate(() => { void load(); });

  // 1단계: 검색어 + TK/DS 토글 적용 (상태 필터는 별개)
  const searchFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter(r => {
      if (matType === "TK" && !tkRequestIds.has(r.id)) return false;
      if (matType === "DS" && tkRequestIds.has(r.id)) return false;
      if (q) {
        const hay = [
          r.request_no, r.site_name, r.elevator_name, r.work_title,
          r.requester_name, r.requester_dept,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [list, query, matType, tkRequestIds]);

  // 2단계: 상태 필터 — 상태별 카운트는 searchFiltered 기준
  const filtered = useMemo(
    () => filter === "전체" ? searchFiltered : searchFiltered.filter(r => r.status === filter),
    [searchFiltered, filter],
  );

  async function openDetail(r: QuoteRequest) {
    setSelectedId(r.id);
    const { data } = await supabase.from("quote_request_items")
      .select("*").eq("quote_request_id", r.id).order("sort_order");
    setSelectedItems((data ?? []) as QuoteRequestItem[]);
  }

  function goToQuoteEntry(r: QuoteRequest) {
    const alreadyOpen = tabs.some(t => t.href === "/quotes/new");
    if (!alreadyOpen && tabs.length >= MAX_TABS) {
      alert(`탭은 최대 ${MAX_TABS}개까지 열 수 있습니다.`);
      return;
    }
    try { sessionStorage.setItem("ds:quote_from_request", String(r.id)); } catch {}
    window.dispatchEvent(new CustomEvent("ds:quote_from_request_changed", { detail: { id: r.id } }));
    openTab("/quotes/new", "견적서 작성");
  }

  async function changeStatus(id: number, next: QuoteRequest["status"]) {
    const { error } = await supabase.from("quote_requests").update({ status: next }).eq("id", id);
    if (error) { alert(`상태 변경 실패: ${error.message}`); return; }
    setList(prev => prev.map(r => r.id === id ? { ...r, status: next } : r));
  }

  async function deleteRequest(r: QuoteRequest) {
    if (r.status === "견적발행") { alert("이미 견적이 발행된 요청은 삭제할 수 없습니다."); return; }
    if (!confirm(`견적요청 [${r.request_no}] 을(를) 삭제합니다.\n삭제된 데이터는 복구할 수 없습니다. 계속할까요?`)) return;
    if (!confirm("정말 삭제하시겠습니까? (마지막 확인)")) return;
    // quote_request_items 는 ON DELETE CASCADE 로 자동 정리됨
    const { error } = await supabase.from("quote_requests").delete().eq("id", r.id);
    if (error) { alert(`삭제 실패: ${error.message}`); return; }
    setList(prev => prev.filter(x => x.id !== r.id));
    if (selectedId === r.id) { setSelectedId(null); setSelectedItems([]); }
  }

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;

  const selected = selectedId ? list.find(r => r.id === selectedId) : null;

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900 p-6">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">📋 견적요청 목록</h1>
            {!canViewAll && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                👤 본인 청구만 표시 중
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {canViewAll
              ? "보수원의 유상 청구 — 견적 담당자가 견적서를 작성합니다."
              : "내가 등록한 유상 견적요청 — 견적서 발행 여부를 확인할 수 있습니다."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="현장·신청자·작업명·요청번호 검색"
            className="px-3 py-1.5 text-xs font-medium text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-200 placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:font-normal w-56" />
          <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
            {(["전체", "DS", "TK"] as const).map(t => (
              <button key={t} type="button" onClick={() => setMatType(t)}
                className={`px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  matType === t
                    ? t === "DS" ? "bg-red-500 text-white"
                    : t === "TK" ? "bg-blue-600 text-white"
                    : "bg-slate-600 text-white"
                    : "bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600"
                }`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-xl">
          {STATUS_OPTIONS.map(s => {
            const active = filter === s;
            const activeCls =
              s === "신청"       ? "bg-amber-500 text-white shadow-sm" :
              s === "견적작성중" ? "bg-blue-600 text-white shadow-sm" :
              s === "견적발행"   ? "bg-green-600 text-white shadow-sm" :
              s === "취소"       ? "bg-gray-500 text-white shadow-sm" :
                                   "bg-gray-900 text-white shadow-sm";
            return (
              <button key={s} type="button" onClick={() => setFilter(s)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  active
                    ? activeCls
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}>
                {s} <span className="opacity-60 ml-1">{s === "전체" ? searchFiltered.length : searchFiltered.filter(r => r.status === s).length}</span>
              </button>
            );
          })}
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
                  <th className="px-3 py-2 text-center">구분</th>
                  <th className="px-3 py-2">현장</th>
                  <th className="px-3 py-2">호기</th>
                  <th className="px-3 py-2">작업명</th>
                  <th className="px-3 py-2">신청자</th>
                  <th className="px-3 py-2 text-center">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-10 text-gray-500">로딩 중...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-10 text-gray-400">데이터가 없습니다.</td></tr>
                ) : filtered.map(r => {
                  const isTk = tkRequestIds.has(r.id);
                  // TK 요청은 일반 텍스트 셀(접수일시·현장·호기·작업명·신청자)을 파란색으로 표시.
                  // 요청번호는 이미 파란 강조라 그대로 두고, 상태 배지는 의미가 달라 그대로 둠.
                  return (
                  <tr key={r.id} onClick={() => openDetail(r)}
                    className={`cursor-pointer transition-colors ${selectedId === r.id ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
                    <td className={`px-3 py-2 font-mono text-xs font-bold ${isTk ? "text-blue-600 dark:text-blue-400" : "text-gray-700 dark:text-gray-200"}`}>{r.request_no}</td>
                    <td className={`px-3 py-2 text-xs font-mono ${isTk ? TK_TEXT_CLASS : "text-gray-600 dark:text-gray-300"}`}>{fmtDT(r.requested_at)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                        isTk
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                          : "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                      }`}>
                        {isTk ? "TK 견적요청" : "유상견적요청"}
                      </span>
                    </td>
                    <td className={`px-3 py-2 text-xs font-medium ${isTk ? TK_TEXT_CLASS : "text-gray-800 dark:text-gray-100"}`}>{r.site_name ?? "-"}</td>
                    <td className={`px-3 py-2 text-xs ${isTk ? TK_TEXT_CLASS : "text-gray-600 dark:text-gray-300"}`}>{r.elevator_name ?? "-"}</td>
                    <td className={`px-3 py-2 text-xs truncate max-w-[200px] ${isTk ? TK_TEXT_CLASS : "text-gray-700 dark:text-gray-200"}`}>{r.work_title ?? "-"}</td>
                    <td className={`px-3 py-2 text-xs ${isTk ? TK_TEXT_CLASS : "text-gray-600 dark:text-gray-300"}`}>{r.requester_name ?? "-"}{r.requester_dept && <span className={`ml-1 ${isTk ? TK_TEXT_CLASS : "text-gray-400"}`}>({r.requester_dept})</span>}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusBadge(r.status)}`}>{r.status}</span>
                    </td>
                  </tr>
                  );
                })}
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
                <span className={`font-mono text-sm font-bold ${tkRequestIds.has(selected.id) ? "text-blue-600 dark:text-blue-400" : "text-gray-700 dark:text-gray-200"}`}>{selected.request_no}</span>
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
                        <td className="px-2 py-1 text-right tabular-nums">{fmtNum(it.qty)} {it.unit ?? ""}</td>
                        <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{it.remark ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {canEdit && (
                <div className="mt-4 flex gap-2 flex-wrap">
                  {selected.status === "신청" && (
                    <button type="button" onClick={() => goToQuoteEntry(selected)}
                      className="flex-1 px-3 py-2 rounded bg-blue-600 text-white text-xs font-bold hover:bg-blue-700">
                      📝 견적서 작성
                    </button>
                  )}
                  {selected.status === "견적작성중" && selected.quote_id == null && (
                    <button type="button" onClick={() => goToQuoteEntry(selected)}
                      className="flex-1 px-3 py-2 rounded bg-amber-600 text-white text-xs font-bold hover:bg-amber-700">
                      ✏️ 견적서 이어서 작성
                    </button>
                  )}
                  {(selected.status === "신청" || selected.status === "견적작성중") && (
                    <button type="button" onClick={() => { if (confirm("취소 처리하시겠습니까?")) changeStatus(selected.id, "취소"); }}
                      className="px-3 py-2 rounded text-xs font-semibold border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30">
                      취소
                    </button>
                  )}
                  {selected.status !== "견적발행" && (
                    <button type="button" onClick={() => deleteRequest(selected)}
                      className="px-3 py-2 rounded text-xs font-bold bg-red-600 text-white hover:bg-red-700">
                      🗑 삭제
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
