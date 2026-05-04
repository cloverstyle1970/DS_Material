"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { TransactionRecord } from "@/lib/mock-transactions";
import { useAuth, isViewOnly } from "@/context/AuthContext";
import { api } from "@/lib/api-client";

interface SiteOption { id: number; name: string }

interface Props {
  mode: "입고" | "출고";
  initial: TransactionRecord[];
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

export default function StockHistoryClient({ mode, initial }: Props) {
  const [transactions, setTransactions] = useState(initial);
  const [sites, setSites] = useState<SiteOption[]>([]);

  useEffect(() => {
    api.get<TransactionRecord[]>(`/api/transactions?type=${encodeURIComponent(mode)}`)
      .then(setTransactions).catch(() => {});
  }, [mode]);
  useEffect(() => {
    api.get<SiteOption[]>("/api/sites").then(setSites).catch(() => {});
  }, []);
  const [search, setSearch] = useState<Search>(defaultSearch);
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [editingTx, setEditingTx] = useState<TransactionRecord | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
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

  async function handleDelete(id: number) {
    if (!confirm("정말 이 내역을 취소(삭제)하시겠습니까?\n취소 시 재고가 자동으로 원복되며 연관된 전표의 상태도 복구됩니다.")) return;
    setActionLoading(id);
    try {
      await api.delete(`/api/transactions/${id}`);
      setTransactions(await api.get<TransactionRecord[]>(`/api/transactions?type=${encodeURIComponent(mode)}`));
    } catch (e) {
      alert("취소 실패: " + (e as Error).message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSaveEdit(data: Record<string, unknown>) {
    if (!editingTx) return;
    setActionLoading(editingTx.id);
    try {
      await api.patch(`/api/transactions/${editingTx.id}`, { userName: user?.name, ...data });
      setTransactions(await api.get<TransactionRecord[]>(`/api/transactions?type=${encodeURIComponent(mode)}`));
      setEditingTx(null);
    } catch (e) {
      alert("수정 실패: " + (e as Error).message);
    } finally {
      setActionLoading(null);
    }
  }

  function downloadExcel() {
    const stamp = new Date().toISOString().slice(0,10).replace(/-/g,"");
    const list = selectedIds.size > 0
      ? transactions.filter(t => selectedIds.has(t.id))
      : transactions;
    const label = selectedIds.size > 0 ? `선택${selectedIds.size}건` : "전체";
    const rows = list.map(t => ({
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
    a.href = url; a.download = `${mode}내역_${label}_${stamp}.xlsx`; a.click();
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
          {selectedIds.size > 0 ? `선택 ${selectedIds.size}건 다운로드` : "엑셀 다운로드"}
        </button>
      </div>

      {/* 테이블 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-250px)]">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
            <tr>
              <th className="px-3 py-3 w-8">
                <input type="checkbox"
                  checked={sorted.length > 0 && sorted.every(t => selectedIds.has(t.id))}
                  onChange={() => {
                    if (sorted.length > 0 && sorted.every(t => selectedIds.has(t.id)))
                      setSelectedIds(new Set());
                    else setSelectedIds(new Set(sorted.map(t => t.id)));
                  }}
                  className="h-3.5 w-3.5 rounded cursor-pointer"
                />
              </th>
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
              {admin && <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">처리</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={admin ? 10 : 9} className="text-center py-16 text-gray-400 dark:text-gray-500">
                  {transactions.length === 0
                    ? `${mode} 내역이 없습니다.`
                    : "조건에 맞는 내역이 없습니다."}
                </td>
              </tr>
            ) : sorted.map(t => (
              <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                <td className="px-3 py-3">
                  <input type="checkbox"
                    checked={selectedIds.has(t.id)}
                    onChange={() => setSelectedIds(prev => {
                      const next = new Set(prev);
                      if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                      return next;
                    })}
                    className="h-3.5 w-3.5 rounded cursor-pointer"
                  />
                </td>
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
                {admin && (
                  <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button type="button" disabled={actionLoading === t.id} onClick={() => setEditingTx(t)}
                        className="text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors">수정</button>
                      <button type="button" disabled={actionLoading === t.id} onClick={() => handleDelete(t.id)}
                        className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors">취소</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {editingTx && (
        <EditTransactionModal
          tx={editingTx}
          onClose={() => setEditingTx(null)}
          onSave={handleSaveEdit}
          sites={sites}
        />
      )}
    </>
  );
}

function EditTransactionModal({
  tx,
  onClose,
  onSave,
  sites,
}: {
  tx: TransactionRecord;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  sites: SiteOption[];
}) {
  const [qty, setQty] = useState(tx.qty.toString());
  const [siteName, setSiteName] = useState(tx.siteName ?? "");
  const [note, setNote] = useState(tx.note ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!qty || isNaN(Number(qty)) || Number(qty) <= 0) {
      alert("유효한 수량을 입력해주세요.");
      return;
    }
    onSave({ qty: Number(qty), siteName, note });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[400px] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">내역 수정</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="mb-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">자재 정보</p>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{tx.materialName} <span className="text-xs font-mono text-gray-400">({tx.materialId})</span></p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">수량 <span className="text-red-500">*</span></label>
            <input type="number" value={qty} onChange={e => setQty(e.target.value)} required min="1"
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            <p className="mt-1 text-[10px] text-orange-500">주의: 수량 변경 시 현재 재고도 함께 변동됩니다.</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">현장</label>
            <select value={siteName} onChange={e => setSiteName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
              <option value="">(선택 안함)</option>
              {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">비고</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
          </div>

          <div className="mt-6 flex justify-end gap-2 pt-4 border-t border-gray-100 dark:border-gray-700">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              취소
            </button>
            <button type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
              저장
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
