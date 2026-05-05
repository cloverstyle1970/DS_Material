"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { api, getErrorMessage } from "@/lib/api-client";
import { MaterialUnitRecord, MaterialUnitStatus } from "@/lib/mock-material-units";
import { TransactionRecord } from "@/lib/mock-transactions";

const STATUS_OPTIONS: { v: MaterialUnitStatus | "전체"; label: string; color: string }[] = [
  { v: "전체",     label: "전체",     color: "bg-gray-700 text-white" },
  { v: "재고",     label: "재고",     color: "bg-emerald-600 text-white" },
  { v: "출고",     label: "출고",     color: "bg-orange-500 text-white" },
  { v: "반납대기", label: "반납대기", color: "bg-amber-500 text-white" },
  { v: "반납완료", label: "반납완료", color: "bg-blue-600 text-white" },
  { v: "폐기",     label: "폐기",     color: "bg-red-600 text-white" },
];

function fmtDate(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function statusBadge(status: MaterialUnitStatus) {
  const map: Record<MaterialUnitStatus, string> = {
    "재고":     "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    "출고":     "bg-orange-50 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
    "반납대기": "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    "반납완료": "bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    "폐기":     "bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${map[status]}`}>{status}</span>;
}

export default function SerialHistoryClient() {
  const [units,    setUnits]    = useState<MaterialUnitRecord[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [snQuery,  setSnQuery]  = useState("");
  const [matQuery, setMatQuery] = useState("");
  const [status,   setStatus]   = useState<MaterialUnitStatus | "전체">("전체");
  const [openId,   setOpenId]   = useState<number | null>(null);
  const [history,  setHistory]  = useState<Record<number, TransactionRecord[]>>({});
  const [historyLoading, setHistoryLoading] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (status !== "전체") params.set("status", status);
      if (snQuery.trim()) params.set("serialNo", snQuery.trim());
      if (matQuery.trim()) params.set("matQuery", matQuery.trim());
      api.get<MaterialUnitRecord[]>(`/api/material-units?${params.toString()}`)
        .then(rows => { if (!cancelled) setUnits(rows); })
        .catch(e => { if (!cancelled) alert(getErrorMessage(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [status, snQuery, matQuery]);

  function downloadExcel() {
    const stamp = new Date().toISOString().slice(0,10).replace(/-/g, "");
    const rows = units.map(u => ({
      "S/N":      u.serialNo,
      자재명:     u.materialName ?? "",
      자재코드:   u.materialId,
      규격:       u.materialModelNo ?? "",
      상태:       u.status,
      현재현장:   u.currentSite ?? "",
      현재호기:   u.currentElevator ?? "",
      입고일시:   fmtDate(u.inboundAt),
      "최근 이벤트": fmtDate(u.lastEventAt),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "S/N이력");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SN이력_${status === "전체" ? "전체" : status}_${stamp}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function toggleOpen(unit: MaterialUnitRecord) {
    if (openId === unit.id) { setOpenId(null); return; }
    setOpenId(unit.id);
    if (history[unit.id]) return;
    setHistoryLoading(unit.id);
    try {
      const rows = await api.get<TransactionRecord[]>(`/api/material-units/${unit.id}/history`);
      setHistory(prev => ({ ...prev, [unit.id]: rows }));
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setHistoryLoading(null);
    }
  }

  const totalByStatus = useMemo(() => {
    const c: Record<string, number> = {};
    units.forEach(u => { c[u.status] = (c[u.status] ?? 0) + 1; });
    return c;
  }, [units]);

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-700 rounded-xl shrink-0">
          {STATUS_OPTIONS.map(opt => (
            <button key={opt.v} type="button" onClick={() => setStatus(opt.v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
                ${status === opt.v ? opt.color + " shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}>
              {opt.label}
              {opt.v !== "전체" && totalByStatus[opt.v] != null && status === "전체" && (
                <span className="ml-1.5 opacity-80">{totalByStatus[opt.v]}</span>
              )}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-44">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input value={matQuery} onChange={e => setMatQuery(e.target.value)}
            placeholder="자재명·코드·규격 검색"
            className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white dark:bg-gray-700" />
          {matQuery && (
            <button type="button" onClick={() => setMatQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
          )}
        </div>

        <div className="relative flex-1 min-w-44">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🏷️</span>
          <input value={snQuery} onChange={e => setSnQuery(e.target.value)}
            placeholder="S/N 검색"
            className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white dark:bg-gray-700" />
          {snQuery && (
            <button type="button" onClick={() => setSnQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
          )}
        </div>

        <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0">{units.length.toLocaleString()}건</span>

        <button type="button" onClick={downloadExcel} disabled={units.length === 0}
          className="bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors shrink-0">
          엑셀 다운로드
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading && <div className="text-center py-4 text-sm text-gray-400 dark:text-gray-500">로딩 중...</div>}
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
              <tr>
                {["", "S/N", "자재명", "자재코드", "규격", "상태", "현재 위치", "입고일", "최근 이벤트"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {units.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-16 text-gray-400 dark:text-gray-500">조건에 맞는 S/N이 없습니다.</td></tr>
              ) : units.map(u => (
                <Fragment key={u.id}>
                  <tr onClick={() => toggleOpen(u)}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer transition-colors">
                    <td className="px-4 py-3 text-gray-300 dark:text-gray-600">{openId === u.id ? "▾" : "▸"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-800 dark:text-gray-200 whitespace-nowrap">{u.serialNo}</td>
                    <td className="px-4 py-3 text-xs font-medium text-gray-800 dark:text-gray-200 max-w-[220px] truncate">{u.materialName ?? "-"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{u.materialId}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{u.materialModelNo ?? "-"}</td>
                    <td className="px-4 py-3">{statusBadge(u.status)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {u.currentSite ?? "-"}{u.currentElevator ? <span className="text-gray-400 ml-1">({u.currentElevator})</span> : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{fmtDate(u.inboundAt)}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{fmtDate(u.lastEventAt)}</td>
                  </tr>
                  {openId === u.id && (
                    <tr className="bg-slate-50/60 dark:bg-slate-900/30">
                      <td colSpan={9} className="px-8 py-4">
                        {historyLoading === u.id ? (
                          <p className="text-xs text-gray-400 text-center py-2">이력 불러오는 중...</p>
                        ) : !history[u.id] ? null : history[u.id].length === 0 ? (
                          <p className="text-xs text-gray-400 text-center py-2">이 S/N에 연결된 트랜잭션이 없습니다.</p>
                        ) : (
                          <ol className="relative border-l-2 border-slate-200 dark:border-slate-700 pl-5 space-y-3">
                            {history[u.id].map(t => {
                              const eventColor = t.type === "입고"
                                ? "bg-blue-500"
                                : t.requiresReturn
                                  ? (t.returnStatus === "returned" ? "bg-emerald-500" : "bg-amber-500")
                                  : "bg-orange-500";
                              return (
                                <li key={t.id} className="relative">
                                  <span className={`absolute -left-[27px] top-1 w-3 h-3 rounded-full ${eventColor} ring-2 ring-white dark:ring-gray-800`} />
                                  <div className="text-xs text-gray-500 dark:text-gray-400">{fmtDate(t.createdAt)}</div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className={`text-xs font-bold ${t.type === "입고" ? "text-blue-600" : "text-orange-600"}`}>{t.type}</span>
                                    {t.requiresReturn && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium">회수자재</span>
                                    )}
                                    {t.returnStatus === "returned" && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-medium">반납완료</span>
                                    )}
                                    <span className="text-xs text-gray-700 dark:text-gray-300">
                                      {t.siteName ?? "본사"}{t.elevatorName ? ` / ${t.elevatorName}` : ""}
                                    </span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">{t.userName}</span>
                                  </div>
                                  {t.note && <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{t.note}</div>}
                                  {t.returnedAt && (
                                    <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                                      ↳ 반납 {fmtDate(t.returnedAt)} ({t.returnedByUserName})
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
