"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import Link from "next/link";
import * as XLSX from "xlsx";
import { TransactionRecord } from "@/lib/mock-transactions";
import { MaterialRecord } from "@/lib/mock-materials";
import { useAuth, isViewOnly, isNonManager } from "@/context/AuthContext";
import { api, getErrorMessage } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { fmtNum } from "@/lib/format";
import { isTkMaterial, TK_TEXT_CLASS } from "@/lib/material-style";
import { PhotoIconBtn } from "@/components/ui/PhotoIconBtn";
import DraggableModal from "@/components/common/DraggableModal";
import { useViewMode } from "@/context/ViewModeContext";
import { useSiteKeywordMap, matchSiteKeyword } from "@/lib/useSiteKeywordMap";
import Autocomplete from "@/components/common/Autocomplete";
import TransactionBulkUploadModal from "./TransactionBulkUploadModal";

interface SiteOption { id: number; name: string; alias?: string | null; search_keywords?: string | null }

interface Props {
  mode: "입고" | "출고";
  initial: TransactionRecord[];
}

interface Search { dateFrom: string; dateTo: string; siteName: string; userName: string; matQuery: string; vendorName: string }

type SortKey = "createdAt" | "materialName" | "materialId" | "qty" | "siteName" | "userName" | "unitPrice";
type SortDir = "asc" | "desc";

type ColDef = { key: SortKey | null; label: string; sortable: boolean; outboundOnly?: boolean; inboundOnly?: boolean; optional?: "note" | "processor" | "stock" };

function today() { return new Date().toISOString().substring(0, 10); }
function defaultSearch(): Search {
  // 기본 기간: 이전주 일요일 ~ 당일(오늘)
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  const curSun = new Date(now); curSun.setDate(now.getDate() - now.getDay());
  const prevSun = new Date(curSun); prevSun.setDate(curSun.getDate() - 7);
  return { dateFrom: ymd(prevSun), dateTo: ymd(now), siteName: "", userName: "", matQuery: "", vendorName: "" };
}

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
  const { viewMode } = useViewMode();
  const isMobile = viewMode === "mobile";
  const [transactions, setTransactions] = useState(initial);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [userNames, setUserNames] = useState<string[]>([]);
  const [matMap, setMatMap] = useState<Map<string, string>>(new Map()); // materialId → modelNo(규격)
  const [matAliasMap, setMatAliasMap] = useState<Map<string, string>>(new Map()); // materialId → alias(별명)
  const [matImgMap, setMatImgMap] = useState<Map<string, string[]>>(new Map()); // materialId → 사진 URL 목록
  // 입고 모드 한정: transactionId → 신청자명. transaction.note 의 '발주 #N' 패턴을 모아
  // purchase_orders 를 한 번에 조회해 매핑한다.
  const [requesterMap, setRequesterMap] = useState<Map<number, string>>(new Map());
  // 출고 모드 한정: transactionId → 수령인명. transaction.note 의 '수령인: XXX' 패턴을 직접 파싱.
  const [receiverMap, setReceiverMap] = useState<Map<number, string>>(new Map());
  // 입고 모드 한정: transactionId → 거래처명. purchase_orders.vendor_name 조회.
  const [vendorMap, setVendorMap] = useState<Map<number, string>>(new Map());

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
        const imgs = new Map<string, string[]>();
        const a = new Map<string, string>();
        data.forEach(x => {
          m.set(x.id, x.modelNo ?? "");
          if (x.alias) a.set(x.id, x.alias);
          const urls = [x.referenceImageUrl1, x.referenceImageUrl2, x.opinionImageUrl].filter((u): u is string => !!u);
          if (urls.length > 0) imgs.set(x.id, urls);
        });
        setMatMap(m);
        setMatAliasMap(a);
        setMatImgMap(imgs);
      })
      .catch(() => {});
  }, []);

  // 출고 모드: note '수령인: XXX' 패턴 직접 파싱
  useEffect(() => {
    if (mode !== "출고" || transactions.length === 0) { setReceiverMap(new Map()); return; }
    const next = new Map<number, string>();
    for (const t of transactions) {
      if (!t.note) continue;
      const m = t.note.match(/수령인:\s*([^/]+?)(?:\s*\/|$)/);
      if (m) next.set(t.id, m[1].trim());
    }
    setReceiverMap(next);
  }, [mode, transactions]);

  // 입고 모드: note '발주 #N' 패턴 → purchase_orders.requester_name / vendor_name 매핑.
  // N 은 purchase_order_lines.id (라인 ID) — purchase_orders.id(헤더 ID) 아님에 주의.
  // 라인 → 헤더 join 으로 정확한 발주 정보를 가져온다.
  useEffect(() => {
    if (mode !== "입고" || transactions.length === 0) {
      setRequesterMap(new Map());
      setVendorMap(new Map());
      return;
    }
    const txLinePairs: { txId: number; lineId: number }[] = [];
    for (const t of transactions) {
      const m = t.note?.match(/발주\s*#(\d+)/);
      if (m) txLinePairs.push({ txId: t.id, lineId: Number(m[1]) });
    }
    if (txLinePairs.length === 0) {
      setRequesterMap(new Map());
      setVendorMap(new Map());
      return;
    }
    const lineIds = Array.from(new Set(txLinePairs.map(p => p.lineId)));
    let cancelled = false;
    (async () => {
      // 2단계 조회 — Supabase JS 관계 조인 문법 대신 명시적 join 으로 결과 shape 안정화.
      // 1) lineIds → order_id
      const { data: linesData } = await supabase.from("purchase_order_lines")
        .select("id, order_id").in("id", lineIds);
      if (cancelled || !linesData) return;
      const lineToOrder = new Map<number, number>();
      for (const row of linesData as { id: number; order_id: number }[]) {
        lineToOrder.set(row.id, row.order_id);
      }
      // 2) order_ids → requester_name / vendor_name
      const orderIds = Array.from(new Set(Array.from(lineToOrder.values())));
      if (orderIds.length === 0) return;
      const { data: ordersData } = await supabase.from("purchase_orders")
        .select("id, requester_name, vendor_name").in("id", orderIds);
      if (cancelled || !ordersData) return;
      const orderToRequester = new Map<number, string>();
      const orderToVendor = new Map<number, string>();
      for (const row of ordersData as { id: number; requester_name: string | null; vendor_name: string | null }[]) {
        if (row.requester_name) orderToRequester.set(row.id, row.requester_name);
        if (row.vendor_name) orderToVendor.set(row.id, row.vendor_name);
      }
      // 3) txId → requester/vendor
      const nextReq = new Map<number, string>();
      const nextVen = new Map<number, string>();
      for (const { txId, lineId } of txLinePairs) {
        const orderId = lineToOrder.get(lineId);
        if (!orderId) continue;
        const req = orderToRequester.get(orderId);
        if (req) nextReq.set(txId, req);
        const ven = orderToVendor.get(orderId);
        if (ven) nextVen.set(txId, ven);
      }
      setRequesterMap(nextReq);
      setVendorMap(nextVen);
    })();
    return () => { cancelled = true; };
  }, [mode, transactions]);
  const [search, setSearch] = useState<Search>(defaultSearch);
  // 거래처 조회 우선순위: transactions.vendor_name 직접 저장값 → 없으면 발주 역추적(vendorMap)
  const resolveVendor = useCallback((t: TransactionRecord): string =>
    t.vendorName ?? vendorMap.get(t.id) ?? ""
  , [vendorMap]);
  const vendorNames = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      const v = resolveVendor(t);
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [transactions, resolveVendor]);
  const [companyFilter, setCompanyFilter] = useState<"전체" | "TK" | "DS">("전체");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [editingTx, setEditingTx] = useState<TransactionRecord | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkOutboundOpen, setBulkOutboundOpen] = useState(false);
  const [bulkOutboundLoading, setBulkOutboundLoading] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [showProcessor, setShowProcessor] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const { user } = useAuth();
  const admin = user ? !isViewOnly(user) : false;
  // 단가·금액은 비관리자(보수일반/공사일반)에게만 숨김. 그 외 관리자급은 노출.
  const showFin = user ? !isNonManager(user) : false;

  const isInbound = mode === "입고";
  const signColor = isInbound ? "text-blue-600"                   : "text-orange-500";

  const columns: ColDef[] = useMemo(() => [
    { key: "createdAt",    label: "일자",     sortable: true  },
    { key: null,           label: isInbound ? "입고번호" : "출고번호", sortable: false },
    { key: "materialId",   label: "자재코드", sortable: true  },
    { key: "materialName", label: "자재명",   sortable: true  },
    { key: null,           label: "규격",     sortable: false },
    { key: null,           label: "S/N",      sortable: false },
    { key: "qty",          label: "수량",     sortable: true  },
    { key: "unitPrice",    label: isInbound ? "입고단가" : "출고단가", sortable: true },
    { key: null,           label: isInbound ? "입고금액" : "출고금액", sortable: false },
    { key: null,           label: "재고변동", sortable: false, optional: "stock" },
    { key: "siteName",     label: "현장 / 호기", sortable: true  },
    { key: null,           label: "신청자",   sortable: false, inboundOnly: true },
    { key: null,           label: "수령인",   sortable: false, outboundOnly: true },
    { key: null,           label: "회수",     sortable: false, outboundOnly: true },
    { key: "userName",     label: "처리자",   sortable: true,  optional: "processor" },
    { key: null,           label: "비고",     sortable: false, optional: "note" },
  ], [isInbound]);

  // 현장명 별칭·검색키워드 공용 맵
  const siteKeywordMap = useSiteKeywordMap();

  const filtered = transactions.filter(t => {
    if (!inRange(t.createdAt, search.dateFrom, search.dateTo)) return false;
    if (companyFilter !== "전체") {
      const isTk = isTkMaterial(t.materialId);
      if (companyFilter === "TK" && !isTk) return false;
      if (companyFilter === "DS" && isTk) return false;
    }
    if (!matchSiteKeyword(t.siteName, search.siteName, siteKeywordMap)) return false;
    if (search.userName && !t.userName.toLowerCase().includes(search.userName.toLowerCase())) return false;
    if (search.matQuery) {
      const q = search.matQuery.trim().toLowerCase();
      const modelNo = (matMap.get(t.materialId) ?? "").toLowerCase();
      const alias  = (matAliasMap.get(t.materialId) ?? "").toLowerCase();
      if (
        !t.materialId.toLowerCase().includes(q) &&
        !t.materialName.toLowerCase().includes(q) &&
        !modelNo.includes(q) &&
        !alias.includes(q) &&
        !((t.serialNo ?? "").toLowerCase().includes(q))
      ) return false;
    }
    if (isInbound && search.vendorName) {
      const vn = resolveVendor(t);
      if (!vn.toLowerCase().includes(search.vendorName.toLowerCase())) return false;
    }
    return true;
  });

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp: number;
      if (av == null && bv == null) cmp = 0;
      else if (av == null) cmp = 1;
      else if (bv == null) cmp = -1;
      else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), "ko");
      const primary = sortDir === "asc" ? cmp : -cmp;
      if (primary !== 0) return primary;
      // 2차 정렬: 같은 1차 키(예: 동일 일자) 내에서는 입·출고번호로 묶어 보이게
      // transactionNo 는 I-/O-YY-MM-NNN 형식 — 문자열 비교로 자연 그룹화됨
      const an = a.transactionNo ?? "";
      const bn = b.transactionNo ?? "";
      const nocmp = an.localeCompare(bn);
      if (nocmp !== 0) return sortDir === "asc" ? nocmp : -nocmp;
      // 3차: 같은 전표 내에서는 id 순으로 안정적 배열
      return sortDir === "asc" ? a.id - b.id : b.id - a.id;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  // 출고 모드 한정: 회수 상태별 건수 집계 (합계 요약 표시용)
  const returnCounts = useMemo(() => {
    if (isInbound) return { unused: 0, scrap: 0 };
    let unused = 0, scrap = 0;
    for (const t of sorted) {
      if (t.returnStatus !== "returned") continue;
      if (t.returnType === "unused") unused++;
      else if (t.returnType === "scrap") scrap++;
    }
    return { unused, scrap };
  }, [sorted, isInbound]);

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
    // 선택이 있으면 선택 ∩ 검색결과, 없으면 검색결과(sorted) 전체 — 전체 transactions 를 쓰면 필터가 무시됨
    const list = selectedIds.size > 0
      ? sorted.filter(t => selectedIds.has(t.id))
      : sorted;
    const label = selectedIds.size > 0 ? `선택${list.length}건` : "전체";
    const rows = list.map(t => {
      const base: Record<string, string | number> = {
        일자: fmtDateOnly(t.createdAt),
        자재코드: t.materialId,
        자재명: t.materialName,
        규격: matMap.get(t.materialId) ?? "",
        "S/N": t.serialNo ?? "",
        수량: t.qty,
        [isInbound ? "입고단가" : "출고단가"]: showFin ? (t.unitPrice ?? 0) : "",
        [isInbound ? "입고금액" : "출고금액"]: showFin ? (t.unitPrice ?? 0) * t.qty : "",
      };
      if (showStock) {
        base["이전재고"] = t.prevStock;
        base["이후재고"] = t.afterStock;
      }
      base["현장"] = t.siteName ?? "";
      base["호기"] = t.elevatorName ?? "";
      if (isInbound) {
        base["거래처"] = resolveVendor(t);
        base["신청자"] = t.requesterName ?? requesterMap.get(t.id) ?? "";
      }
      if (!isInbound) {
        base["수령인"] = receiverMap.get(t.id) ?? "";
        base["회수"] = !t.requiresReturn ? "" : t.returnStatus === "returned" ? "반납완료" : "대기";
      }
      if (showProcessor) base["처리자"] = t.userName;
      if (showNote) base["비고"] = t.note ?? "";
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


  const def = defaultSearch();
  const hasFilter = search.dateFrom !== def.dateFrom || search.dateTo !== def.dateTo || search.siteName || search.userName || search.matQuery || search.vendorName;

  return (
    <>
      {/* 툴바 */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* 회사구분 필터 (자재코드 기준 TK/DS) */}
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
          <SiteSearchInput
            value={search.siteName}
            onChange={v => setSearch(p => ({ ...p, siteName: v }))}
            sites={sites}
          />
          <Autocomplete
            value={search.userName}
            onChange={v => setSearch(p => ({ ...p, userName: v }))}
            items={userNames}
            placeholder="처리자"
            width="w-28"
          />
          {isInbound && (
            <Autocomplete
              value={search.vendorName}
              onChange={v => setSearch(p => ({ ...p, vendorName: v }))}
              items={vendorNames}
              placeholder="거래처"
              width="w-32"
            />
          )}
          {hasFilter && (
            <button type="button" onClick={() => setSearch(defaultSearch())}
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 underline">초기화</button>
          )}
          <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 shrink-0 cursor-pointer select-none">
            <input type="checkbox" checked={showStock} onChange={e => setShowStock(e.target.checked)}
              className="h-3.5 w-3.5 rounded cursor-pointer" />
            재고변동
          </label>
          <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 shrink-0 cursor-pointer select-none">
            <input type="checkbox" checked={showProcessor} onChange={e => setShowProcessor(e.target.checked)}
              className="h-3.5 w-3.5 rounded cursor-pointer" />
            처리자
          </label>
          <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 shrink-0 cursor-pointer select-none">
            <input type="checkbox" checked={showNote} onChange={e => setShowNote(e.target.checked)}
              className="h-3.5 w-3.5 rounded cursor-pointer" />
            비고
          </label>
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

      {/* 목록 — 모바일: 카드 / PC: 테이블 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isMobile ? (
          sorted.length === 0 ? (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500">
              {transactions.length === 0 ? `${mode} 내역이 없습니다.` : "조건에 맞는 내역이 없습니다."}
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {sorted.map(t => (
                <div key={t.id} className="p-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className={`font-mono text-xs ${isTkMaterial(t.materialId) ? TK_TEXT_CLASS : "text-gray-500 dark:text-gray-400"}`}>{t.materialId}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">{fmtDateOnly(t.createdAt)}</span>
                  </div>
                  <p className={`font-medium mt-0.5 ${isTkMaterial(t.materialId) ? TK_TEXT_CLASS : "text-gray-800 dark:text-gray-100"}`}>{t.materialName}</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-gray-600 dark:text-gray-300 mt-1">
                    <div><span className="text-gray-400">규격 </span>{matMap.get(t.materialId) || "-"}</div>
                    <div><span className="text-gray-400">수량 </span>{fmtNum(t.qty)}</div>
                    {showStock && <div><span className="text-gray-400">재고 </span>{fmtNum(t.prevStock)} → {fmtNum(t.afterStock)}</div>}
                    <div className="truncate"><span className="text-gray-400">현장 </span>{t.siteName ?? "-"}{t.elevatorName ? ` (${t.elevatorName})` : ""}</div>
                    {isInbound && (t.requesterName ?? requesterMap.get(t.id)) && (
                      <div className="truncate"><span className="text-gray-400">신청자 </span>{t.requesterName ?? requesterMap.get(t.id)}</div>
                    )}
                    {!isInbound && receiverMap.get(t.id) && (
                      <div className="truncate"><span className="text-gray-400">수령인 </span>{receiverMap.get(t.id)}</div>
                    )}
                    {showFin && <div><span className="text-gray-400">단가 </span>₩{fmtNum(t.unitPrice ?? 0)}</div>}
                    {showFin && <div><span className="text-gray-400">금액 </span>₩{fmtNum((t.unitPrice ?? 0) * t.qty)}</div>}
                    {t.serialNo && <div className="col-span-2"><span className="text-gray-400">S/N </span><span className="font-mono">{t.serialNo}</span></div>}
                    {showProcessor && <div><span className="text-gray-400">담당 </span>{t.userName}</div>}
                    {showNote && t.note && <div className="col-span-2"><span className="text-gray-400">비고 </span>{t.note}</div>}
                  </div>
                  {!isInbound && (
                    <div className="mt-2 text-xs">
                      {t.returnStatus === "returned" ? (
                        <span
                          title={[
                            t.returnType === "unused" ? "미사용 반납 (재입고)" : "폐자재 회수",
                            t.returnedAt ? fmtDateOnly(t.returnedAt) : null,
                            t.returnedByUserName,
                          ].filter(Boolean).join(" · ")}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold border ${
                            t.returnType === "unused"
                              ? "bg-blue-100 text-blue-800 border-blue-400 dark:bg-blue-900/60 dark:text-blue-200 dark:border-blue-600 ring-1 ring-blue-200 dark:ring-blue-800/50"
                              : "bg-green-100 text-green-800 border-green-400 dark:bg-green-900/60 dark:text-green-200 dark:border-green-600 ring-1 ring-green-200 dark:ring-green-800/50"
                          }`}
                        >
                          <span className="text-[10px] leading-none">↩</span>
                          {t.returnType === "unused" ? "미사용반납" : "폐자재회수"}
                          {t.returnedAt && <span className="font-normal opacity-70 ml-0.5">({fmtDateOnly(t.returnedAt).slice(5)})</span>}
                        </span>
                      ) : t.requiresReturn ? (
                        admin ? (
                          <button type="button" disabled={actionLoading === t.id} onClick={() => handleReturn(t, "반납등록")}
                            className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 hover:bg-orange-200 disabled:opacity-50">폐자재회수</button>
                        ) : <span className="px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">반납 대기</span>
                      ) : admin ? (
                        <button type="button" disabled={actionLoading === t.id} onClick={() => handleReturn(t, "미사용반납")}
                          className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 hover:bg-sky-100 disabled:opacity-50">미사용반납</button>
                      ) : null}
                    </div>
                  )}
                  {admin && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      <Link href={isInbound ? `/inbound/edit?id=${t.id}` : `/outbound/edit?id=${t.id}`}
                        className="text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors">전표수정</Link>
                      <button type="button" disabled={actionLoading === t.id} onClick={() => setEditingTx(t)}
                        className="text-xs px-2 py-1 rounded-lg bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors">단건수정</button>
                      <button type="button" disabled={actionLoading === t.id} onClick={() => handleDelete(t.id)}
                        className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors">취소</button>
                    </div>
                  )}
                </div>
              ))}
              <div className="p-4 bg-gray-50 dark:bg-gray-700/40 font-semibold text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span>합계 {fmtNum(sorted.length)}건</span>
                  <span>수량 {fmtNum(sorted.reduce((a, c) => a + c.qty, 0))}{showFin ? ` · ₩${fmtNum(sorted.reduce((a, c) => a + c.qty * (c.unitPrice ?? 0), 0))}` : ""}</span>
                </div>
                {!isInbound && (returnCounts.unused > 0 || returnCounts.scrap > 0) && (
                  <div className="flex items-center gap-1.5 flex-wrap justify-end text-xs">
                    {returnCounts.unused > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold border bg-blue-100 text-blue-800 border-blue-400 dark:bg-blue-900/60 dark:text-blue-200 dark:border-blue-600">
                        <span className="text-[10px] leading-none">↩</span>
                        미사용반납 {fmtNum(returnCounts.unused)}건
                      </span>
                    )}
                    {returnCounts.scrap > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold border bg-green-100 text-green-800 border-green-400 dark:bg-green-900/60 dark:text-green-200 dark:border-green-600">
                        <span className="text-[10px] leading-none">↩</span>
                        폐자재회수 {fmtNum(returnCounts.scrap)}건
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        ) : (
        <div className="overflow-auto max-h-[calc(100vh-250px)]">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-700">
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
              {columns.filter(c => (!c.outboundOnly || !isInbound) && (!c.inboundOnly || isInbound) && (c.optional === "note" ? showNote : c.optional === "processor" ? showProcessor : c.optional === "stock" ? showStock : true)).map(c => {
                const active = c.sortable && c.key === sortKey;
                const padCls = c.label === "일자" ? "pl-2 pr-0" : "px-2";
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
                <td className="px-2 py-3 text-left font-mono text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">{t.transactionNo ?? "-"}</td>
                <td className={`px-2 py-3 text-left font-mono whitespace-nowrap ${isTkMaterial(t.materialId) ? TK_TEXT_CLASS : "text-black dark:text-white"}`}>{t.materialId}</td>
                <td className={`px-2 py-3 text-left font-medium max-w-[200px] ${isTkMaterial(t.materialId) ? TK_TEXT_CLASS : "text-black dark:text-white"}`}>
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="truncate">{t.materialName}</span>
                    <PhotoIconBtn urls={matImgMap.get(t.materialId) ?? []} />
                  </div>
                </td>
                <td className="px-2 py-3 text-left text-black dark:text-white whitespace-nowrap">{matMap.get(t.materialId) || "-"}</td>
                <td className="px-2 py-3 text-left font-mono text-black dark:text-white whitespace-nowrap max-w-[140px] truncate">
                  {t.serialNo || "-"}
                </td>
                <td className="px-2 py-3 text-center tabular-nums text-black dark:text-white">
                  {fmtNum(t.qty)}
                </td>
                <td className="px-2 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {showFin ? `₩${fmtNum(t.unitPrice ?? 0)}` : ""}
                </td>
                <td className={`px-2 py-3 text-right tabular-nums font-semibold whitespace-nowrap ${isInbound ? "text-blue-600 dark:text-blue-400" : "text-orange-500 dark:text-orange-400"}`}>
                  {showFin ? `₩${fmtNum((t.unitPrice ?? 0) * t.qty)}` : ""}
                </td>
                {showStock && (
                  <td className="px-2 py-3 text-center tabular-nums text-black dark:text-white whitespace-nowrap">
                    {fmtNum(t.prevStock)} → <span className="font-medium">{fmtNum(t.afterStock)}</span>
                  </td>
                )}
                <td className="px-2 py-3 text-left text-black dark:text-white whitespace-nowrap">
                  {t.siteName ?? "-"}{t.elevatorName ? <span className="ml-1 opacity-70">({t.elevatorName})</span> : null}
                </td>
                {isInbound && (
                  <td className="px-2 py-3 text-left text-black dark:text-white whitespace-nowrap">
                    {t.requesterName ?? requesterMap.get(t.id) ?? "-"}
                  </td>
                )}
                {!isInbound && (
                  <td className="px-2 py-3 text-left text-black dark:text-white whitespace-nowrap">
                    {receiverMap.get(t.id) || "-"}
                  </td>
                )}
                {!isInbound && (
                  <td className="px-2 py-3 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    {t.returnStatus === "returned" ? (
                      <span
                        title={[
                          t.returnType === "unused" ? "미사용 반납 (재입고)" : "폐자재 회수",
                          t.returnedAt ? fmtDateOnly(t.returnedAt) : null,
                          t.returnedByUserName,
                        ].filter(Boolean).join(" · ")}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${
                          t.returnType === "unused"
                            ? "bg-blue-100 text-blue-800 border-blue-400 dark:bg-blue-900/60 dark:text-blue-200 dark:border-blue-600 ring-1 ring-blue-200 dark:ring-blue-800/50"
                            : "bg-green-100 text-green-800 border-green-400 dark:bg-green-900/60 dark:text-green-200 dark:border-green-600 ring-1 ring-green-200 dark:ring-green-800/50"
                        }`}
                      >
                        <span className="text-[10px] leading-none">↩</span>
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
                {showProcessor && (
                  <td className="px-2 py-3 text-center text-black dark:text-white whitespace-nowrap">{t.userName}</td>
                )}
                {showNote && (
                  <td className="px-2 py-3 text-center text-black dark:text-white max-w-[140px] truncate">{t.note ?? "-"}</td>
                )}
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
              <tr className="bg-gray-50 dark:bg-gray-700 font-semibold border-t border-gray-200 dark:border-gray-700">
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
                <td colSpan={(isInbound ? 4 : 6) + (admin ? 1 : 0)} className="px-2 py-3 text-right">
                  {!isInbound && (returnCounts.unused > 0 || returnCounts.scrap > 0) && (
                    <div className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                      {returnCounts.unused > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border bg-blue-100 text-blue-800 border-blue-400 dark:bg-blue-900/60 dark:text-blue-200 dark:border-blue-600">
                          <span className="text-[10px] leading-none">↩</span>
                          미사용반납 {fmtNum(returnCounts.unused)}건
                        </span>
                      )}
                      {returnCounts.scrap > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border bg-green-100 text-green-800 border-green-400 dark:bg-green-900/60 dark:text-green-200 dark:border-green-600">
                          <span className="text-[10px] leading-none">↩</span>
                          폐자재회수 {fmtNum(returnCounts.scrap)}건
                        </span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        )}
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
  const { viewMode } = useViewMode();
  const isMobile = viewMode === "mobile";
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
      panelClassName={isMobile ? "w-full max-w-[640px] mx-4 max-h-[90vh]" : "w-[640px]"}
      header={
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">일괄 출고</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">&times;</button>
        </div>
      }
    >
      <div className={`p-5 space-y-4 ${isMobile ? "force-mobile" : ""}`}>
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
              <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
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

// ── 현장명 검색 입력 (별칭·search_keywords 자동완성 지원) ──────────────
function SiteSearchInput({ value, onChange, sites }: {
  value: string;
  onChange: (v: string) => void;
  sites: SiteOption[];
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const v = value.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!v) return [] as SiteOption[];
    return sites.filter(s =>
      s.name.toLowerCase().includes(v) ||
      (s.alias?.toLowerCase().includes(v) ?? false) ||
      (s.search_keywords?.toLowerCase().includes(v) ?? false)
    ).slice(0, 10);
  }, [v, sites]);

  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const showDropdown = open && focused && suggestions.length > 0;

  return (
    <div ref={ref} className="relative">
      <input
        type="text" lang="ko" autoComplete="off" placeholder="현장명·키워드"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => { setFocused(true); setOpen(true); }}
        onBlur={() => setFocused(false)}
        className={inputCls() + " w-44"}
      />
      {showDropdown && (
        <ul className="absolute z-50 top-full left-0 mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {suggestions.map(s => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(s.name); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs text-gray-800 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                <div className="truncate">{s.name}</div>
                {(s.alias || s.search_keywords) && (
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                    {[s.alias, s.search_keywords].filter(Boolean).join(" · ")}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
