"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import Link from "next/link";
import * as XLSX from "xlsx";
import { TransactionRecord } from "@/lib/mock-transactions";
import { MaterialRecord } from "@/lib/mock-materials";
import { useAuth, isViewOnly, isNonManager } from "@/context/AuthContext";
import { api, getErrorMessage } from "@/lib/api-client";
import { fmtNum } from "@/lib/format";
import { isTkMaterial, TK_TEXT_CLASS } from "@/lib/material-style";
import DraggableModal from "@/components/common/DraggableModal";
import Autocomplete from "@/components/common/Autocomplete";
import TransactionBulkUploadModal from "./TransactionBulkUploadModal";

interface SiteOption { id: number; name: string }

interface Props {
  mode: "입고" | "출고";
  initial: TransactionRecord[];
}

interface Search { dateFrom: string; dateTo: string; siteName: string; userName: string; matQuery: string }

type SortKey = "createdAt" | "materialName" | "materialId" | "qty" | "siteName" | "userName" | "unitPrice";
type SortDir = "asc" | "desc";

type ColDef = { key: SortKey | null; label: string; sortable: boolean; outboundOnly?: boolean };

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

  // 숨어 있던 탭이 다시 보일 때 거래내역을 다시 받아 stale 방지
  const reloadData = useCallback(() => {
    api.get<TransactionRecord[]>(`/api/transactions?type=${encodeURIComponent(mode)}`)
      .then(setTransactions).catch(() => {});
  }, [mode]);
  useReloadOnActivate(reloadData);
  useEffect(() => {
    function refresh(e: Event) {
      const detail = (e as CustomEvent<{ mode?: string }>).detail;
      if (detail?.mode && detail.mode !== mode) return; // 다른 모드 이벤트는 무시
      api.get<TransactionRecord[]>(`/api/transactions?type=${encodeURIComponent(mode)}`)
        .then(setTransactions).catch(() => {});
    }
    window.addEventListener("ds:transactions_changed", refresh);
    return () => window.removeEventListener("ds:transactions_changed", refresh);
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
  const [bulkOutboundOpen, setBulkOutboundOpen] = useState(false);
  const [bulkOutboundLoading, setBulkOutboundLoading] = useState(false);
  const { user } = useAuth();
  const admin = user ? !isViewOnly(user) : false;
  // 단가·금액은 비관리자(보수일반/공사일반)에게만 숨김. 그 외 관리자급은 노출.
  const showFin = user ? !isNonManager(user) : false;

  const isInbound = mode === "입고";
  const signColor = isInbound ? "text-blue-600"                   : "text-orange-500";

  const columns: ColDef[] = useMemo(() => [
    { key: "createdAt",    label: "일자",     sortable: true  },
    { key: "materialId",   label: "자재코드", sortable: true  },
    { key: "materialName", label: "자재명",   sortable: true  },
    { key: null,           label: "규격",     sortable: false },
    { key: "qty",          label: "수량",     sortable: true  },
    { key: "unitPrice",    label: isInbound ? "입고단가" : "출고단가", sortable: true },
    { key: null,           label: isInbound ? "입고금액" : "출고금액", sortable: false },
    { key: null,           label: "재고변동", sortable: false },
    { key: "siteName",     label: "현장",     sortable: true  },
    { key: null,           label: "S/N",      sortable: false, outboundOnly: true },
    { key: null,           label: "회수",     sortable: false, outboundOnly: true },
    { key: "userName",     label: "처리자",   sortable: true  },
    { key: null,           label: "비고",     sortable: false },
  ], [isInbound]);

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

  async function handleBulkOutboundSubmit(data: { outboundAt: string; siteName: string; elevatorName: string }) {
    if (!user) return;
    const targets = transactions.filter(t => selectedIds.has(t.id));
    if (targets.length === 0) return;
    setBulkOutboundLoading(true);
    const fails: string[] = [];
    for (const t of targets) {
      try {
        await api.post("/api/transactions", {
          type: "출고",
          materialId: t.materialId,
          materialName: t.materialName,
          qty: t.qty,
          siteName: data.siteName || null,
          elevatorName: data.elevatorName || null,
          note: `입고#${t.id} 일괄출고`,
          userId: user.id,
          userName: user.name,
          createdAt: data.outboundAt,
        });
      } catch (e) {
        fails.push(`${t.materialName}: ${getErrorMessage(e)}`);
      }
    }
    setTransactions(await api.get<TransactionRecord[]>(`/api/transactions?type=${encodeURIComponent(mode)}`));
    setSelectedIds(new Set());
    setBulkOutboundLoading(false);
    setBulkOutboundOpen(false);
    if (fails.length > 0) {
      alert(`${targets.length - fails.length}건 처리 완료. 실패 ${fails.length}건:\n` + fails.join("\n"));
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
        [isInbound ? "입고단가" : "출고단가"]: showFin ? (t.unitPrice ?? 0) : "",
        [isInbound ? "입고금액" : "출고금액"]: showFin ? (t.unitPrice ?? 0) * t.qty : "",
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
          <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 shrink-0">{fmtNum(sorted.length)}건</span>
        </div>

        {admin && isInbound && selectedIds.size > 0 && (
          <button type="button" onClick={() => setBulkOutboundOpen(true)} disabled={bulkOutboundLoading}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shrink-0 bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-60">
            {bulkOutboundLoading ? "처리 중..." : `선택 ${selectedIds.size}건 일괄 출고`}
          </button>
        )}
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
              {columns.filter(c => !c.outboundOnly || !isInbound).map(c => {
                const active = c.sortable && c.key === sortKey;
                const padCls = c.label === "일자" ? "pl-2 pr-0" : c.label === "자재코드" ? "pl-1 pr-2" : "px-2";
                return (
                  <th key={c.label} className={`${padCls} py-3 text-center font-bold text-black dark:text-white whitespace-nowrap`}>
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
              {admin && <th className="px-2 py-3 text-center font-bold text-black dark:text-white whitespace-nowrap">처리</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={(isInbound ? 11 : 13) + (admin ? 1 : 0) + 1} className="text-center py-16 text-gray-400 dark:text-gray-500">
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
                <td className="pl-2 pr-0 py-3 text-left text-black dark:text-white whitespace-nowrap">{fmtDateOnly(t.createdAt)}</td>
                <td className={`pl-1 pr-2 py-3 text-left font-mono whitespace-nowrap ${isTkMaterial(t.materialId) ? TK_TEXT_CLASS : "text-black dark:text-white"}`}>{t.materialId}</td>
                <td className={`px-2 py-3 text-left font-medium max-w-[200px] truncate ${isTkMaterial(t.materialId) ? TK_TEXT_CLASS : "text-black dark:text-white"}`}>{t.materialName}</td>
                <td className="px-2 py-3 text-left text-black dark:text-white whitespace-nowrap">{matMap.get(t.materialId) || "-"}</td>
                <td className="px-2 py-3 text-center tabular-nums text-black dark:text-white">
                  {fmtNum(t.qty)}
                </td>
                <td className="px-2 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {showFin ? `₩${fmtNum(t.unitPrice ?? 0)}` : ""}
                </td>
                <td className={`px-2 py-3 text-right tabular-nums font-semibold whitespace-nowrap ${isInbound ? "text-blue-600 dark:text-blue-400" : "text-orange-500 dark:text-orange-400"}`}>
                  {showFin ? `₩${fmtNum((t.unitPrice ?? 0) * t.qty)}` : ""}
                </td>
                <td className="px-2 py-3 text-center tabular-nums text-black dark:text-white whitespace-nowrap">
                  {fmtNum(t.prevStock)} → <span className="font-medium">{fmtNum(t.afterStock)}</span>
                </td>
                <td className="px-2 py-3 text-left text-black dark:text-white whitespace-nowrap">
                  {t.siteName ?? "-"}{t.elevatorName ? <span className="ml-1 opacity-70">({t.elevatorName})</span> : null}
                </td>
                {!isInbound && (
                  <td className="px-2 py-3 text-left font-mono text-black dark:text-white whitespace-nowrap max-w-[140px] truncate">
                    {t.serialNo || "-"}
                  </td>
                )}
                {!isInbound && (
                  <td className="px-2 py-3 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
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
                <td className="px-2 py-3 text-center text-black dark:text-white whitespace-nowrap">{t.userName}</td>
                <td className="px-2 py-3 text-center text-black dark:text-white max-w-[140px] truncate">{t.note ?? "-"}</td>
                {admin && (
                  <td className="px-2 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1 items-center">
                      <Link href={isInbound ? `/inbound/edit?id=${t.id}` : `/outbound/edit?id=${t.id}`}
                        className="text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors">전표수정</Link>
                      <button type="button" disabled={actionLoading === t.id} onClick={() => setEditingTx(t)}
                        className="text-xs px-2 py-1 rounded-lg bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors">단건수정</button>
                      <button type="button" disabled={actionLoading === t.id} onClick={() => handleDelete(t.id)}
                        className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors">취소</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {/* 합계 요약 행 */}
            {sorted.length > 0 && (
              <tr className="bg-gray-50 dark:bg-gray-700/50 font-semibold border-t border-gray-200 dark:border-gray-700">
                <td className="px-3 py-3"></td>
                <td className="pl-2 pr-0 py-3 text-left text-black dark:text-white font-bold">합계</td>
                <td colSpan={3}></td>
                <td className="px-2 py-3 text-center tabular-nums text-black dark:text-white font-bold">
                  {fmtNum(sorted.reduce((acc, curr) => acc + curr.qty, 0))}
                </td>
                <td className="px-2 py-3"></td>
                <td className={`px-2 py-3 text-right tabular-nums font-bold ${isInbound ? "text-blue-600 dark:text-blue-400" : "text-orange-500 dark:text-orange-400"}`}>
                  {showFin ? `₩${fmtNum(sorted.reduce((acc, curr) => acc + (curr.qty * (curr.unitPrice ?? 0)), 0))}` : ""}
                </td>
                <td colSpan={(isInbound ? 4 : 6) + (admin ? 1 : 0)} className="px-2 py-3"></td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {editingTx && (
        <EditTransactionModal
          tx={editingTx}
          mode={mode}
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

      {bulkOutboundOpen && (
        <BulkOutboundModal
          targets={transactions.filter(t => selectedIds.has(t.id))}
          sites={sites}
          onClose={() => setBulkOutboundOpen(false)}
          onSubmit={handleBulkOutboundSubmit}
          loading={bulkOutboundLoading}
        />
      )}
    </>
  );
}

function EditTransactionModal({
  tx,
  mode,
  onClose,
  onSave,
  sites,
}: {
  tx: TransactionRecord;
  mode: "입고" | "출고";
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  sites: SiteOption[];
}) {
  const [qty, setQty] = useState(tx.qty.toString());
  const [siteName, setSiteName] = useState(tx.siteName ?? "");
  const [note, setNote] = useState(tx.note ?? "");
  const [serialNo, setSerialNo] = useState(tx.serialNo ?? "");
  const isOutbound = mode === "출고";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!qty || isNaN(Number(qty)) || Number(qty) <= 0) {
      alert("유효한 수량을 입력해주세요.");
      return;
    }
    const payload: Record<string, unknown> = { qty: Number(qty), siteName, note };
    if (isOutbound) payload.serialNo = serialNo.trim() || null;
    onSave(payload);
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
            <p className={`text-sm font-medium ${isTkMaterial(tx.materialId) ? TK_TEXT_CLASS : "text-gray-800 dark:text-gray-200"}`}>{tx.materialName} <span className="text-xs font-mono text-gray-400">({tx.materialId})</span></p>
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

          {isOutbound && (
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">S/N</label>
              <input
                type="text"
                value={serialNo}
                onChange={e => setSerialNo(e.target.value)}
                placeholder="시리얼 번호"
                className="w-full px-3 py-2 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
              <p className="mt-1 text-[10px] text-gray-400">S/N 추적 자재는 자재단위(<code>material_units</code>)의 사용 상태가 자동 동기화됩니다 (기존 S/N → 재고, 새 S/N → 출고/반납대기).</p>
            </div>
          )}

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

// ── 일괄 출고 모달 ────────────────────────────────────────────────
function BulkOutboundModal({
  targets, sites, onClose, onSubmit, loading,
}: {
  targets: TransactionRecord[];
  sites: SiteOption[];
  onClose: () => void;
  onSubmit: (data: { outboundAt: string; siteName: string; elevatorName: string }) => void;
  loading: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [outboundAt, setOutboundAt] = useState(today);
  const [siteName, setSiteName] = useState("");
  const [elevatorName, setElevatorName] = useState("");
  const [siteElevators, setSiteElevators] = useState<{ unitName: string | null }[]>([]);

  useEffect(() => {
    if (!siteName) { setSiteElevators([]); return; }
    api.get<{ unitName: string | null }[]>(`/api/elevators?site=${encodeURIComponent(siteName)}`)
      .then(setSiteElevators).catch(() => setSiteElevators([]));
  }, [siteName]);

  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-[640px]"
      header={
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">일괄 출고</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">&times;</button>
        </div>
      }
    >
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">출고일자 <span className="text-red-500">*</span></label>
            <input type="date" value={outboundAt} onChange={e => setOutboundAt(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">현장 <span className="text-red-500">*</span></label>
            <input type="text" value={siteName} onChange={e => { setSiteName(e.target.value); setElevatorName(""); }}
              list="bulk-outbound-sites" placeholder="현장 선택" className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            <datalist id="bulk-outbound-sites">
              {sites.map(s => <option key={s.id} value={s.name} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">호기</label>
            <select value={elevatorName} onChange={e => setElevatorName(e.target.value)} disabled={!siteName}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50">
              <option value="">(선택 안함)</option>
              {siteElevators.filter(e => e.unitName).map(e => (
                <option key={e.unitName} value={e.unitName!}>{e.unitName}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
            대상 <span className="text-orange-600 dark:text-orange-400 font-semibold">{fmtNum(targets.length)}건</span>
          </label>
          <div className="max-h-64 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500 dark:text-gray-400 font-medium">자재코드</th>
                  <th className="px-3 py-2 text-left text-gray-500 dark:text-gray-400 font-medium">자재명</th>
                  <th className="px-3 py-2 text-right text-gray-500 dark:text-gray-400 font-medium">수량</th>
                  <th className="px-3 py-2 text-left text-gray-500 dark:text-gray-400 font-medium">입고일자</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {targets.map(t => (
                  <tr key={t.id}>
                    <td className={`px-3 py-3 font-mono ${isTkMaterial(t.materialId) ? TK_TEXT_CLASS : "text-gray-700 dark:text-gray-300"}`}>{t.materialId}</td>
                    <td className={`px-3 py-3 ${isTkMaterial(t.materialId) ? TK_TEXT_CLASS : "text-gray-800 dark:text-gray-200"}`}>{t.materialName}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtNum(t.qty)}</td>
                    <td className="px-3 py-3 text-gray-500 dark:text-gray-400">{t.createdAt.substring(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-3 border-t border-gray-100 dark:border-gray-700">
          <button type="button" onClick={onClose} disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
            취소
          </button>
          <button type="button" onClick={() => onSubmit({ outboundAt, siteName, elevatorName })}
            disabled={loading || !outboundAt || !siteName}
            className="px-4 py-2 text-sm font-semibold text-white bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-60">
            {loading ? "처리 중..." : `${targets.length}건 출고`}
          </button>
        </div>
      </div>
    </DraggableModal>
  );
}
