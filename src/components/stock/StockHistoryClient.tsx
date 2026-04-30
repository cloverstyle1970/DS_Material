"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { TransactionRecord } from "@/lib/mock-transactions";
import { useAuth, isViewOnly } from "@/context/AuthContext";

interface SiteOption { id: number; name: string }

interface Props {
  mode: "입고" | "출고";
  initial: TransactionRecord[];
  sites: SiteOption[];
}

interface Search { dateFrom: string; dateTo: string; siteName: string; userName: string }

type SortKey = "createdAt" | "materialName" | "materialId" | "qty" | "siteName" | "userName";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey | null; label: string; sortable: boolean }[] = [
  { key: "createdAt",    label: "일시",     sortable: true  },
  { key: "materialName", label: "자재명",   sortable: true  },
  { key: "materialId",   label: "자재코드", sortable: true  },
  { key: "qty",          label: "수량",     sortable: true  },
  { key: null,           label: "재고변동", sortable: false },
  { key: "siteName",     label: "현장",     sortable: true  },
  { key: "userName",     label: "처리자",   sortable: true  },
  { key: null,           label: "비고",     sortable: false },
];

function today() { return new Date().toISOString().substring(0, 10); }
function defaultSearch(): Search { return { dateFrom: today(), dateTo: today(), siteName: "", userName: "" }; }

function inRange(iso: string, from: string, to: string) {
  const d = iso.substring(0, 10);
  if (from && d < from) return false;
  if (to   && d > to)   return false;
  return true;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function inputCls() {
  return "px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white dark:bg-gray-700";
}

export default function StockHistoryClient({ mode, initial, sites }: Props) {
  const [transactions] = useState(initial);
  const [search, setSearch] = useState<Search>(defaultSearch);
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const { user } = useAuth();
  const admin = user ? !isViewOnly(user) : false;

  const isInbound = mode === "입고";
  const sign      = isInbound ? "+"                               : "-";
  const signColor = isInbound ? "text-blue-600"                   : "text-orange-500";

  const filtered = transactions.filter(t => {
    if (!inRange(t.createdAt, search.dateFrom, search.dateTo)) return false;
    if (search.siteName && !(t.siteName?.toLowerCase().includes(search.siteName.toLowerCase()))) return false;
    if (search.userName && !t.userName.toLowerCase().includes(search.userName.toLowerCase())) return false;
    return true;
  });

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), "ko");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function downloadExcel() {
    const stamp = new Date().toISOString().slice(0,10).replace(/-/g,"");
    const rows = sorted.map(t => ({
      일시: fmtDate(t.createdAt),
      자재명: t.materialName,
      자재코드: t.materialId,
      수량: t.qty,
      이전재고: t.prevStock,
      이후재고: t.afterStock,
      현장: t.siteName ?? "",
      처리자: t.userName,
      비고: t.note ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, mode);
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${mode}내역_${stamp}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  }


  const hasFilter = search.dateFrom !== today() || search.dateTo !== today() || search.siteName || search.userName;

  return (
    <>
      {/* 툴바 */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* 검색 필터 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2.5 flex items-center gap-3 flex-wrap flex-1">
          <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">검색</span>
          <div className="flex items-center gap-1.5">
            <input type="date" value={search.dateFrom}
              onChange={e => setSearch(p => ({ ...p, dateFrom: e.target.value }))}
              className={inputCls()} />
            <span className="text-gray-300 dark:text-gray-600 text-xs">~</span>
            <input type="date" value={search.dateTo}
              onChange={e => setSearch(p => ({ ...p, dateTo: e.target.value }))}
              className={inputCls()} />
          </div>
          <select value={search.siteName}
            onChange={e => setSearch(p => ({ ...p, siteName: e.target.value }))}
            className={inputCls()}>
            <option value="">현장 전체</option>
            {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
          <input type="text" placeholder="처리자" value={search.userName}
            onChange={e => setSearch(p => ({ ...p, userName: e.target.value }))}
            className={`${inputCls()} w-24`} />
          {hasFilter && (
            <button type="button" onClick={() => setSearch(defaultSearch())}
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 underline">초기화</button>
          )}
          <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 shrink-0">{sorted.length}건</span>
        </div>

        {admin && (
          <Link href={isInbound ? "/inbound/new" : "/outbound/new"}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shrink-0 bg-slate-700 text-white hover:bg-slate-800">
            전표 입력
          </Link>
        )}
        <button type="button" onClick={downloadExcel}
          className="bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-green-700 transition-colors shrink-0">
          엑셀 다운로드
        </button>
      </div>

      {/* 테이블 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
            <tr>
              {COLUMNS.map(c => {
                const active = c.sortable && c.key === sortKey;
                return (
                  <th key={c.label} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {c.sortable && c.key ? (
                      <button type="button" onClick={() => toggleSort(c.key as SortKey)}
                        className={`flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200 transition-colors ${active ? "text-gray-700 dark:text-gray-100 font-semibold" : ""}`}>
                        {c.label}
                        <span className={`text-[10px] ${active ? "opacity-100" : "opacity-30"}`}>
                          {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                        </span>
                      </button>
                    ) : c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-16 text-gray-400 dark:text-gray-500">
                  {transactions.length === 0
                    ? `${mode} 내역이 없습니다.`
                    : "조건에 맞는 내역이 없습니다."}
                </td>
              </tr>
            ) : sorted.map(t => (
              <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">{fmtDate(t.createdAt)}</td>
                <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200 max-w-[200px] truncate">{t.materialName}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{t.materialId}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <span className={signColor}>{sign}{t.qty}</span>
                </td>
                <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">
                  {t.prevStock} → <span className="text-gray-700 dark:text-gray-300 font-medium">{t.afterStock}</span>
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{t.siteName ?? "-"}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">{t.userName}</td>
                <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs max-w-[140px] truncate">{t.note ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </>
  );
}
