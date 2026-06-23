"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TransactionRecord } from "@/lib/mock-transactions";
import { useAuth, isViewOnly } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { useViewMode } from "@/context/ViewModeContext";
import { api, getErrorMessage } from "@/lib/api-client";
import { fmtNum } from "@/lib/format";
import { isTkMaterial } from "@/lib/material-style";

type Tab = "pending" | "returned";

function fmtDate(iso: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
// 기본 기간: 이전주 일요일 ~ 당일(오늘)
function defaultPeriod() {
  const now = new Date();
  const curSun = new Date(now); curSun.setDate(now.getDate() - now.getDay());
  const prevSun = new Date(curSun); prevSun.setDate(curSun.getDate() - 7);
  return { from: ymd(prevSun), to: ymd(now) };
}

export default function ReturnsClient() {
  const { viewMode } = useViewMode();
  const isMobile = viewMode === "mobile";
  const [tab,           setTab]           = useState<Tab>("pending");
  const [transactions,  setTransactions]  = useState<TransactionRecord[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [actionId,      setActionId]      = useState<number | null>(null);
  const [bulkSaving,    setBulkSaving]    = useState(false);
  const [selected,      setSelected]      = useState<Set<number>>(new Set());
  const [query,         setQuery]         = useState("");
  const [dateFrom,      setDateFrom]      = useState(() => defaultPeriod().from);
  const [dateTo,        setDateTo]        = useState(() => defaultPeriod().to);
  const [companyFilter, setCompanyFilter] = useState<"전체" | "TK" | "DS">("전체");
  const { user } = useAuth();
  const admin = user ? !isViewOnly(user) : false;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<TransactionRecord[]>(`/api/transactions?type=출고&requiresReturn=true&returnStatus=${tab}`);
      setTransactions(data);
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    setSelected(new Set());
    const t = setTimeout(() => { reload(); }, 0);
    return () => clearTimeout(t);
  }, [reload]);
  useReloadOnActivate(() => { void reload(); });

  function toggleOne(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function markBulkReturned() {
    if (!user) return;
    if (selected.size === 0) return;
    if (!confirm(`선택한 ${selected.size}건을 일괄 반납 등록하시겠습니까?`)) return;
    setBulkSaving(true);
    let ok = 0, fail = 0;
    try {
      for (const id of selected) {
        try {
          await api.patch(`/api/transactions/${id}`, { action: "반납등록", userId: user.id, userName: user.name });
          ok++;
        } catch (e) {
          fail++;
          console.error(`반납 등록 실패 #${id}`, e);
        }
      }
      alert(`반납 등록: 성공 ${ok}건${fail ? ` / 실패 ${fail}건` : ""}`);
      setSelected(new Set());
      await reload();
    } finally {
      setBulkSaving(false);
    }
  }

  async function markReturned(t: TransactionRecord) {
    if (!user) return;
    if (!confirm(`이 자재의 반납을 등록하시겠습니까?\n\n자재: ${t.materialName} (${t.materialId})\n현장: ${t.siteName ?? "-"}${t.elevatorName ? ` / ${t.elevatorName}` : ""}\nS/N: ${t.serialNo ?? "-"}`)) return;
    setActionId(t.id);
    try {
      await api.patch(`/api/transactions/${t.id}`, { action: "반납등록", userId: user.id, userName: user.name });
      await reload();
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setActionId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter(t => {
      const d = (t.createdAt ?? "").slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      if (companyFilter !== "전체") {
        const isTk = isTkMaterial(t.materialId);
        if (companyFilter === "TK" && !isTk) return false;
        if (companyFilter === "DS" && isTk) return false;
      }
      if (!q) return true;
      return (
        t.materialName.toLowerCase().includes(q) ||
        t.materialId.toLowerCase().includes(q) ||
        (t.siteName?.toLowerCase().includes(q) ?? false) ||
        (t.elevatorName?.toLowerCase().includes(q) ?? false) ||
        (t.serialNo?.toLowerCase().includes(q) ?? false) ||
        t.userName.toLowerCase().includes(q)
      );
    });
  }, [transactions, query, dateFrom, dateTo, companyFilter]);

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-700 rounded-xl shrink-0">
          {([
            { v: "pending",  label: "반납 대기",  cnt: tab === "pending"  ? transactions.length : null },
            { v: "returned", label: "반납 완료",  cnt: tab === "returned" ? transactions.length : null },
          ] as const).map(t => (
            <button key={t.v} type="button" onClick={() => setTab(t.v)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors
                ${tab === t.v
                  ? t.v === "pending" ? "bg-orange-500 text-white shadow-sm" : "bg-green-600 text-white shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}>
              {t.label}{t.cnt !== null && <span className="ml-1.5 opacity-80">{t.cnt}</span>}
            </button>
          ))}
        </div>

        {/* 기간 (기본: 이전주~당일) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-2 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
          <span className="text-gray-300 dark:text-gray-600 text-xs">~</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-2 py-2 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
        </div>
        {/* 회사구분 (자재코드 기준 TK/DS) */}
        <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shrink-0">
          {(["전체","TK","DS"] as const).map(f => (
            <button key={f} type="button" onClick={() => setCompanyFilter(f)}
              className={`px-3 py-2 text-xs font-medium transition-colors ${
                companyFilter === f
                  ? f === "TK" ? "bg-blue-600 text-white" : f === "DS" ? "bg-red-500 text-white" : "bg-slate-700 text-white"
                  : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}>{f}</button>
          ))}
        </div>

        <div className="relative flex-1 min-w-48">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input lang="ko" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="자재명, 코드, 현장, S/N, 처리자 검색"
            className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white dark:bg-gray-700" />
        </div>

        <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0">
          {fmtNum(filtered.length)}건
          {selected.size > 0 && <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 font-medium">(선택 {selected.size})</span>}
        </span>

        {admin && tab === "pending" && selected.size > 0 && (
          <button type="button" onClick={markBulkReturned} disabled={bulkSaving}
            className="bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors shrink-0">
            {bulkSaving ? "처리 중..." : `선택 ${selected.size}건 일괄 반납`}
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading && <div className="text-center py-4 text-sm text-gray-400 dark:text-gray-500">로딩 중...</div>}
        {isMobile ? (
          filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500">
              {tab === "pending" ? "반납 대기 중인 자재가 없습니다." : "반납 완료된 내역이 없습니다."}
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map(t => (
                <div key={t.id} className={`p-4 ${selected.has(t.id) ? "bg-emerald-50 dark:bg-emerald-900/20" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {admin && tab === "pending" && (
                          <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleOne(t.id)}
                            className="w-4 h-4 rounded border-gray-300 accent-emerald-600 cursor-pointer shrink-0" />
                        )}
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{t.materialId}</span>
                      </div>
                      <p className="font-medium text-gray-800 dark:text-gray-100 mt-0.5">{t.materialName}</p>
                    </div>
                    <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{fmtDate(t.createdAt)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-gray-600 dark:text-gray-300 mt-1.5">
                    <div><span className="text-gray-400">수량 </span><span className="text-orange-500">{fmtNum(t.qty)}</span></div>
                    <div className="truncate"><span className="text-gray-400">S/N </span><span className="font-mono">{t.serialNo ?? "-"}</span></div>
                    <div className="col-span-2 truncate"><span className="text-gray-400">현장 </span>{t.siteName ?? "-"}{t.elevatorName ? ` (${t.elevatorName})` : ""}</div>
                    <div><span className="text-gray-400">출고자 </span>{t.userName}</div>
                    {tab === "returned" && <div><span className="text-gray-400">반납일 </span>{t.returnedAt ? fmtDate(t.returnedAt) : "-"}</div>}
                    {tab === "returned" && <div className="col-span-2"><span className="text-gray-400">반납자 </span>{t.returnedByUserName ?? "-"}</div>}
                  </div>
                  {admin && tab === "pending" && (
                    <div className="mt-2">
                      <button type="button" disabled={actionId === t.id} onClick={() => markReturned(t)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors font-medium">
                        {actionId === t.id ? "처리 중..." : "반납 등록"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
              <tr>
                {admin && tab === "pending" && (
                  <th className="px-4 py-3 w-8">
                    <input type="checkbox"
                      checked={filtered.length > 0 && filtered.every(t => selected.has(t.id))}
                      ref={el => {
                        if (el) {
                          const some = filtered.some(t => selected.has(t.id));
                          const all = filtered.length > 0 && filtered.every(t => selected.has(t.id));
                          el.indeterminate = some && !all;
                        }
                      }}
                      onChange={() => {
                        const all = filtered.length > 0 && filtered.every(t => selected.has(t.id));
                        if (all) setSelected(new Set());
                        else setSelected(new Set(filtered.map(t => t.id)));
                      }}
                      className="w-4 h-4 rounded border-gray-300 accent-emerald-600 cursor-pointer"
                    />
                  </th>
                )}
                {["출고일시", "자재명", "자재코드", "수량", "현장 / 호기", "S/N", "출고자", tab === "returned" ? "반납일시" : null, tab === "returned" ? "반납자" : null, admin && tab === "pending" ? "처리" : null]
                  .filter(Boolean)
                  .map((h, i) => (
                    <th key={i} className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">{h as string}</th>
                  ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {filtered.length === 0 ? (
                <tr><td colSpan={admin && tab === "pending" ? 10 : 9} className="text-center py-16 text-gray-400 dark:text-gray-500">
                  {tab === "pending" ? "반납 대기 중인 자재가 없습니다." : "반납 완료된 내역이 없습니다."}
                </td></tr>
              ) : filtered.map(t => (
                <tr key={t.id} className={`transition-colors ${selected.has(t.id) ? "bg-emerald-50 dark:bg-emerald-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-700/30"}`}>
                  {admin && tab === "pending" && (
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleOne(t.id)}
                        className="w-4 h-4 rounded border-gray-300 accent-emerald-600 cursor-pointer" />
                    </td>
                  )}
                  <td className="px-4 py-3 text-center text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">{fmtDate(t.createdAt)}</td>
                  <td className="px-4 py-3 text-center font-medium text-gray-800 dark:text-gray-200 max-w-[220px] truncate">{t.materialName}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{t.materialId}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-orange-500">{fmtNum(t.qty)}</td>
                  <td className="px-4 py-3 text-center text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">
                    {t.siteName ?? "-"}{t.elevatorName ? <span className="text-gray-400 ml-1">({t.elevatorName})</span> : null}
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap max-w-[160px] truncate">{t.serialNo ?? "-"}</td>
                  <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">{t.userName}</td>
                  {tab === "returned" && (
                    <td className="px-4 py-3 text-center text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">{t.returnedAt ? fmtDate(t.returnedAt) : "-"}</td>
                  )}
                  {tab === "returned" && (
                    <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">{t.returnedByUserName ?? "-"}</td>
                  )}
                  {admin && tab === "pending" && (
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button type="button" disabled={actionId === t.id} onClick={() => markReturned(t)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors font-medium">
                        {actionId === t.id ? "처리 중..." : "반납 등록"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </>
  );
}
