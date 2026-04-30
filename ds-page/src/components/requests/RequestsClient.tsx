"use client";

import { useState, useCallback, Fragment } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { MaterialRequestRecord, RequestStatus } from "@/lib/mock-material-requests";
import { PurchaseOrderRecord, OrderStatus } from "@/lib/mock-purchase-orders";
import { TransactionRecord } from "@/lib/mock-transactions";
import { useAuth, isViewOnly } from "@/context/AuthContext";
import MaterialRequestModal from "./MaterialRequestModal";
import PurchaseOrderModal from "./PurchaseOrderModal";
import StockHistoryClient from "@/components/stock/StockHistoryClient";

interface SiteOption   { id: number; name: string }
interface VendorOption { id: number; name: string }

interface Props {
  initialRequests:  MaterialRequestRecord[];
  initialOrders:    PurchaseOrderRecord[];
  initialInbound:   TransactionRecord[];
  initialOutbound:  TransactionRecord[];
  sites:   SiteOption[];
  vendors: VendorOption[];
  mode?: "all" | "requests-only" | "orders-only";
  materialAliases?: Record<string, string>;
}

const TABS = ["자재신청", "발주", "입고", "출고"] as const;
type Tab = typeof TABS[number];

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function today() { return new Date().toISOString().substring(0, 10); }

interface ReqSearch { dateFrom: string; dateTo: string; siteName: string; elevatorName: string; userName: string; material: string }
interface OrdSearch { dateFrom: string; dateTo: string; siteName: string; vendorName: string; userName: string; requesterName: string; material: string }

function defaultReq(): ReqSearch { return { dateFrom: today(), dateTo: today(), siteName: "", elevatorName: "", userName: "", material: "" }; }
function defaultOrd(): OrdSearch { return { dateFrom: today(), dateTo: today(), siteName: "", vendorName: "", userName: "", requesterName: "", material: "" }; }

function inRange(iso: string, from: string, to: string) {
  const d = iso.substring(0, 10);
  if (from && d < from) return false;
  if (to   && d > to)   return false;
  return true;
}

function inputCls() {
  return "px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white";
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

export default function RequestsClient({ initialRequests, initialOrders, initialInbound, initialOutbound, sites, vendors, mode = "all", materialAliases = {} }: Props) {
  const defaultTab: Tab = mode === "orders-only" ? "발주" : "자재신청";
  const [tab, setTab]       = useState<Tab>(defaultTab);
  const [requests, setRequests] = useState(initialRequests);
  const [orders,   setOrders]   = useState(initialOrders);

  // 자재신청 탭
  const [reqStatus,     setReqStatus]     = useState<RequestStatus | "전체">("전체");
  const [reqSearch,     setReqSearch]     = useState<ReqSearch>(defaultReq);
  const [showReqModal,  setShowReqModal]  = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // 발주 탭
  const [ordStatus,    setOrdStatus]    = useState<OrderStatus | "전체">("전체");
  const [ordDraft,     setOrdDraft]     = useState<OrdSearch>(defaultOrd);
  const [ordSearch,    setOrdSearch]    = useState<OrdSearch>(defaultOrd);
  const [showOrdModal, setShowOrdModal] = useState(false);

  const { user } = useAuth();
  const admin = user ? !isViewOnly(user) : false;

  // ── 재조회 ───────────────────────────────────────────────────────
  const reloadRequests = useCallback(async () => {
    setRequests(await fetch("/api/material-requests").then(r => r.json()));
    setShowReqModal(false);
  }, []);

  const reloadOrders = useCallback(async () => {
    setOrders(await fetch("/api/purchase-orders").then(r => r.json()));
    setShowOrdModal(false);
  }, []);

  // ── 자재신청 액션 ────────────────────────────────────────────────
  async function handleReqAction(id: number, action: string) {
    if (!user) return;
    setActionLoading(id);
    const res = await fetch(`/api/material-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, processorId: user.id, processorName: user.name }),
    });
    setActionLoading(null);
    if (!res.ok) { alert((await res.json()).error); return; }
    setRequests(await fetch("/api/material-requests").then(r => r.json()));
  }

  // ── 발주 액션 ────────────────────────────────────────────────────
  async function handleOrdAction(id: number, action: string) {
    if (!user) return;
    setActionLoading(id);
    const res = await fetch(`/api/purchase-orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, userId: user.id, userName: user.name }),
    });
    setActionLoading(null);
    if (!res.ok) { alert((await res.json()).error); return; }
    setOrders(await fetch("/api/purchase-orders").then(r => r.json()));
  }

  // ── 필터 ────────────────────────────────────────────────────────
  const filteredReqs = requests.filter(r => {
    if (reqStatus !== "전체" && r.status !== reqStatus) return false;
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

  const filteredOrds = orders.filter(o => {
    if (ordStatus !== "전체" && o.status !== ordStatus) return false;
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
    const rows = filteredReqs.flatMap(r =>
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
    xlsxDownload(rows, "자재신청", `자재신청_${stamp}.xlsx`);
  }

  function downloadOrds() {
    const stamp = new Date().toISOString().slice(0,10).replace(/-/g,"");
    const rows = filteredOrds.map(o => ({
      발주일시: fmtDate(o.orderedAt),
      상태: o.status,
      자재명: o.materialName,
      자재코드: o.materialId,
      수량: o.qty,
      현장: o.siteName ?? "",
      호기: o.elevatorName ?? "",
      신청자: o.requesterName ?? "",
      거래처: o.vendorName ?? "",
      단가: o.unitPrice ?? "",
      담당자: o.userName,
      비고: o.note ?? "",
    }));
    xlsxDownload(rows, "발주", `발주내역_${stamp}.xlsx`);
  }

  const pendingRequests = requests.filter(r => r.status === "신청" || r.status === "처리중");

  const tabBadge = (count: number, color: string) => count > 0
    ? <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${color}`}>{count}</span>
    : null;

  return (
    <>
      {/* 탭 헤더 — mode가 all일 때만 표시 */}
      {mode === "all" && (
        <div className="flex border-b border-gray-200 bg-white rounded-t-xl overflow-hidden">
          {TABS.filter(t => admin || (t !== "발주" && t !== "입고" && t !== "출고")).map(t => (
            <button key={t} type="button" onClick={() => setTab(t as Tab)}
              className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t ? "border-slate-700 text-slate-700" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {t}
              {t === "자재신청" && tabBadge(requests.filter(r => r.status === "신청").length, "bg-blue-100 text-blue-600")}
              {t === "발주"     && tabBadge(orders.filter(o => o.status === "발주").length,   "bg-indigo-100 text-indigo-600")}
            </button>
          ))}
        </div>
      )}

      {/* ═══ 자재신청 탭 ═══════════════════════════════════════════ */}
      {tab === "자재신청" && (
        <div className="space-y-3">
          {/* 상태 필터 + 등록 */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-white">
              {(["전체","신청","처리중","완료","취소"] as const).map(f => (
                <button key={f} type="button" onClick={() => setReqStatus(f)}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${reqStatus === f ? "bg-slate-700 text-white" : "text-gray-500 hover:bg-gray-50"}`}>
                  {f}
                </button>
              ))}
            </div>
            <button type="button" onClick={downloadReqs}
              className="ml-auto bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-green-700 transition-colors">
              엑셀 다운로드
            </button>
            <button type="button" onClick={() => setShowReqModal(true)}
              className="bg-slate-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors">
              📋 빠른 신청
            </button>
            <Link href="/requests/new"
              className="px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors">
              전표 입력
            </Link>
          </div>

          {/* 검색 필터 */}
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gray-400 shrink-0">검색</span>
            <div className="flex items-center gap-1.5">
              <input type="date" value={reqSearch.dateFrom} onChange={e => setReqSearch(p => ({...p, dateFrom: e.target.value}))} className={inputCls()} />
              <span className="text-gray-300 text-xs">~</span>
              <input type="date" value={reqSearch.dateTo}   onChange={e => setReqSearch(p => ({...p, dateTo: e.target.value}))}   className={inputCls()} />
            </div>
            <input type="text" placeholder="현장명" value={reqSearch.siteName}
              onChange={e => setReqSearch(p => ({...p, siteName: e.target.value}))} className={`${inputCls()} w-36`} />
            <input type="text" placeholder="자재명·코드·별칭" value={reqSearch.material}
              onChange={e => setReqSearch(p => ({...p, material: e.target.value}))} className={`${inputCls()} w-36`} />
            <input type="text" placeholder="신청자" value={reqSearch.userName}
              onChange={e => setReqSearch(p => ({...p, userName: e.target.value}))} className={`${inputCls()} w-24`} />
            <button type="button" onClick={() => setReqSearch(defaultReq())}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 transition-colors">
              초기화
            </button>
            <span className="ml-auto text-xs text-gray-400">{filteredReqs.length}건</span>
          </div>

          {/* 테이블 */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {["", "신청일시","상태","현장","자재 요약","총 수량","신청자","메모", admin ? "처리" : ""].filter(Boolean).map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredReqs.length === 0 ? (
                  <tr><td colSpan={admin ? 9 : 8} className="text-center py-16 text-gray-400">
                    {requests.length === 0 ? "자재 신청 내역이 없습니다." : "조건에 맞는 내역이 없습니다."}
                  </td></tr>
                ) : filteredReqs.map(r => {
                  const totalQty = r.items.reduce((s, i) => s + i.qty, 0);
                  const kind = matKind(r.items.map(i => i.materialId));
                  const elevators = Array.from(new Set(r.items.map(i => i.elevatorName).filter(Boolean)));
                  const isOpen = expandedIds.has(r.id);
                  return (
                    <Fragment key={r.id}>
                      <tr className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => toggleExpand(r.id)}>
                        <td className="px-4 py-3 w-8 text-gray-400 text-xs">
                          <span className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDate(r.requestedAt)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${reqStatusCls(r.status, kind)}`}>
                            {r.status === "신청" ? kind : r.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700 text-xs whitespace-nowrap">
                          {r.siteName ?? "-"}
                          {elevators.length > 0 && (
                            <span className="ml-1 text-gray-400">({elevators.length}호기)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700 text-xs">
                          <span className="font-medium">{r.items[0]?.materialName ?? "-"}</span>
                          {r.items.length > 1 && <span className="text-gray-400"> 외 {r.items.length - 1}건</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-700 text-right tabular-nums">{totalQty}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{r.requesterName} <span className="text-gray-400">({r.requesterDept})</span></td>
                        <td className="px-4 py-3 text-gray-400 text-xs max-w-[120px] truncate">{r.note ?? "-"}</td>
                        {admin && (
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
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
                              <span className="text-xs text-gray-300">{r.processorName ?? "-"}</span>
                            )}
                          </td>
                        )}
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={admin ? 9 : 8} className="px-6 py-3">
                            <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                              <table className="w-full text-xs">
                                <thead className="bg-gray-50">
                                  <tr>
                                    {["호기", "자재명", "코드", "구분", "수량"].map(h => (
                                      <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {r.items.map((item, idx) => {
                                    const itemKind = matKind([item.materialId]);
                                    return (
                                      <tr key={idx}>
                                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{item.elevatorName ?? "-"}</td>
                                        <td className="px-3 py-2 font-medium text-gray-800">{item.materialName}</td>
                                        <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">{item.materialId}</td>
                                        <td className="px-3 py-2">
                                          <span className={`px-1.5 py-0.5 rounded font-medium ${KIND_CLS[itemKind]}`}>{itemKind}</span>
                                        </td>
                                        <td className="px-3 py-2 text-gray-700 text-right tabular-nums">{item.qty}</td>
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
        </div>
      )}

      {/* ═══ 발주 탭 ════════════════════════════════════════════════ */}
      {tab === "발주" && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-white">
              {(["전체","발주","입고완료","취소"] as const).map(f => (
                <button key={f} type="button" onClick={() => setOrdStatus(f)}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${ordStatus === f ? "bg-slate-700 text-white" : "text-gray-500 hover:bg-gray-50"}`}>
                  {f}
                </button>
              ))}
            </div>
            <button type="button" onClick={downloadOrds}
              className="ml-auto bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-green-700 transition-colors">
              엑셀 다운로드
            </button>
            {admin && (
              <>
                <button type="button" onClick={() => setShowOrdModal(true)}
                  className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
                  📑 빠른 발주
                </button>
                <Link href="/purchase-orders/new"
                  className="px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors">
                  전표 입력
                </Link>
              </>
            )}
          </div>

          {/* 검색 필터 */}
          <form
            onSubmit={e => { e.preventDefault(); setOrdSearch(ordDraft); }}
            className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap"
          >
            <span className="text-xs text-gray-400 shrink-0">검색</span>
            <div className="flex items-center gap-1.5">
              <input type="date" value={ordDraft.dateFrom} onChange={e => setOrdDraft(p => ({...p, dateFrom: e.target.value}))} className={inputCls()} />
              <span className="text-gray-300 text-xs">~</span>
              <input type="date" value={ordDraft.dateTo}   onChange={e => setOrdDraft(p => ({...p, dateTo: e.target.value}))}   className={inputCls()} />
            </div>
            <select value={ordDraft.siteName} onChange={e => setOrdDraft(p => ({...p, siteName: e.target.value}))} className={inputCls()}>
              <option value="">현장 전체</option>
              {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            <select value={ordDraft.vendorName} onChange={e => setOrdDraft(p => ({...p, vendorName: e.target.value}))} className={inputCls()}>
              <option value="">거래처 전체</option>
              {vendors.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
            </select>
            <input type="text" placeholder="자재명·코드" value={ordDraft.material}
              onChange={e => setOrdDraft(p => ({...p, material: e.target.value}))} className={`${inputCls()} w-32`} />
            <input type="text" placeholder="신청자" value={ordDraft.requesterName}
              onChange={e => setOrdDraft(p => ({...p, requesterName: e.target.value}))} className={`${inputCls()} w-24`} />
            <input type="text" placeholder="담당자" value={ordDraft.userName}
              onChange={e => setOrdDraft(p => ({...p, userName: e.target.value}))} className={`${inputCls()} w-24`} />
            <button type="submit"
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors">
              검색
            </button>
            <button type="button" onClick={() => { setOrdDraft(defaultOrd()); setOrdSearch(defaultOrd()); }}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 transition-colors">
              초기화
            </button>
            <span className="ml-auto text-xs text-gray-400">{filteredOrds.length}건</span>
          </form>

          {/* 테이블 */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {["발주일시","상태","자재명","코드","수량","현장","호기","신청자","거래처","단가","담당자","비고", admin ? "처리" : ""].filter(Boolean).map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredOrds.length === 0 ? (
                  <tr><td colSpan={admin ? 13 : 12} className="text-center py-16 text-gray-400">
                    {orders.length === 0 ? "발주 내역이 없습니다." : "조건에 맞는 내역이 없습니다."}
                  </td></tr>
                ) : filteredOrds.map(o => (
                  <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDate(o.orderedAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ORD_STATUS_STYLE[o.status]}`}>{o.status}</span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800 max-w-[160px] truncate">{o.materialName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{o.materialId}</td>
                    <td className="px-4 py-3 text-gray-700 text-right tabular-nums">{o.qty}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{o.siteName ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{o.elevatorName ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{o.requesterName ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{o.vendorName ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-500 text-right tabular-nums text-xs">
                      {o.unitPrice != null ? o.unitPrice.toLocaleString() : "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{o.userName}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs max-w-[120px] truncate">{o.note ?? "-"}</td>
                    {admin && (
                      <td className="px-4 py-3">
                        {o.status === "발주" && (
                          <div className="flex gap-1">
                            <button type="button" disabled={actionLoading === o.id} onClick={() => handleOrdAction(o.id, "입고완료")}
                              className="text-xs px-2 py-1 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 whitespace-nowrap">입고완료</button>
                            <button type="button" disabled={actionLoading === o.id} onClick={() => handleOrdAction(o.id, "취소")}
                              className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200">취소</button>
                          </div>
                        )}
                        {o.status !== "발주" && <span className="text-xs text-gray-300">-</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ 입고 탭 ════════════════════════════════════════════════ */}
      {tab === "입고" && (
        <div className="space-y-3">
          <StockHistoryClient mode="입고" initial={initialInbound} sites={sites} />
        </div>
      )}

      {/* ═══ 출고 탭 ════════════════════════════════════════════════ */}
      {tab === "출고" && (
        <div className="space-y-3">
          <StockHistoryClient mode="출고" initial={initialOutbound} sites={sites} />
        </div>
      )}

      {/* 모달 */}
      {showReqModal && user && (
        <MaterialRequestModal sites={sites} user={user} onClose={() => setShowReqModal(false)} onSaved={reloadRequests} />
      )}
      {showOrdModal && user && (
        <PurchaseOrderModal vendors={vendors} sites={sites} pendingRequests={pendingRequests} user={user} onClose={() => setShowOrdModal(false)} onSaved={reloadOrders} />
      )}
    </>
  );
}
