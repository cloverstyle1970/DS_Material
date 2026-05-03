"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import { AuthUser } from "@/context/AuthContext";
import { MaterialRecord } from "@/lib/mock-materials";
import { PurchaseOrderRecord } from "@/lib/mock-purchase-orders";
import { TransactionRecord } from "@/lib/mock-transactions";
import SiteSearchInput from "@/components/ui/SiteSearchInput";
import { api, getErrorMessage } from "@/lib/api-client";

interface SiteOption { id: number; name: string }

interface Props {
  initialType: "입고" | "출고";
  sites: SiteOption[];
  user: AuthUser;
  onClose: () => void;
  onSaved: () => void;
}

function getDefaultMatType(userId: number): "전체" | "DS" | "TK" {
  if (userId === 15) return "DS";
  if (userId === 20) return "TK";
  return "전체";
}

function fmtDate(iso: string) {
  return iso.substring(0, 10);
}

export default function StockTxModal({ initialType, sites, user, onClose, onSaved }: Props) {
  const [txType, setTxType] = useState<"입고" | "출고">(initialType);

  // ── 참조 데이터 ──────────────────────────────────────────────
  const [pendingOrders, setPendingOrders] = useState<PurchaseOrderRecord[]>([]);
  const [inboundList,   setInboundList]   = useState<TransactionRecord[]>([]);
  const [refSearch,     setRefSearch]     = useState("");
  const [refOpen,       setRefOpen]       = useState(true);
  const [selectedRef,   setSelectedRef]   = useState<PurchaseOrderRecord | TransactionRecord | null>(null);

  // ── 폼 ──────────────────────────────────────────────────────
  const [matType,      setMatType]      = useState<"전체" | "DS" | "TK">(() => getDefaultMatType(user.id));
  const [matQuery,     setMatQuery]     = useState("");
  const [matResults,   setMatResults]   = useState<MaterialRecord[]>([]);
  const [selected,     setSelected]     = useState<MaterialRecord | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [qty,          setQty]          = useState(1);
  const [siteName,     setSiteName]     = useState("");
  const [note,         setNote]         = useState("");
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState("");
  const searchRef = useRef<HTMLDivElement>(null);

  // ── 참조 데이터 로드 ─────────────────────────────────────────
  useEffect(() => {
    if (txType === "입고") {
      api.get<PurchaseOrderRecord[]>("/api/purchase-orders?status=발주")
        .then(setPendingOrders).catch(() => setPendingOrders([]));
    } else {
      api.get<TransactionRecord[]>("/api/transactions?type=입고")
        .then(data => setInboundList(data.slice(0, 100))).catch(() => setInboundList([]));
    }
  }, [txType]);

  // ── 자재 검색 ────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!matQuery.trim()) { setMatResults([]); return; }
      const params = new URLSearchParams({ q: matQuery });
      if (matType !== "전체") params.set("matType", matType);
      try {
        const data = await api.get<MaterialRecord[]>(`/api/materials?${params}`);
        setMatResults(data.slice(0, 10));
        setShowDropdown(true);
      } catch { setMatResults([]); setShowDropdown(false); }
    }, matQuery.trim() ? 200 : 0);
    return () => clearTimeout(t);
  }, [matQuery, matType]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node))
        setShowDropdown(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── 참조 선택 ────────────────────────────────────────────────
  function applyOrderRef(o: PurchaseOrderRecord) {
    setSelectedRef(o);
    setMatQuery(o.materialName);
    setSelected(null);
    setQty(o.qty);
    setSiteName(o.siteName ?? "");
    setNote(`발주#${o.id}${o.vendorName ? ` (${o.vendorName})` : ""}`);
    // 자재 ID로 실제 MaterialRecord 조회
    api.get<MaterialRecord[]>(`/api/materials?q=${encodeURIComponent(o.materialId)}`)
      .then(list => {
        const m = list.find(x => x.id === o.materialId);
        if (m) { setSelected(m); setMatQuery(m.name); }
      }).catch(() => {});
    setRefOpen(false);
    setError("");
  }

  function applyInboundRef(t: TransactionRecord) {
    setSelectedRef(t);
    setMatQuery(t.materialName);
    setSelected(null);
    setQty(t.qty);
    setSiteName(t.siteName ?? "");
    setNote(`입고#${t.id} 참조`);
    api.get<MaterialRecord[]>(`/api/materials?q=${encodeURIComponent(t.materialId)}`)
      .then(list => {
        const m = list.find(x => x.id === t.materialId);
        if (m) { setSelected(m); setMatQuery(m.name); }
      }).catch(() => {});
    setRefOpen(false);
    setError("");
  }

  function selectMaterial(m: MaterialRecord) {
    setSelected(m);
    setMatQuery(m.name);
    setShowDropdown(false);
    setError("");
  }

  // ── 저장 ─────────────────────────────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!selected) { setError("자재를 선택해 주세요."); return; }
    if (qty <= 0)  { setError("수량은 1 이상이어야 합니다."); return; }

    setSaving(true);
    try {
      await api.post("/api/transactions", {
        type: txType,
        materialId: selected.id,
        materialName: selected.name,
        qty,
        siteName: txType === "출고" ? (siteName || null) : null,
        note: note || null,
        userId: user.id,
        userName: user.name,
      });
      onSaved();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  // ── 참조 목록 필터 ───────────────────────────────────────────
  const q = refSearch.toLowerCase();
  const filteredOrders = pendingOrders.filter(o =>
    !q ||
    o.materialName.toLowerCase().includes(q) ||
    o.materialId.toLowerCase().includes(q) ||
    (o.vendorName?.toLowerCase().includes(q) ?? false) ||
    (o.siteName?.toLowerCase().includes(q) ?? false)
  );
  const filteredInbound = inboundList.filter(t =>
    !q ||
    t.materialName.toLowerCase().includes(q) ||
    t.materialId.toLowerCase().includes(q) ||
    (t.siteName?.toLowerCase().includes(q) ?? false)
  );

  const hasRef = txType === "입고" ? pendingOrders.length > 0 : inboundList.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">입출고 등록</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">

          {/* 입고 / 출고 토글 */}
          <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-600">
            {(["입고", "출고"] as const).map(t => (
              <button key={t} type="button"
                onClick={() => { setTxType(t); setError(""); setSelectedRef(null); setRefSearch(""); setRefOpen(true); setMatQuery(""); setSelected(null); }}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  txType === t
                    ? t === "입고" ? "bg-blue-600 text-white" : "bg-orange-500 text-white"
                    : "bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600"
                }`}>
                {t === "입고" ? "▼ 입고" : "▲ 출고"}
              </button>
            ))}
          </div>

          {/* ── 참조 패널 ────────────────────────────────────── */}
          {hasRef && (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 overflow-hidden">
              {/* 참조 헤더 */}
              <button type="button"
                onClick={() => setRefOpen(p => !p)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                  {txType === "입고"
                    ? `발주서 참조 (미입고 ${pendingOrders.length}건)`
                    : `입고내역 참조 (${inboundList.length}건)`}
                  {selectedRef && (
                    <span className="ml-2 text-blue-600 dark:text-blue-400">
                      ✓ {txType === "입고"
                        ? (selectedRef as PurchaseOrderRecord).materialName
                        : (selectedRef as TransactionRecord).materialName} 선택됨
                    </span>
                  )}
                </span>
                <span className="text-gray-400 dark:text-gray-500 text-xs">{refOpen ? "▲" : "▼"}</span>
              </button>

              {refOpen && (
                <div className="px-3 py-2.5 space-y-2">
                  <input
                    type="text"
                    value={refSearch}
                    onChange={e => setRefSearch(e.target.value)}
                    placeholder="자재명, 코드, 규격, 현장 검색"
                    className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />

                  {/* 발주서 목록 */}
                  {txType === "입고" && (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
                      {filteredOrders.length === 0
                        ? <p className="text-center py-4 text-xs text-gray-400 dark:text-gray-500">발주서가 없습니다</p>
                        : filteredOrders.map(o => (
                          <button key={o.id} type="button"
                            onClick={() => applyOrderRef(o)}
                            className={`w-full text-left px-3 py-2.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors ${
                              (selectedRef as PurchaseOrderRecord)?.id === o.id ? "bg-blue-50 dark:bg-blue-900/30" : ""
                            }`}>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{fmtDate(o.orderedAt)}</span>
                              <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{o.materialName}</span>
                              <span className="ml-auto text-xs font-semibold text-blue-600 dark:text-blue-400 shrink-0">{o.qty}개</span>
                            </div>
                            <div className="flex gap-2 mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                              <span className="font-mono">{o.materialId}</span>
                              {o.vendorName && <span>· {o.vendorName}</span>}
                              {o.siteName   && <span>· {o.siteName}</span>}
                            </div>
                          </button>
                        ))
                      }
                    </div>
                  )}

                  {/* 입고내역 목록 */}
                  {txType === "출고" && (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
                      {filteredInbound.length === 0
                        ? <p className="text-center py-4 text-xs text-gray-400 dark:text-gray-500">입고 내역이 없습니다</p>
                        : filteredInbound.map(t => (
                          <button key={t.id} type="button"
                            onClick={() => applyInboundRef(t)}
                            className={`w-full text-left px-3 py-2.5 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors ${
                              (selectedRef as TransactionRecord)?.id === t.id ? "bg-orange-50 dark:bg-orange-900/20" : ""
                            }`}>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{fmtDate(t.createdAt)}</span>
                              <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{t.materialName}</span>
                              <span className="ml-auto text-xs font-semibold text-orange-500 dark:text-orange-400 shrink-0">재고 {t.afterStock}</span>
                            </div>
                            <div className="flex gap-2 mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                              <span className="font-mono">{t.materialId}</span>
                              {t.siteName && <span>· {t.siteName}</span>}
                              <span className="ml-auto">입고 {t.qty}개</span>
                            </div>
                          </button>
                        ))
                      }
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── 폼 ──────────────────────────────────────────── */}
          <form id="tx-form" onSubmit={handleSubmit} className="space-y-4">

            {/* 자재 구분 */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">자재 구분</label>
              <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-600">
                {(["전체", "DS", "TK"] as const).map(t => (
                  <button key={t} type="button"
                    onClick={() => { setMatType(t); setSelected(null); setMatQuery(""); setMatResults([]); }}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${
                      matType === t
                        ? t === "DS" ? "bg-green-600 text-white"
                          : t === "TK" ? "bg-indigo-600 text-white"
                          : "bg-slate-600 text-white"
                        : "bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600"
                    }`}>{t}</button>
                ))}
              </div>
            </div>

            {/* 자재 검색 */}
            <div className="space-y-1.5" ref={searchRef}>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">자재</label>
              <div className="relative">
                <input type="text" value={matQuery}
                  onChange={e => { setMatQuery(e.target.value); setSelected(null); setSelectedRef(null); }}
                  onFocus={() => matResults.length > 0 && setShowDropdown(true)}
                  placeholder="부품명, 코드, 규격, 별칭 검색"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
                {showDropdown && matResults.length > 0 && (
                  <ul className="absolute z-10 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                    {matResults.map(m => (
                      <li key={m.id}>
                        <button type="button" onClick={() => selectMaterial(m)}
                          className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-slate-400 dark:text-slate-500">{m.id}</span>
                            <span className="text-sm text-gray-800 dark:text-gray-200 font-medium truncate">{m.name}</span>
                          </div>
                          <div className="flex gap-3 mt-0.5">
                            {m.alias && <span className="text-xs text-gray-400 dark:text-gray-500">{m.alias}</span>}
                            <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">재고 {m.stockQty}</span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {selected && (
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg text-xs text-gray-600 dark:text-gray-400">
                  <span className="font-mono text-slate-400 dark:text-slate-500">{selected.id}</span>
                  <span className="font-medium text-gray-800 dark:text-gray-200">{selected.name}</span>
                  <span className="ml-auto">
                    현재 재고:
                    <span className={`ml-1 font-semibold ${selected.stockQty === 0 ? "text-red-500" : "text-slate-700 dark:text-slate-300"}`}>
                      {selected.stockQty}
                    </span>
                  </span>
                </div>
              )}
            </div>

            {/* 수량 */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">수량</label>
              <input type="number" min={1} value={qty} onChange={e => setQty(Number(e.target.value))}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>

            {/* 현장 (출고 시에만) */}
            {txType === "출고" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">현장</label>
                <SiteSearchInput sites={sites} value={siteName} onChange={setSiteName} placeholder="현장명 입력 (선택사항)" />
              </div>
            )}

            {/* 비고 */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">비고</label>
              <input type="text" value={note} onChange={e => setNote(e.target.value)}
                placeholder="메모 (선택사항)"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>

            {/* 처리자 */}
            <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 pt-1">
              <span>처리자:</span>
              <span className="text-gray-600 dark:text-gray-400 font-medium">{user.name}</span>
              <span className="text-gray-400 dark:text-gray-500">({user.dept})</span>
            </div>

            {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/30 rounded-lg px-4 py-2.5">{error}</p>}
          </form>
        </div>

        {/* 하단 버튼 */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex gap-2 shrink-0">
          <button type="button" onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            취소
          </button>
          <button type="submit" form="tx-form" disabled={saving}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-60 ${
              txType === "입고" ? "bg-blue-600 hover:bg-blue-700" : "bg-orange-500 hover:bg-orange-600"
            }`}>
            {saving ? "처리 중..." : `${txType} 등록`}
          </button>
        </div>

      </div>
    </div>
  );
}
