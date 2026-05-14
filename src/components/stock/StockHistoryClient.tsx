"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { TransactionRecord } from "@/lib/mock-transactions";
import { MaterialRecord } from "@/lib/mock-materials";
import { useAuth, isViewOnly } from "@/context/AuthContext";
import { api } from "@/lib/api-client";
import DraggableModal from "@/components/common/DraggableModal";
import Autocomplete from "@/components/common/Autocomplete";
import TransactionBulkUploadModal from "./TransactionBulkUploadModal";

interface SiteOption { id: number; name: string }

interface Props {
  mode: "입고" | "출고";
  initial: TransactionRecord[];
}

interface Search { dateFrom: string; dateTo: string; siteName: string; userName: string; matQuery: string }

type SortKey = "createdAt" | "materialName" | "materialId" | "qty" | "siteName" | "userName";
type SortDir = "asc" | "desc";

type ColDef = { key: SortKey | null; label: string; sortable: boolean; outboundOnly?: boolean };

const COLUMNS: ColDef[] = [
  { key: "createdAt",    label: "일자",     sortable: true  },
  { key: "materialId",   label: "자재코드", sortable: true  },
  { key: "materialName", label: "자재명",   sortable: true  },
  { key: null,           label: "규격",     sortable: false },
  { key: "qty",          label: "수량",     sortable: true  },
  { key: null,           label: "재고변동", sortable: false },
  { key: "siteName",     label: "현장",     sortable: true  },
  { key: null,           label: "S/N",      sortable: false, outboundOnly: true },
  { key: null,           label: "회수",     sortable: false, outboundOnly: true },
  { key: "userName",     label: "처리자",   sortable: true  },
  { key: null,           label: "비고",     sortable: false },
];

function today() { return new Date().toISOString().substring(0, 10); }
function defaultSearch(): Search { return { dateFrom: today(), dateTo: today(), siteName: "", userName: "", matQuery: "" }; }

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

function fmtDateOnly(iso: string) {
  return iso.substring(0, 10);
}

function inputCls() {
  return "px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white dark:bg-gray-700";
}

export default function StockHistoryClient({ mode, initial }: Props) {
  const [transactions, setTransactions] = useState(initial);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [userNames, setUserNames] = useState<string[]>([]);
  const [matMap, setMatMap] = useState<Map<string, string>>(new Map()); // materialId → modelNo(규격)

  useEffect(() => {
    api.get<TransactionRecord[]>(`/api/transactions?type=${encodeURIComponent(mode)}`)
      .then(setTransactions).catch(() => {});
  }, [mode]);
  useEffect(() => {
    api.get<SiteOption[]>("/api/sites").then(setSites).catch(() => {});
    api.get<{ name: string; status: string | null }[]>("/api/users")
      .then(data => setUserNames(data.filter(u => u.status === "재직").map(u => u.name).sort()))
      .catch(() => {});
    api.get<MaterialRecord[]>("/api/materials")
      .then(data => {
        const m = new Map<string, string>();
        data.forEach(x => m.set(x.id, x.modelNo ?? ""));
        setMatMap(m);
      })
      .catch(() => {});
  }, []);
  const [search, setSearch] = useState<Search>(defaultSearch);
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [editingTx, setEditingTx] = useState<TransactionRecord | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const { user } = useAuth();
  const admin = user ? !isViewOnly(user) : false;

  const isInbound = mode === "입고";
  const signColor = isInbound ? "text-blue-600"                   : "text-orange-500";

  const filtered = transactions.filter(t => {
    if (!inRange(t.createdAt, search.dateFrom, search.dateTo)) return false;
    if (search.siteName && !(t.siteName?.toLowerCase().includes(search.siteName.toLowerCase()))) return false;
    if (search.userName && !t.userName.toLowerCase().includes(search.userName.toLowerCase())) return false;
    if (search.matQuery) {
      const q = search.matQuery.trim().toLowerCase();
      const modelNo = (matMap.get(t.materialId) ?? "").toLowerCase();
      if (
        !t.materialId.toLowerCase().includes(q) &&
        !t.materialName.toLowerCase().includes(q) &&
        !modelNo.includes(q) &&
        !((t.serialNo ?? "").toLowerCase().includes(q))
      ) return false;
    }
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

  async function handleReturn(t: TransactionRecord, action: "반납등록" | "미사용반납") {
    if (!user) return;
    const label = action === "반납등록" ? "폐자재 회수" : "미사용 반납 (재입고)";
    const confirmMsg = action === "미사용반납"
      ? `미사용 반납 처리하시겠습니까?\n\n자재: ${t.materialName} (${t.materialId})\n현장: ${t.siteName ?? "-"}${t.elevatorName ? ` / ${t.elevatorName}` : ""}\nS/N: ${t.serialNo ?? "-"}\n수량: ${t.qty}\n\n→ 재고가 ${t.qty}개 자동 복원됩니다.`
      : `폐자재 회수 처리하시겠습니까?\n\n자재: ${t.materialName} (${t.materialId})\n현장: ${t.siteName ?? "-"}${t.elevatorName ? ` / ${t.elevatorName}` : ""}\nS/N: ${t.serialNo ?? "-"}`;
    if (!confirm(confirmMsg)) return;
    setActionLoading(t.id);
    try {
      await api.patch(`/api/transactions/${t.id}`, { action, userId: user.id, userName: user.name });
      setTransactions(await api.get<TransactionRecord[]>(`/api/transactions?type=${encodeURIComponent(mode)}`));
    } catch (e) {
      alert(`${label} 실패: ` + (e as Error).message);
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
    const rows = list.map(t => {
      const base: Record<string, string | number> = {
        일자: fmtDateOnly(t.createdAt),
        자재코드: t.materialId,
        자재명: t.materialName,
        규격: matMap.get(t.materialId) ?? "",
        수량: t.qty,
        이전재고: t.prevStock,
        이후재고: t.afterStock,
        현장: t.siteName ?? "",
      };
      if (!isInbound) {
        base["호기"] = t.elevatorName ?? "";
        base["S/N"] = t.serialNo ?? "";
        base["회수"] = !t.requiresReturn ? "" : t.returnStatus === "returned" ? "반납완료" : "대기";
      }
      base["처리자"] = t.userName;
      base["비고"]   = t.note ?? "";
      return base;
    });
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


  const hasFilter = search.dateFrom !== today() || search.dateTo !== today() || search.siteName || search.userName || search.matQuery;

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
          <input type="text" lang="ko"
            value={search.matQuery}
            onChange={e => setSearch(p => ({ ...p, matQuery: e.target.value }))}
            placeholder="품목코드·자재명·규격·S/N"
            className={inputCls() + " w-56"} />
          <Autocomplete
            value={search.siteName}
            onChange={v => setSearch(p => ({ ...p, siteName: v }))}
            items={sites.map(s => s.name)}
            placeholder="현장명"
            width="w-44"
          />
          <Autocomplete
            value={search.userName}
            onChange={v => setSearch(p => ({ ...p, userName: v }))}
            items={userNames}
            placeholder="처리자"
            width="w-28"
          />
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
        {admin && (
          <button type="button" onClick={downloadExcel}
            className="bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-green-700 transition-colors shrink-0">
            {selectedIds.size > 0 ? `선택 ${selectedIds.size}건 다운로드` : "엑셀 다운로드"}
          </button>
        )}
        {admin && (
          <button type="button" onClick={() => setShowBulkUpload(true)}
            className="bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors shrink-0">
            엑셀 업로드
          </button>
        )}
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
              {COLUMNS.filter(c => !c.outboundOnly || !isInbound).map(c => {
                const active = c.sortable && c.key === sortKey;
                return (
                  <th key={c.label} className="px-4 py-3 text-center font-bold text-black dark:text-white whitespace-nowrap">
                    {c.sortable && c.key ? (
                      <button type="button" onClick={() => toggleSort(c.key as SortKey)}
                        className={`inline-flex items-center gap-1 mx-auto transition-opacity hover:opacity-70 ${active ? "underline underline-offset-2" : ""}`}>
                        {c.label}
                        <span className={`text-[10px] ${active ? "opacity-100" : "opacity-40"}`}>
                          {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                        </span>
                      </button>
                    ) : c.label}
                  </th>
                );
              })}
              {admin && <th className="px-4 py-3 text-center font-bold text-black dark:text-white whitespace-nowrap">처리</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={(isInbound ? 9 : 11) + (admin ? 1 : 0) + 1} className="text-center py-16 text-gray-400 dark:text-gray-500">
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
                <td className="px-4 py-3 text-left text-black dark:text-white whitespace-nowrap">{fmtDateOnly(t.createdAt)}</td>
                <td className="px-4 py-3 text-left font-mono text-black dark:text-white whitespace-nowrap">{t.materialId}</td>
                <td className="px-4 py-3 text-left font-medium text-black dark:text-white max-w-[200px] truncate">{t.materialName}</td>
                <td className="px-4 py-3 text-left text-black dark:text-white whitespace-nowrap">{matMap.get(t.materialId) || "-"}</td>
                <td className="px-4 py-3 text-right tabular-nums text-black dark:text-white">
                  {t.qty}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-black dark:text-white whitespace-nowrap">
                  {t.prevStock} → <span className="font-medium">{t.afterStock}</span>
                </td>
                <td className="px-4 py-3 text-left text-black dark:text-white whitespace-nowrap">
                  {t.siteName ?? "-"}{t.elevatorName ? <span className="ml-1 opacity-70">({t.elevatorName})</span> : null}
                </td>
                {!isInbound && (
                  <td className="px-4 py-3 text-left font-mono text-black dark:text-white whitespace-nowrap max-w-[140px] truncate">
                    {t.serialNo || "-"}
                  </td>
                )}
                {!isInbound && (
                  <td className="px-4 py-3 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    {t.returnStatus === "returned" ? (
                      <span className={`px-2 py-0.5 rounded-full ${
                        t.returnType === "unused"
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                          : "bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                      }`}>
                        {t.returnType === "unused" ? "미사용반납" : "폐자재회수"}
                      </span>
                    ) : t.requiresReturn ? (
                      admin ? (
                        <button type="button" disabled={actionLoading === t.id}
                          onClick={() => handleReturn(t, "반납등록")}
                          className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 hover:bg-orange-200 disabled:opacity-50">
                          폐자재회수
                        </button>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">대기</span>
                      )
                    ) : admin ? (
                      <button type="button" disabled={actionLoading === t.id}
                        onClick={() => handleReturn(t, "미사용반납")}
                        className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 hover:bg-sky-100 disabled:opacity-50">
                        미사용반납
                      </button>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-3 text-left text-black dark:text-white whitespace-nowrap">{t.userName}</td>
                <td className="px-4 py-3 text-left text-black dark:text-white max-w-[140px] truncate">{t.note ?? "-"}</td>
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

      {showBulkUpload && (
        <TransactionBulkUploadModal
          mode={mode}
          onClose={() => setShowBulkUpload(false)}
          onSaved={() => {
            setShowBulkUpload(false);
            api.get<TransactionRecord[]>(`/api/transactions?type=${encodeURIComponent(mode)}`)
              .then(setTransactions).catch(() => {});
          }}
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
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-[400px]"
      header={
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">내역 수정</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">&times;</button>
        </div>
      }
    >
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
    </DraggableModal>
  );
}
