"use client";

import { useState, useMemo, Fragment, useRef, useEffect, useCallback } from "react";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { MaterialRequestRecord, RequestStatus, RequestType } from "@/lib/mock-material-requests";
import { PurchaseOrderRecord, OrderStatus } from "@/lib/mock-purchase-orders";
import { TransactionRecord } from "@/lib/mock-transactions";
import { useAuth, isViewOnly, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { useViewMode } from "@/context/ViewModeContext";
import StockHistoryClient from "@/components/stock/StockHistoryClient";
import PurchaseOrderBulkUploadModal from "@/components/purchase/PurchaseOrderBulkUploadModal";
import { api, getErrorMessage } from "@/lib/api-client";
import { fmtNum, fmtNumOr } from "@/lib/format";
import { isTkMaterial, TK_TEXT_CLASS } from "@/lib/material-style";
import { extractOrderRef } from "@/lib/order-ref";
import DraggableModal from "@/components/common/DraggableModal";
import Autocomplete from "@/components/common/Autocomplete";

interface SiteOption   { id: number; name: string }
interface VendorOption { id: number; name: string }

interface Props {
  initialRequests:  MaterialRequestRecord[];
  initialOrders:    PurchaseOrderRecord[];
  initialInbound:   TransactionRecord[];
  initialOutbound:  TransactionRecord[];
  mode?: "all" | "requests-only" | "orders-only";
  materialAliases?: Record<string, string>;
}

const TABS = ["자재신청", "발주", "입고", "출고"] as const;
type Tab = typeof TABS[number];

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function fmtDateOnly(iso: string) {
  return iso.substring(0, 10);
}

function today() { return new Date().toISOString().substring(0, 10); }

interface ReqSearch { dateFrom: string; dateTo: string; siteName: string; elevatorName: string; userName: string; material: string }
interface OrdSearch { dateFrom: string; dateTo: string; siteName: string; vendorName: string; userName: string; requesterName: string; material: string }

function defaultReq(): ReqSearch {
  // 기본 검색기간: 당월(1일 ~ 말일)
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const to = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
  return { dateFrom: from, dateTo: to, siteName: "", elevatorName: "", userName: "", material: "" };
}
function defaultOrd(): OrdSearch {
  // 기본 기간: 이전주 일요일 ~ 당일(오늘)
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  const curSun = new Date(now); curSun.setDate(now.getDate() - now.getDay());
  const prevSun = new Date(curSun); prevSun.setDate(curSun.getDate() - 7);
  return { dateFrom: ymd(prevSun), dateTo: ymd(now), siteName: "", vendorName: "", userName: "", requesterName: "", material: "" };
}

function inRange(iso: string, from: string, to: string) {
  const d = iso.substring(0, 10);
  if (from && d < from) return false;
  if (to   && d > to)   return false;
  return true;
}

function inputCls() {
  return "px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white dark:bg-gray-700";
}

// 자재명 자동완성 (API 검색)
function MaterialAutocomplete({ value, onChange }: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen]       = useState(false);
  const [results, setResults] = useState<{ name: string; id: string; alias: string | null }[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!value.trim()) { setResults([]); return; }
      try {
        const data = await api.get<{ name: string; id: string; alias?: string | null }[]>(`/api/materials?q=${encodeURIComponent(value)}`);
        setResults(data.slice(0, 10).map(m => ({
          name: m.name, id: m.id, alias: m.alias ?? null,
        })));
        setOpen(true);
      } catch { setResults([]); setOpen(false); }
    }, value.trim() ? 150 : 0);
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        lang="ko"
        placeholder="자재명·코드·규격·별칭"
        value={value}
        onChange={e => { onChange(e.target.value); }}
        onFocus={() => results.length > 0 && setOpen(true)}
        className={`${inputCls()} w-40`}
      />
      {open && results.length > 0 && (
        <ul className="absolute z-50 top-full left-0 mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {results.map((m, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(m.name); setOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
              >
                <span className="text-xs font-medium text-gray-800 dark:text-gray-200">{m.name}</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-2 font-mono">{m.id}</span>
                {m.alias && <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1">({m.alias})</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


const REQ_STATUS_STYLE: Record<RequestStatus, string> = {
  "신청":   "",  // 동적 처리 — reqStatusCls() 사용
  "처리중": "bg-yellow-50 text-yellow-700",
  "완료":   "bg-green-50 text-green-700",
  "취소":   "bg-gray-100 text-gray-400",
};

type MatKind = "DS" | "TK" | "혼합";
function matKind(ids: string[]): MatKind {
  const hasDs = ids.some(id => id.startsWith("D"));
  const hasTk = ids.some(id => !id.startsWith("D"));
  if (hasDs && hasTk) return "혼합";
  return hasDs ? "DS" : "TK";
}
const KIND_CLS: Record<MatKind, string> = {
  DS:   "bg-red-50 text-red-600",
  TK:   "bg-blue-50 text-blue-600",
  혼합: "bg-green-50 text-green-700",
};
function reqStatusCls(status: RequestStatus, kind: MatKind) {
  if (status !== "신청") return REQ_STATUS_STYLE[status];
  return KIND_CLS[kind];
}
const ORD_STATUS_STYLE: Record<OrderStatus, string> = {
  "발주":     "bg-indigo-50 text-indigo-600",
  "입고완료": "bg-green-50 text-green-700",
  "취소":     "bg-gray-100 text-gray-400",
};

type SortDir = "asc" | "desc";
type ReqSortKey = "requestedAt" | "status" | "siteName" | "totalQty" | "requesterName";
type OrdSortKey = "orderedAt" | "status" | "materialName" | "materialId" | "qty" | "siteName" | "elevatorName" | "requesterName" | "vendorName" | "unitPrice" | "userName";

const REQ_COLS: { key: ReqSortKey | null; label: string; sortable: boolean }[] = [
  { key: null,            label: "",         sortable: false }, // expand toggle
  { key: "requestedAt",   label: "신청일시", sortable: true  },
  { key: "status",        label: "상태",     sortable: true  },
  { key: null,            label: "구분",     sortable: false },
  { key: "siteName",      label: "현장",     sortable: true  },
  { key: null,            label: "자재 요약", sortable: false },
  { key: "totalQty",      label: "총 수량",  sortable: true  },
  { key: "requesterName", label: "신청자",   sortable: true  },
  { key: null,            label: "메모",     sortable: false },
];

const REQ_TYPE_CLS: Record<RequestType, string> = {
  "무상신청":   "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "당직선출고": "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "유상견적":   "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
};

type OrdColToggle = "ref" | "no";  // 참조번호 / 발주번호 표시 여부 토글 대상
const ORD_COLS: { key: OrdSortKey | null; label: string; sortable: boolean; toggle?: OrdColToggle }[] = [
  { key: "orderedAt",     label: "발주일자",      sortable: true  },
  { key: null,            label: "참조번호",     sortable: false, toggle: "ref" },
  { key: null,            label: "발주번호",     sortable: false, toggle: "no"  },
  { key: "materialId",    label: "코드",          sortable: true  },
  { key: "materialName",  label: "자재명",        sortable: true  },
  { key: null,            label: "규격",          sortable: false },
  { key: "qty",           label: "수량",          sortable: true  },
  { key: "siteName",      label: "현장",     sortable: true  },
  { key: "elevatorName",  label: "호기",     sortable: true  },
  { key: "requesterName", label: "신청자",   sortable: true  },
  { key: "vendorName",    label: "거래처",   sortable: true  },
  { key: "unitPrice",     label: "판매단가",     sortable: true  },
  { key: null,            label: "적요",     sortable: false },
];

function compareSort<T>(a: T, b: T, dir: SortDir) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  let cmp: number;
  if (typeof a === "number" && typeof b === "number") cmp = a - b;
  else cmp = String(a).localeCompare(String(b), "ko");
  return dir === "asc" ? cmp : -cmp;
}

export default function RequestsClient({ initialRequests, initialOrders, initialInbound, initialOutbound, mode = "all", materialAliases = {} }: Props) {
  const { viewMode } = useViewMode();
  const isMobile = viewMode === "mobile";
  const defaultTab: Tab = mode === "orders-only" ? "발주" : "자재신청";
  const [tab, setTab]       = useState<Tab>(defaultTab);
  const [requests, setRequests] = useState(initialRequests);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [requesterNames, setRequesterNames] = useState<string[]>([]);
  const [userNames, setUserNames] = useState<string[]>([]);
  const [orders,   setOrders]   = useState(initialOrders);
  const [showOrderBulkUpload, setShowOrderBulkUpload] = useState(false);
  const [matModelMap, setMatModelMap] = useState<Map<string, string>>(new Map()); // materialId → modelNo(규격)

  // 숨어 있던 탭이 다시 보일 때 신청/발주 목록을 다시 받아 stale 방지
  const reloadData = useCallback(() => {
    api.get<MaterialRequestRecord[]>("/api/material-requests").then(setRequests).catch(() => {});
    api.get<PurchaseOrderRecord[]>("/api/purchase-orders").then(setOrders).catch(() => {});
  }, []);
  useReloadOnActivate(reloadData);

  useEffect(() => {
    function refreshOrders() {
      api.get<PurchaseOrderRecord[]>("/api/purchase-orders").then(setOrders).catch(() => {});
    }
    function refreshRequests() {
      api.get<MaterialRequestRecord[]>("/api/material-requests").then(setRequests).catch(() => {});
    }
    window.addEventListener("ds:purchase_orders_changed", refreshOrders);
    window.addEventListener("ds:material_requests_changed", refreshRequests);
    return () => {
      window.removeEventListener("ds:purchase_orders_changed", refreshOrders);
      window.removeEventListener("ds:material_requests_changed", refreshRequests);
    };
  }, []);

  useEffect(() => {
    api.get<MaterialRequestRecord[]>("/api/material-requests").then(setRequests).catch(() => {});
    api.get<PurchaseOrderRecord[]>("/api/purchase-orders").then(setOrders).catch(() => {});
    api.get<SiteOption[]>("/api/sites").then(setSites).catch(() => {});
    api.get<VendorOption[]>("/api/vendors").then(setVendors).catch(() => {});
    api.get<{ name: string; status: string | null }[]>("/api/users")
      .then(data => {
        const active = data.filter(u => u.status === "재직").map(u => u.name).sort();
        setRequesterNames(active);
        setUserNames(active);
      })
      .catch(() => {});
    api.get<{ id: string; modelNo: string | null }[]>("/api/materials")
      .then(data => {
        const m = new Map<string, string>();
        data.forEach(x => m.set(x.id, x.modelNo ?? ""));
        setMatModelMap(m);
      })
      .catch(() => {});
  }, []);

  // 자재신청 탭
  const [reqStatus,     setReqStatus]     = useState<RequestStatus | "전체">("전체");
  const [reqCompany,    setReqCompany]    = useState<"전체" | "TK" | "DS">("전체");
  const [reqType,       setReqType]       = useState<RequestType | "기본" | "전체">("전체");
  const [reqSearch,     setReqSearch]     = useState<ReqSearch>(defaultReq);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const router = useRouter();

  // 발주 탭
  const [ordStatus,    setOrdStatus]    = useState<OrderStatus | "전체">("전체");
  const [ordCompany,   setOrdCompany]   = useState<"전체" | "TK" | "DS">("전체");
  const [ordDraft,     setOrdDraft]     = useState<OrdSearch>(defaultOrd);
  const [ordSearch,    setOrdSearch]    = useState<OrdSearch>(defaultOrd);

  // 정렬
  const [reqSortKey, setReqSortKey] = useState<ReqSortKey>("requestedAt");
  const [reqSortDir, setReqSortDir] = useState<SortDir>("desc");
  const [ordSortKey, setOrdSortKey] = useState<OrdSortKey>("orderedAt");
  const [ordSortDir, setOrdSortDir] = useState<SortDir>("desc");
  const [selectedReqIds, setSelectedReqIds] = useState<Set<number>>(new Set());
  const [selectedOrdIds, setSelectedOrdIds] = useState<Set<number>>(new Set());

  // 발주 리스트 컬럼 표시 토글 (참조번호 / 발주번호) — localStorage에 마지막 선택 보존
  // 기본: 참조번호 ON, 발주번호 OFF
  const [showOrderRefCol, setShowOrderRefCol] = useState<boolean>(true);
  const [showOrderNoCol,  setShowOrderNoCol]  = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ref = localStorage.getItem("ds_ord_col_ref");
    const no  = localStorage.getItem("ds_ord_col_no");
    if (ref !== null) setShowOrderRefCol(ref === "1");
    if (no  !== null) setShowOrderNoCol(no === "1");
  }, []);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("ds_ord_col_ref", showOrderRefCol ? "1" : "0"); }, [showOrderRefCol]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("ds_ord_col_no",  showOrderNoCol  ? "1" : "0"); }, [showOrderNoCol]);

  function toggleReqSort(key: ReqSortKey) {
    if (key === reqSortKey) setReqSortDir(d => d === "asc" ? "desc" : "asc");
    else { setReqSortKey(key); setReqSortDir("asc"); }
  }
  function toggleOrdSort(key: OrdSortKey) {
    if (key === ordSortKey) setOrdSortDir(d => d === "asc" ? "desc" : "asc");
    else { setOrdSortKey(key); setOrdSortDir("asc"); }
  }

  const { user } = useAuth();
  const admin = user ? !isViewOnly(user) : false;
  // 자재신청 가시성: admin 또는 권한그룹에서 /requests:read 부여자는 전체, 그 외는 같은 팀(users.dept) 신청만
  const restrictToTeam = user ? (!isAdmin(user) && !hasMenuPermission(user, "/requests", "read")) : false;
  // 자재신청 처리(상태 변경): admin 또는 권한그룹 /requests:update 부여자
  const canEditReq = user ? (admin || hasMenuPermission(user, "/requests", "update")) : false;
  // 자재신청 조회 전체(엑셀 다운로드 포함): admin/!isViewOnly 또는 read 권한자
  const canViewAllReq = user ? (admin || hasMenuPermission(user, "/requests", "read")) : false;
  const visibleRequests = useMemo(() => {
    if (!restrictToTeam || !user) return requests;
    const dept = (user.dept ?? "").trim();
    return requests.filter(r => dept ? r.requesterDept === dept : r.requesterId === user.id);
  }, [requests, restrictToTeam, user]);

  // ── 자재신청 액션 ────────────────────────────────────────────────
  async function handleReqAction(id: number, action: string) {
    if (!user) return;
    setActionLoading(id);
    try {
      await api.patch(`/api/material-requests/${id}`, { action, processorId: user.id, processorName: user.name });
      setRequests(await api.get<MaterialRequestRecord[]>("/api/material-requests"));
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setActionLoading(null);
    }
  }

  // ── 발주 액션 ────────────────────────────────────────────────────
  async function handleOrdAction(id: number, action: string, data?: Record<string, unknown>) {
    if (!user) return;
    setActionLoading(id);
    try {
      await api.patch(`/api/purchase-orders/${id}`, { action, userId: user.id, userName: user.name, ...data });
      setOrders(await api.get<PurchaseOrderRecord[]>("/api/purchase-orders"));
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleOrdDelete(id: number) {
    if (!user) return;
    if (!confirm("이 발주 내역을 삭제하시겠습니까? 삭제 후에는 복구할 수 없습니다.")) return;
    setActionLoading(id);
    try {
      await api.delete(`/api/purchase-orders/${id}`);
      setOrders(await api.get<PurchaseOrderRecord[]>("/api/purchase-orders"));
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setActionLoading(null);
    }
  }

  const [bulkInboundLoading, setBulkInboundLoading] = useState(false);
  const [bulkInboundOpen, setBulkInboundOpen] = useState(false);

  function openBulkInboundModal() {
    const targets = orders.filter(o => selectedOrdIds.has(o.id) && o.status === "발주");
    if (targets.length === 0) {
      alert("입고 처리 가능한 발주(상태=발주)가 선택되지 않았습니다.");
      return;
    }
    setBulkInboundOpen(true);
  }

  async function handleBulkInboundSubmit(receivedAt: string) {
    if (!user) return;
    const targets = orders.filter(o => selectedOrdIds.has(o.id) && o.status === "발주");
    if (targets.length === 0) return;
    setBulkInboundLoading(true);
    const fails: string[] = [];
    for (const o of targets) {
      try {
        await api.patch(`/api/purchase-orders/${o.id}`, {
          action: "입고완료", userId: user.id, userName: user.name, receivedAt,
        });
      } catch (e) {
        fails.push(`${o.materialName}: ${(e as Error).message}`);
      }
    }
    setOrders(await api.get<PurchaseOrderRecord[]>("/api/purchase-orders"));
    setSelectedOrdIds(new Set());
    setBulkInboundLoading(false);
    setBulkInboundOpen(false);
    if (fails.length > 0) {
      alert(`${targets.length - fails.length}건 처리 완료. 실패 ${fails.length}건:\n` + fails.join("\n"));
    }
  }

  // ── 필터 (가시성 = 본인만 또는 전체) ─────────────────────────────
  const filteredReqs = visibleRequests.filter(r => {
    if (reqStatus !== "전체" && r.status !== reqStatus) return false;
    if (reqCompany !== "전체") {
      const hasTk = r.items.some(i => isTkMaterial(i.materialId));
      const hasDs = r.items.some(i => !isTkMaterial(i.materialId));
      if (reqCompany === "TK" && !hasTk) return false;
      if (reqCompany === "DS" && !hasDs) return false;
    }
    if (reqType !== "전체") {
      if (reqType === "기본") {
        if (r.requestType != null) return false;
      } else if (r.requestType !== reqType) return false;
    }
    if (!inRange(r.requestedAt, reqSearch.dateFrom, reqSearch.dateTo)) return false;
    if (reqSearch.siteName     && !(r.siteName?.toLowerCase().includes(reqSearch.siteName.toLowerCase()))) return false;
    if (reqSearch.elevatorName && !r.items.some(i => i.elevatorName?.toLowerCase().includes(reqSearch.elevatorName.toLowerCase()))) return false;
    if (reqSearch.userName     && !r.requesterName.toLowerCase().includes(reqSearch.userName.toLowerCase())) return false;
    if (reqSearch.material) {
      const q = reqSearch.material.toLowerCase();
      if (!r.items.some(i =>
        i.materialName.toLowerCase().includes(q) ||
        i.materialId.toLowerCase().includes(q) ||
        (materialAliases[i.materialId]?.toLowerCase().includes(q) ?? false)
      )) return false;
    }
    return true;
  });

  // 펼치기 상태
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const sortedReqs = useMemo(() => {
    const arr = [...filteredReqs];
    arr.sort((a, b) => {
      const av = reqSortKey === "totalQty" ? a.items.reduce((s, i) => s + i.qty, 0) : a[reqSortKey];
      const bv = reqSortKey === "totalQty" ? b.items.reduce((s, i) => s + i.qty, 0) : b[reqSortKey];
      return compareSort(av, bv, reqSortDir);
    });
    return arr;
  }, [filteredReqs, reqSortKey, reqSortDir]);

  const filteredOrds = orders.filter(o => {
    if (ordStatus !== "전체" && o.status !== ordStatus) return false;
    if (ordCompany !== "전체") {
      const isTk = isTkMaterial(o.materialId);
      if (ordCompany === "TK" && !isTk) return false;
      if (ordCompany === "DS" && isTk) return false;
    }
    if (!inRange(o.orderedAt, ordSearch.dateFrom, ordSearch.dateTo)) return false;
    if (ordSearch.siteName     && !(o.siteName?.toLowerCase().includes(ordSearch.siteName.toLowerCase()))) return false;
    if (ordSearch.vendorName   && !(o.vendorName?.toLowerCase().includes(ordSearch.vendorName.toLowerCase()))) return false;
    if (ordSearch.userName     && !o.userName.toLowerCase().includes(ordSearch.userName.toLowerCase())) return false;
    if (ordSearch.requesterName && !(o.requesterName?.toLowerCase().includes(ordSearch.requesterName.toLowerCase()))) return false;
    if (ordSearch.material) {
      const q = ordSearch.material.toLowerCase();
      if (!o.materialName.toLowerCase().includes(q) && !o.materialId.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const sortedOrds = useMemo(() => {
    const arr = [...filteredOrds];
    arr.sort((a, b) => compareSort(a[ordSortKey], b[ordSortKey], ordSortDir));
    return arr;
  }, [filteredOrds, ordSortKey, ordSortDir]);

  function xlsxDownload(rows: Record<string, unknown>[], sheetName: string, fileName: string) {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  }

  function downloadReqs() {
    const stamp = new Date().toISOString().slice(0,10).replace(/-/g,"");
    const list = selectedReqIds.size > 0
      ? requests.filter(r => selectedReqIds.has(r.id))
      : requests;
    const label = selectedReqIds.size > 0 ? `선택${selectedReqIds.size}건` : "전체";
    const rows = list.flatMap(r =>
      r.items.map(item => ({
        신청일시: fmtDate(r.requestedAt),
        상태: r.status,
        현장: r.siteName ?? "",
        호기: item.elevatorName ?? "",
        자재명: item.materialName,
        자재코드: item.materialId,
        구분: item.materialId.startsWith("D") ? "DS" : "TK",
        수량: item.qty,
        신청자: r.requesterName,
        부서: r.requesterDept ?? "",
        메모: r.note ?? "",
      }))
    );
    xlsxDownload(rows, "자재신청", `자재신청_${label}_${stamp}.xlsx`);
  }

  function downloadOrds() {
    const stamp = new Date().toISOString().slice(0,10).replace(/-/g,"");
    const list = selectedOrdIds.size > 0
      ? orders.filter(o => selectedOrdIds.has(o.id))
      : orders;
    const label = selectedOrdIds.size > 0 ? `선택${selectedOrdIds.size}건` : "전체";
    const rows = list.map(o => ({
      발주일자: fmtDateOnly(o.orderedAt),
      참조번호: extractOrderRef(o.note) || "",
      발주번호: o.orderNo || "",
      자재코드: o.materialId,
      자재명: o.materialName,
      규격: matModelMap.get(o.materialId) ?? "",
      수량: o.qty,
      현장: o.siteName ?? "",
      호기: o.elevatorName ?? "",
      신청자: o.requesterName ?? "",
      거래처: o.vendorName ?? "",
      판매단가: o.unitPrice ?? "",
      적요: (o.note ?? "").replace(/^\[[^\]]*\]\s*/, "").trim(),
    }));
    xlsxDownload(rows, "발주", `발주내역_${label}_${stamp}.xlsx`);
  }


  const tabBadge = (count: number, color: string) => count > 0
    ? <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${color}`}>{count}</span>
    : null;

  return (
    <>
      {/* 탭 헤더 — mode가 all일 때만 표시 */}
      {mode === "all" && (
        <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-t-xl overflow-hidden">
          {TABS.filter(t => admin || (t !== "발주" && t !== "입고" && t !== "출고")).map(t => (
            <button key={t} type="button" onClick={() => setTab(t as Tab)}
              className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t
                  ? "border-slate-700 dark:border-slate-300 text-slate-700 dark:text-slate-200"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}>
              {t}
              {t === "자재신청" && tabBadge(visibleRequests.filter(r => r.status === "신청").length, "bg-blue-100 text-blue-600")}
              {t === "발주"     && tabBadge(orders.filter(o => o.status === "발주").length,   "bg-indigo-100 text-indigo-600")}
            </button>
          ))}
        </div>
      )}

      {/* ═══ 자재신청 탭 ═══════════════════════════════════════════ */}
      {tab === "자재신청" && (
        <div className="space-y-3">
          {restrictToTeam && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-100">
                👥 같은 팀 신청만 표시 중
              </span>
              <span className="text-[11px] text-amber-800 dark:text-amber-200">
                관리자가 전체 신청을 처리합니다. 본 화면에서는 본인이 속한 팀({user?.dept ?? "-"}) 사원들의 신청만 보입니다.
              </span>
            </div>
          )}
          {/* 상태 필터 + 구분 필터 + 등록 */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800">
              {(["전체","신청","처리중","완료","취소"] as const).map(f => (
                <button key={f} type="button" onClick={() => setReqStatus(f)}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${reqStatus === f ? "bg-slate-700 text-white" : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}>
                  {f}
                </button>
              ))}
            </div>
            <div className={`flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 ${isMobile ? "order-2" : ""}`}>
              {(["전체","무상신청","당직선출고","유상견적","기본"] as const).map(f => (
                <button key={f} type="button" onClick={() => setReqType(f)}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${reqType === f ? "bg-slate-700 text-white" : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
                  title={f === "기본" ? "전표 입력 등 모드 정보가 없는 신청" : ""}>
                  {f}
                </button>
              ))}
            </div>
            {/* 회사구분 필터 (자재코드 기준 TK/DS) — 모바일에서 상태필터 옆 */}
            <div className={`flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 ${isMobile ? "order-1" : ""}`}>
              {(["전체","TK","DS"] as const).map(f => (
                <button key={f} type="button" onClick={() => setReqCompany(f)}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${
                    reqCompany === f
                      ? f === "TK" ? "bg-blue-600 text-white" : f === "DS" ? "bg-red-500 text-white" : "bg-slate-700 text-white"
                      : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}>
                  {f}
                </button>
              ))}
            </div>
            <Link href="/requests/new"
              className={`ml-auto px-4 py-2.5 rounded-xl text-sm font-semibold bg-slate-700 text-white hover:bg-slate-800 transition-colors ${isMobile ? "order-9" : ""}`}>
              전표 입력
            </Link>
            {canViewAllReq && (
              <button type="button" onClick={downloadReqs}
                className={`bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-green-700 transition-colors ${isMobile ? "order-9" : ""}`}>
                {selectedReqIds.size > 0 ? `선택 ${selectedReqIds.size}건 다운로드` : "엑셀 다운로드"}
              </button>
            )}
          </div>

          {/* 검색 필터 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-2 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">검색</span>
            <div className="flex items-center gap-1.5">
              <input type="date" value={reqSearch.dateFrom} onChange={e => setReqSearch(p => ({...p, dateFrom: e.target.value}))} className={inputCls()} />
              <span className="text-gray-300 dark:text-gray-600 text-xs">~</span>
              <input type="date" value={reqSearch.dateTo}   onChange={e => setReqSearch(p => ({...p, dateTo: e.target.value}))}   className={inputCls()} />
            </div>
            <Autocomplete
              value={reqSearch.siteName}
              onChange={v => setReqSearch(p => ({...p, siteName: v}))}
              items={sites.map(s => s.name)}
              placeholder="현장명"
              width="w-44"
            />
            <MaterialAutocomplete
              value={reqSearch.material}
              onChange={v => setReqSearch(p => ({...p, material: v}))}
            />
            <Autocomplete
              value={reqSearch.userName}
              onChange={v => setReqSearch(p => ({...p, userName: v}))}
              items={requesterNames}
              placeholder="신청자"
              width="w-28"
            />
            <button type="button" onClick={() => setReqSearch(defaultReq())}
              className="px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              초기화
            </button>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{sortedReqs.length}건</span>
          </div>

          {/* 목록 — 모바일: 카드 / PC: 테이블 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {isMobile ? (
              sortedReqs.length === 0 ? (
                <div className="text-center py-16 text-gray-400 dark:text-gray-500">
                  {visibleRequests.length === 0 ? (restrictToTeam ? "같은 팀의 자재 신청 내역이 없습니다." : "자재 신청 내역이 없습니다.") : "조건에 맞는 내역이 없습니다."}
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {sortedReqs.map(r => {
                    const totalQty = r.items.reduce((s, i) => s + i.qty, 0);
                    const kind = matKind(r.items.map(i => i.materialId));
                    const elevators = Array.from(new Set(r.items.map(i => i.elevatorName).filter(Boolean)));
                    const isOpen = expandedIds.has(r.id);
                    return (
                      <div key={r.id} className="p-4">
                        <div onClick={() => toggleExpand(r.id)} className="cursor-pointer">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${reqStatusCls(r.status, kind)}`}>{r.status === "신청" ? kind : r.status}</span>
                              {r.requestType && <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${REQ_TYPE_CLS[r.requestType]}`}>{r.requestType}</span>}
                            </div>
                            <span className="text-xs text-gray-400 dark:text-gray-500">{fmtDate(r.requestedAt)}</span>
                          </div>
                          <p className="font-medium text-gray-800 dark:text-gray-100 mt-1.5">{r.siteName ?? "-"}{elevators.length > 0 && <span className="text-gray-400 dark:text-gray-500"> ({elevators.length}호기)</span>}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">{r.items[0]?.materialName ?? "-"}{r.items.length > 1 ? ` 외 ${r.items.length - 1}건` : ""} · 수량 {totalQty}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.requesterName} ({r.requesterDept}){r.note ? ` · ${r.note}` : ""}</p>
                        </div>
                        {canEditReq && (r.status === "신청" || r.status === "처리중") && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {r.status === "신청" && (
                              <button type="button" disabled={actionLoading === r.id} onClick={() => handleReqAction(r.id, "처리중")}
                                className="text-xs px-2 py-1 rounded-lg bg-yellow-50 text-yellow-700 hover:bg-yellow-100 whitespace-nowrap">처리중</button>
                            )}
                            <button type="button" disabled={actionLoading === r.id} onClick={() => handleReqAction(r.id, "출고처리")}
                              className="text-xs px-2 py-1 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 whitespace-nowrap">출고처리</button>
                            <button type="button" disabled={actionLoading === r.id} onClick={() => handleReqAction(r.id, "취소")}
                              className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200">취소</button>
                          </div>
                        )}
                        {isOpen && (
                          <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-600 p-2 space-y-1">
                            {r.items.map((item, idx) => (
                              <div key={idx} className="flex items-center justify-between gap-2 text-xs">
                                <span className="text-gray-600 dark:text-gray-300 min-w-0 truncate">{item.elevatorName ? `${item.elevatorName} · ` : ""}{item.materialName}</span>
                                <span className="tabular-nums text-gray-700 dark:text-gray-300 shrink-0">{fmtNum(item.qty)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
            <div className="overflow-auto max-h-[calc(100vh-250px)]">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="px-3 py-3 w-8">
                    <input type="checkbox"
                      checked={sortedReqs.length > 0 && sortedReqs.every(r => selectedReqIds.has(r.id))}
                      onChange={() => {
                        if (sortedReqs.length > 0 && sortedReqs.every(r => selectedReqIds.has(r.id)))
                          setSelectedReqIds(new Set());
                        else setSelectedReqIds(new Set(sortedReqs.map(r => r.id)));
                      }}
                      className="h-3.5 w-3.5 rounded cursor-pointer"
                    />
                  </th>
                  {REQ_COLS.map((c, idx) => {
                    const active = c.sortable && c.key === reqSortKey;
                    return (
                      <th key={idx} className="px-2 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {c.sortable && c.key ? (
                          <button type="button" onClick={() => toggleReqSort(c.key as ReqSortKey)}
                            className={`flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200 transition-colors ${active ? "text-gray-700 dark:text-gray-100 font-semibold" : ""}`}>
                            {c.label}
                            <span className={`text-[10px] ${active ? "opacity-100" : "opacity-30"}`}>
                              {active ? (reqSortDir === "asc" ? "▲" : "▼") : "⇅"}
                            </span>
                          </button>
                        ) : c.label}
                      </th>
                    );
                  })}
                  {canEditReq && <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">처리</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {sortedReqs.length === 0 ? (
                  <tr><td colSpan={canEditReq ? 11 : 10} className="text-center py-16 text-gray-400 dark:text-gray-500">
                    {visibleRequests.length === 0
                      ? (restrictToTeam ? "같은 팀의 자재 신청 내역이 없습니다." : "자재 신청 내역이 없습니다.")
                      : "조건에 맞는 내역이 없습니다."}
                  </td></tr>
                ) : sortedReqs.map(r => {
                  const totalQty = r.items.reduce((s, i) => s + i.qty, 0);
                  const kind = matKind(r.items.map(i => i.materialId));
                  const elevators = Array.from(new Set(r.items.map(i => i.elevatorName).filter(Boolean)));
                  const isOpen = expandedIds.has(r.id);
                  return (
                    <Fragment key={r.id}>
                      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors cursor-pointer" onClick={() => toggleExpand(r.id)}>
                        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                          <input type="checkbox"
                            checked={selectedReqIds.has(r.id)}
                            onChange={() => setSelectedReqIds(prev => {
                              const next = new Set(prev);
                              if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                              return next;
                            })}
                            className="h-3.5 w-3.5 rounded cursor-pointer"
                          />
                        </td>
                        <td className="px-2 py-3 text-center w-8 text-gray-400 dark:text-gray-500 text-xs">
                          <span className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                        </td>
                        <td className="px-2 py-3 text-center text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">{fmtDate(r.requestedAt)}</td>
                        <td className="px-2 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${reqStatusCls(r.status, kind)}`}>
                            {r.status === "신청" ? kind : r.status}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center">
                          {r.requestType ? (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${REQ_TYPE_CLS[r.requestType]}`}>
                              {r.requestType}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-300 dark:text-gray-600">—</span>
                          )}
                        </td>
                        <td className="px-2 py-3 text-center text-gray-700 dark:text-gray-300 text-xs whitespace-nowrap">
                          {r.siteName ?? "-"}
                          {elevators.length > 0 && (
                            <span className="ml-1 text-gray-400 dark:text-gray-500">({elevators.length}호기)</span>
                          )}
                        </td>
                        <td className="px-2 py-3 text-center text-gray-700 dark:text-gray-300 text-xs">
                          <span className="font-medium">{r.items[0]?.materialName ?? "-"}</span>
                          {r.items.length > 1 && <span className="text-gray-400 dark:text-gray-500"> 외 {r.items.length - 1}건</span>}
                        </td>
                        <td className="px-2 py-3 text-center tabular-nums text-gray-700 dark:text-gray-300">{totalQty}</td>
                        <td className="px-2 py-3 text-center text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">{r.requesterName} <span className="text-gray-400 dark:text-gray-500">({r.requesterDept})</span></td>
                        <td className="px-2 py-3 text-center text-gray-400 dark:text-gray-500 text-xs max-w-[120px] truncate">{r.note ?? "-"}</td>
                        {canEditReq && (
                          <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
                            {r.status === "신청" && (
                              <div className="flex gap-1">
                                <button type="button" disabled={actionLoading === r.id} onClick={() => handleReqAction(r.id, "처리중")}
                                  className="text-xs px-2 py-1 rounded-lg bg-yellow-50 text-yellow-700 hover:bg-yellow-100 whitespace-nowrap">처리중</button>
                                <button type="button" disabled={actionLoading === r.id} onClick={() => handleReqAction(r.id, "출고처리")}
                                  className="text-xs px-2 py-1 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 whitespace-nowrap">출고처리</button>
                                <button type="button" disabled={actionLoading === r.id} onClick={() => handleReqAction(r.id, "취소")}
                                  className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200">취소</button>
                              </div>
                            )}
                            {r.status === "처리중" && (
                              <div className="flex gap-1">
                                <button type="button" disabled={actionLoading === r.id} onClick={() => handleReqAction(r.id, "출고처리")}
                                  className="text-xs px-2 py-1 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 whitespace-nowrap">출고처리</button>
                                <button type="button" disabled={actionLoading === r.id} onClick={() => handleReqAction(r.id, "취소")}
                                  className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200">취소</button>
                              </div>
                            )}
                            {(r.status === "완료" || r.status === "취소") && (
                              <span className="text-xs text-gray-300 dark:text-gray-600">{r.processorName ?? "-"}</span>
                            )}
                          </td>
                        )}
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/60 dark:bg-gray-700/20">
                          <td colSpan={canEditReq ? 11 : 10} className="px-6 py-3">
                            <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 overflow-hidden">
                              <table className="w-full text-xs">
                                <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700">
                                  <tr>
                                    {["호기", "자재명", "코드", "구분", "수량"].map(h => (
                                      <th key={h} className="px-3 py-2 text-center font-medium text-gray-500 dark:text-gray-400">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                  {r.items.map((item, idx) => {
                                    const itemKind = matKind([item.materialId]);
                                    return (
                                      <tr key={idx}>
                                        <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-400 whitespace-nowrap">{item.elevatorName ?? "-"}</td>
                                        <td className={`px-3 py-2 text-center font-medium ${isTkMaterial(item.materialId) ? TK_TEXT_CLASS : "text-gray-800 dark:text-gray-200"}`}>{item.materialName}</td>
                                        <td className={`px-3 py-2 text-center font-mono whitespace-nowrap ${isTkMaterial(item.materialId) ? TK_TEXT_CLASS : "text-slate-500 dark:text-slate-400"}`}>{item.materialId}</td>
                                        <td className="px-3 py-2 text-center">
                                          <span className={`px-1.5 py-0.5 rounded font-medium ${KIND_CLS[itemKind]}`}>{itemKind}</span>
                                        </td>
                                        <td className="px-3 py-2 text-center tabular-nums text-gray-700 dark:text-gray-300">{fmtNum(item.qty)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ 발주 탭 ════════════════════════════════════════════════ */}
      {tab === "발주" && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800">
              {(["전체","발주","입고완료","취소"] as const).map(f => (
                <button key={f} type="button" onClick={() => setOrdStatus(f)}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${ordStatus === f ? "bg-slate-700 text-white" : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}>
                  {f}
                </button>
              ))}
            </div>
            {/* 회사구분 필터 (자재코드 기준 TK/DS) */}
            <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800">
              {(["전체","TK","DS"] as const).map(f => (
                <button key={f} type="button" onClick={() => setOrdCompany(f)}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${
                    ordCompany === f
                      ? f === "TK" ? "bg-blue-600 text-white" : f === "DS" ? "bg-red-500 text-white" : "bg-slate-700 text-white"
                      : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}>
                  {f}
                </button>
              ))}
            </div>
            {admin && selectedOrdIds.size > 0 && (
              <button type="button" onClick={openBulkInboundModal} disabled={bulkInboundLoading}
                className="ml-auto bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60">
                {bulkInboundLoading ? "처리 중..." : `선택 ${selectedOrdIds.size}건 입고완료`}
              </button>
            )}
            {admin && (
              <Link href="/purchase-orders/new"
                className={`${selectedOrdIds.size === 0 ? "ml-auto " : ""}px-4 py-2.5 rounded-xl text-sm font-semibold bg-slate-700 text-white hover:bg-slate-800 transition-colors`}>
                전표 입력
              </Link>
            )}
            {admin && (
              <button type="button" onClick={downloadOrds}
                className="bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-green-700 transition-colors">
                {selectedOrdIds.size > 0 ? `선택 ${selectedOrdIds.size}건 다운로드` : "엑셀 다운로드"}
              </button>
            )}
            {admin && (
              <button type="button" onClick={() => setShowOrderBulkUpload(true)}
                className="bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors">
                엑셀 업로드
              </button>
            )}
            {/* 발주번호 컬럼 표시 토글 */}
            <div className="ml-2 flex items-center gap-3 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">컬럼:</span>
              <label className="flex items-center gap-1 cursor-pointer select-none text-xs font-medium text-blue-700 dark:text-blue-300">
                <input type="checkbox" checked={showOrderRefCol} onChange={e => setShowOrderRefCol(e.target.checked)}
                  className="w-3.5 h-3.5 accent-blue-600" />
                참조번호
              </label>
              <label className="flex items-center gap-1 cursor-pointer select-none text-xs font-medium text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={showOrderNoCol} onChange={e => setShowOrderNoCol(e.target.checked)}
                  className="w-3.5 h-3.5 accent-gray-600" />
                발주번호
              </label>
            </div>
          </div>

          {/* 검색 필터 */}
          <form
            onSubmit={e => { e.preventDefault(); setOrdSearch(ordDraft); }}
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-2 py-3 flex items-center gap-3 flex-wrap"
          >
            <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">검색</span>
            <div className="flex items-center gap-1.5">
              <input type="date" value={ordDraft.dateFrom} onChange={e => setOrdDraft(p => ({...p, dateFrom: e.target.value}))} className={inputCls()} />
              <span className="text-gray-300 dark:text-gray-600 text-xs">~</span>
              <input type="date" value={ordDraft.dateTo}   onChange={e => setOrdDraft(p => ({...p, dateTo: e.target.value}))}   className={inputCls()} />
            </div>
            <Autocomplete
              value={ordDraft.siteName}
              onChange={v => setOrdDraft(p => ({...p, siteName: v}))}
              items={sites.map(s => s.name)}
              placeholder="현장명"
              width="w-44"
            />
            <Autocomplete
              value={ordDraft.vendorName}
              onChange={v => setOrdDraft(p => ({...p, vendorName: v}))}
              items={vendors.map(v => v.name)}
              placeholder="거래처"
              width="w-36"
            />
            <input type="text" lang="ko" placeholder="자재명·코드·규격" value={ordDraft.material}
              onChange={e => setOrdDraft(p => ({...p, material: e.target.value}))} className={`${inputCls()} w-32`} />
            <Autocomplete
              value={ordDraft.requesterName}
              onChange={v => setOrdDraft(p => ({...p, requesterName: v}))}
              items={requesterNames}
              placeholder="신청자"
              width="w-28"
            />
            <Autocomplete
              value={ordDraft.userName}
              onChange={v => setOrdDraft(p => ({...p, userName: v}))}
              items={userNames}
              placeholder="담당자"
              width="w-28"
            />
            <button type="submit"
              className="px-3 py-3 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors">
              검색
            </button>
            <button type="button" onClick={() => { setOrdDraft(defaultOrd()); setOrdSearch(defaultOrd()); }}
              className="px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              초기화
            </button>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{sortedOrds.length}건</span>
          </form>

          {/* 목록 — 모바일: 카드 / PC: 테이블 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {isMobile ? (
              sortedOrds.length === 0 ? (
                <div className="text-center py-16 text-gray-400 dark:text-gray-500">
                  {orders.length === 0 ? "발주 내역이 없습니다." : "조건에 맞는 내역이 없습니다."}
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {sortedOrds.map(o => {
                    const refTag = extractOrderRef(o.note);
                    const noTag  = o.orderNo;
                    const noteText = (o.note ?? "").replace(/^\[[^\]]*\]\s*/, "").trim();
                    return (
                      <div key={o.id} className="p-4">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            {showOrderRefCol && <span className="text-blue-600 dark:text-blue-400">{refTag || "-"}</span>}
                            {showOrderRefCol && showOrderNoCol && <span className="text-gray-300 dark:text-gray-600">·</span>}
                            {showOrderNoCol  && <span className="text-gray-800 dark:text-gray-100">{noTag  || "-"}</span>}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500">{fmtDateOnly(o.orderedAt)}</span>
                        </div>
                        <p className={`font-medium mt-1.5 ${isTkMaterial(o.materialId) ? TK_TEXT_CLASS : "text-gray-800 dark:text-gray-100"}`}>
                          {o.materialName} <span className="font-mono text-xs text-gray-400">{o.materialId}</span>
                        </p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-gray-600 dark:text-gray-300 mt-1">
                          <div><span className="text-gray-400">규격 </span>{matModelMap.get(o.materialId) || "-"}</div>
                          <div><span className="text-gray-400">수량 </span>{fmtNum(o.qty)}</div>
                          <div className="col-span-2"><span className="text-gray-400">현장 </span>{o.siteName ?? "-"}{o.elevatorName ? ` · ${o.elevatorName}` : ""}</div>
                          <div><span className="text-gray-400">거래처 </span>{o.vendorName ?? "-"}</div>
                          <div><span className="text-gray-400">단가 </span>{fmtNumOr(o.unitPrice)}</div>
                          <div><span className="text-gray-400">신청자 </span>{o.requesterName ?? "-"}</div>
                          {noteText && <div className="col-span-2"><span className="text-gray-400">비고 </span>{noteText}</div>}
                        </div>
                        {admin && o.status === "발주" && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            <button type="button" disabled={actionLoading === o.id} onClick={() => router.push(`/purchase-orders/edit?id=${o.id}`)}
                              className="text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 whitespace-nowrap">수정</button>
                            <button type="button" disabled={actionLoading === o.id} onClick={() => handleOrdAction(o.id, "입고완료")}
                              className="text-xs px-2 py-1 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 whitespace-nowrap">입고완료</button>
                            <button type="button" disabled={actionLoading === o.id} onClick={() => handleOrdDelete(o.id)}
                              className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100">삭제</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
            <div className="overflow-auto max-h-[calc(100vh-250px)]">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="px-3 py-3 w-8">
                    <input type="checkbox"
                      checked={sortedOrds.length > 0 && sortedOrds.every(o => selectedOrdIds.has(o.id))}
                      onChange={() => {
                        if (sortedOrds.length > 0 && sortedOrds.every(o => selectedOrdIds.has(o.id)))
                          setSelectedOrdIds(new Set());
                        else setSelectedOrdIds(new Set(sortedOrds.map(o => o.id)));
                      }}
                      className="h-3.5 w-3.5 rounded cursor-pointer"
                    />
                  </th>
                  {ORD_COLS.filter(c =>
                    (c.toggle !== "ref" || showOrderRefCol) &&
                    (c.toggle !== "no"  || showOrderNoCol)
                  ).map((c, idx) => {
                    const active = c.sortable && c.key === ordSortKey;
                    return (
                      <th key={idx} className="px-2 py-3 text-center font-bold text-black dark:text-white whitespace-nowrap">
                        {c.sortable && c.key ? (
                          <button type="button" onClick={() => toggleOrdSort(c.key as OrdSortKey)}
                            className={`inline-flex items-center gap-1 mx-auto transition-opacity hover:opacity-70 ${active ? "underline underline-offset-2" : ""}`}>
                            {c.label}
                            <span className={`text-[10px] ${active ? "opacity-100" : "opacity-40"}`}>
                              {active ? (ordSortDir === "asc" ? "▲" : "▼") : "⇅"}
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
                {sortedOrds.length === 0 ? (
                  <tr><td colSpan={1 + ORD_COLS.filter(c => (c.toggle !== "ref" || showOrderRefCol) && (c.toggle !== "no" || showOrderNoCol)).length + (admin ? 1 : 0)} className="text-center py-16 text-gray-400 dark:text-gray-500">
                    {orders.length === 0 ? "발주 내역이 없습니다." : "조건에 맞는 내역이 없습니다."}
                  </td></tr>
                ) : sortedOrds.map(o => (
                  <tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="px-3 py-3">
                      <input type="checkbox"
                        checked={selectedOrdIds.has(o.id)}
                        onChange={() => setSelectedOrdIds(prev => {
                          const next = new Set(prev);
                          if (next.has(o.id)) next.delete(o.id); else next.add(o.id);
                          return next;
                        })}
                        className="h-3.5 w-3.5 rounded cursor-pointer"
                      />
                    </td>
                    <td className="px-2 py-3 text-left text-black dark:text-white whitespace-nowrap">{fmtDateOnly(o.orderedAt)}</td>
                    {showOrderRefCol && (
                      <td className="px-2 py-3 text-left text-blue-600 dark:text-blue-400 font-mono text-xs whitespace-nowrap">
                        {extractOrderRef(o.note) || "-"}
                      </td>
                    )}
                    {showOrderNoCol && (
                      <td className="px-2 py-3 text-left text-black dark:text-white font-mono text-xs whitespace-nowrap">
                        {o.orderNo || "-"}
                      </td>
                    )}
                    <td className={`px-2 py-3 text-left font-mono whitespace-nowrap ${isTkMaterial(o.materialId) ? TK_TEXT_CLASS : "text-black dark:text-white"}`}>{o.materialId}</td>
                    <td className={`px-2 py-3 text-left font-medium max-w-[160px] truncate ${isTkMaterial(o.materialId) ? TK_TEXT_CLASS : "text-black dark:text-white"}`}>{o.materialName}</td>
                    <td className="px-2 py-3 text-left text-black dark:text-white whitespace-nowrap">{matModelMap.get(o.materialId) || "-"}</td>
                    <td className="px-2 py-3 text-right tabular-nums text-black dark:text-white">{fmtNum(o.qty)}</td>
                    <td className="px-2 py-3 text-left text-black dark:text-white whitespace-nowrap">{o.siteName ?? "-"}</td>
                    <td className="px-2 py-3 text-left text-black dark:text-white whitespace-nowrap">{o.elevatorName ?? "-"}</td>
                    <td className="px-2 py-3 text-left text-black dark:text-white whitespace-nowrap">{o.requesterName ?? "-"}</td>
                    <td className="px-2 py-3 text-left text-black dark:text-white whitespace-nowrap">{o.vendorName ?? "-"}</td>
                    <td className="px-2 py-3 text-right tabular-nums text-black dark:text-white">
                      {fmtNumOr(o.unitPrice)}
                    </td>
                    <td className="px-2 py-3 text-left text-black dark:text-white max-w-[160px] truncate">
                      {(o.note ?? "").replace(/^\[[^\]]*\]\s*/, "").trim() || "-"}
                    </td>
                    {admin && (
                      <td className="px-2 py-3">
                        {o.status === "발주" && (
                          <div className="flex gap-1">
                            <button type="button" disabled={actionLoading === o.id} onClick={() => router.push(`/purchase-orders/edit?id=${o.id}`)}
                              className="text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 whitespace-nowrap">수정</button>
                            <button type="button" disabled={actionLoading === o.id} onClick={() => handleOrdAction(o.id, "입고완료")}
                              className="text-xs px-2 py-1 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 whitespace-nowrap">입고완료</button>
                            <button type="button" disabled={actionLoading === o.id} onClick={() => handleOrdDelete(o.id)}
                              className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100">삭제</button>
                          </div>
                        )}
                        {o.status !== "발주" && <span className="text-xs text-gray-300 dark:text-gray-600">-</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ 입고 탭 ════════════════════════════════════════════════ */}
      {tab === "입고" && (
        <div className="space-y-3">
          <StockHistoryClient mode="입고" initial={initialInbound} />
        </div>
      )}

      {/* ═══ 출고 탭 ════════════════════════════════════════════════ */}
      {tab === "출고" && (
        <div className="space-y-3">
          <StockHistoryClient mode="출고" initial={initialOutbound} />
        </div>
      )}

      {showOrderBulkUpload && (
        <PurchaseOrderBulkUploadModal
          onClose={() => setShowOrderBulkUpload(false)}
          onSaved={() => {
            setShowOrderBulkUpload(false);
            api.get<PurchaseOrderRecord[]>("/api/purchase-orders").then(setOrders).catch(() => {});
          }}
        />
      )}

      {bulkInboundOpen && (
        <BulkInboundModal
          targets={orders.filter(o => selectedOrdIds.has(o.id) && o.status === "발주")}
          onClose={() => setBulkInboundOpen(false)}
          onSubmit={handleBulkInboundSubmit}
          loading={bulkInboundLoading}
        />
      )}

    </>
  );
}

// ── 일괄 입고 모달 ────────────────────────────────────────────────
function BulkInboundModal({
  targets, onClose, onSubmit, loading,
}: {
  targets: PurchaseOrderRecord[];
  onClose: () => void;
  onSubmit: (receivedAt: string) => void;
  loading: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [receivedAt, setReceivedAt] = useState(today);
  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-[560px]"
      header={
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">일괄 입고완료</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">&times;</button>
        </div>
      }
    >
      <div className="p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">입고일자 <span className="text-red-500">*</span></label>
          <input type="date" value={receivedAt} onChange={e => setReceivedAt(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
            대상 발주 <span className="text-blue-600 dark:text-blue-400 font-semibold">{targets.length}건</span>
          </label>
          <div className="max-h-64 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500 dark:text-gray-400 font-medium">자재코드</th>
                  <th className="px-3 py-2 text-left text-gray-500 dark:text-gray-400 font-medium">자재명</th>
                  <th className="px-3 py-2 text-right text-gray-500 dark:text-gray-400 font-medium">수량</th>
                  <th className="px-3 py-2 text-left text-gray-500 dark:text-gray-400 font-medium">거래처</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {targets.map(o => (
                  <tr key={o.id}>
                    <td className={`px-3 py-3 font-mono ${isTkMaterial(o.materialId) ? TK_TEXT_CLASS : "text-gray-700 dark:text-gray-300"}`}>{o.materialId}</td>
                    <td className={`px-3 py-3 ${isTkMaterial(o.materialId) ? TK_TEXT_CLASS : "text-gray-800 dark:text-gray-200"}`}>{o.materialName}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtNum(o.qty)}</td>
                    <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{o.vendorName ?? "-"}</td>
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
          <button type="button" onClick={() => onSubmit(receivedAt)} disabled={loading || !receivedAt}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60">
            {loading ? "처리 중..." : `${targets.length}건 입고완료`}
          </button>
        </div>
      </div>
    </DraggableModal>
  );
}

