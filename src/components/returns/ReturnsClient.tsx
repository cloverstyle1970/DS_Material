"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TransactionRecord } from "@/lib/mock-transactions";
import { useAuth, isViewOnly } from "@/context/AuthContext";
import { api, getErrorMessage } from "@/lib/api-client";

type Tab = "pending" | "returned";

function fmtDate(iso: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

export default function ReturnsClient() {
  const [tab,           setTab]           = useState<Tab>("pending");
  const [transactions,  setTransactions]  = useState<TransactionRecord[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [actionId,      setActionId]      = useState<number | null>(null);
  const [bulkSaving,    setBulkSaving]    = useState(false);
  const [selected,      setSelected]      = useState<Set<number>>(new Set());
  const [query,         setQuery]         = useState("");
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
    if (!q) return transactions;
    return transactions.filter(t =>
      t.materialName.toLowerCase().includes(q) ||
      t.materialId.toLowerCase().includes(q) ||
      (t.siteName?.toLowerCase().includes(q) ?? false) ||
      (t.elevatorName?.toLowerCase().includes(q) ?? false) ||
      (t.serialNo?.toLowerCase().includes(q) ?? false) ||
      t.userName.toLowerCase().includes(q)
    );
  }, [transactions, query]);

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

        <div className="relative flex-1 min-w-48">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="자재명, 코드, 현장, S/N, 처리자 검색"
            className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white dark:bg-gray-700" />
        </div>

        <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0">
          {filtered.length.toLocaleString()}건
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
                    <th key={i} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">{h as string}</th>
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
                  <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">{fmtDate(t.createdAt)}</td>
                  <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200 max-w-[220px] truncate">{t.materialName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{t.materialId}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-orange-500">{t.qty}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">
                    {t.siteName ?? "-"}{t.elevatorName ? <span className="text-gray-400 ml-1">({t.elevatorName})</span> : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap max-w-[160px] truncate">{t.serialNo ?? "-"}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">{t.userName}</td>
                  {tab === "returned" && (
                    <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">{t.returnedAt ? fmtDate(t.returnedAt) : "-"}</td>
                  )}
                  {tab === "returned" && (
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">{t.returnedByUserName ?? "-"}</td>
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
      </div>
    </>
  );
}
