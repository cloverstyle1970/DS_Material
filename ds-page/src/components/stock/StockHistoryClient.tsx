"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { TransactionRecord } from "@/lib/mock-transactions";
import { useAuth, isViewOnly } from "@/context/AuthContext";
import StockTxModal from "@/components/requests/StockTxModal";

interface SiteOption { id: number; name: string }

interface Props {
  mode: "입고" | "출고";
  initial: TransactionRecord[];
  sites: SiteOption[];
}

interface Search { dateFrom: string; dateTo: string; siteName: string; userName: string }

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
  return "px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white";
}

export default function StockHistoryClient({ mode, initial, sites }: Props) {
  const [transactions, setTransactions] = useState(initial);
  const [search, setSearch] = useState<Search>(defaultSearch);
  const [showModal, setShowModal] = useState(false);

  const { user } = useAuth();
  const admin = user ? !isViewOnly(user) : false;

  const isInbound = mode === "입고";
  const accentBg  = isInbound ? "bg-blue-600 hover:bg-blue-700"   : "bg-orange-500 hover:bg-orange-600";
  const badgeCls  = isInbound ? "bg-blue-50 text-blue-600"        : "bg-orange-50 text-orange-600";
  const dotColor  = isInbound ? "bg-blue-500"                     : "bg-orange-400";
  const sign      = isInbound ? "+"                               : "-";
  const signColor = isInbound ? "text-blue-600"                   : "text-orange-500";

  const filtered = transactions.filter(t => {
    if (!inRange(t.createdAt, search.dateFrom, search.dateTo)) return false;
    if (search.siteName && !(t.siteName?.toLowerCase().includes(search.siteName.toLowerCase()))) return false;
    if (search.userName && !t.userName.toLowerCase().includes(search.userName.toLowerCase())) return false;
    return true;
  });

  function downloadExcel() {
    const stamp = new Date().toISOString().slice(0,10).replace(/-/g,"");
    const rows = filtered.map(t => ({
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

  const reload = useCallback(async () => {
    const res = await fetch(`/api/transactions?type=${encodeURIComponent(mode)}`);
    setTransactions(await res.json());
    setShowModal(false);
  }, [mode]);

  const hasFilter = search.dateFrom !== today() || search.dateTo !== today() || search.siteName || search.userName;

  return (
    <>
      {/* 툴바 */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* 검색 필터 */}
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-2.5 flex items-center gap-3 flex-wrap flex-1">
          <span className="text-xs text-gray-400 shrink-0">검색</span>
          <div className="flex items-center gap-1.5">
            <input type="date" value={search.dateFrom}
              onChange={e => setSearch(p => ({ ...p, dateFrom: e.target.value }))}
              className={inputCls()} />
            <span className="text-gray-300 text-xs">~</span>
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
              className="text-xs text-gray-400 hover:text-gray-600 underline">초기화</button>
          )}
          <span className="ml-auto text-xs text-gray-400 shrink-0">{filtered.length}건</span>
        </div>

        <button type="button" onClick={downloadExcel}
          className="bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-green-700 transition-colors shrink-0">
          엑셀 다운로드
        </button>

        {/* 등록 버튼 — 관리자만 */}
        {admin && (
          <>
            <button type="button" onClick={() => setShowModal(true)}
              className={`flex items-center gap-1.5 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shrink-0 ${accentBg}`}>
              {isInbound ? "📥" : "📤"} 빠른 등록
            </button>
            <Link href={isInbound ? "/inbound/new" : "/outbound/new"}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shrink-0 border border-gray-300 text-gray-700 hover:bg-gray-50">
              전표 입력
            </Link>
          </>
        )}
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {["일시", "자재명", "자재코드", "수량", "재고변동", "현장", "처리자", "비고"].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-16 text-gray-400">
                  {transactions.length === 0
                    ? `${mode} 내역이 없습니다.`
                    : "조건에 맞는 내역이 없습니다."}
                </td>
              </tr>
            ) : filtered.map(t => (
              <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDate(t.createdAt)}</td>
                <td className="px-4 py-3 font-medium text-gray-800 max-w-[200px] truncate">{t.materialName}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{t.materialId}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <span className={signColor}>{sign}{t.qty}</span>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                  {t.prevStock} → <span className="text-gray-700 font-medium">{t.afterStock}</span>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{t.siteName ?? "-"}</td>
                <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{t.userName}</td>
                <td className="px-4 py-3 text-gray-400 text-xs max-w-[140px] truncate">{t.note ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && user && (
        <StockTxModal
          initialType={mode}
          sites={sites}
          user={user}
          onClose={() => setShowModal(false)}
          onSaved={reload}
        />
      )}
    </>
  );
}
