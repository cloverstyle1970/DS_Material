"use client";

import { useState, useEffect, useRef, FormEvent, useCallback, useId } from "react";
import { AuthUser } from "@/context/AuthContext";
import { MaterialRecord } from "@/lib/mock-materials";
import { MaterialRequestRecord } from "@/lib/mock-material-requests";
import { ElevatorRecord } from "@/lib/mock-elevators";
import SiteSearchInput from "@/components/ui/SiteSearchInput";
import SearchableSelect from "@/components/ui/SearchableSelect";

interface VendorOption { id: number; name: string }
interface SiteOption  { id: number; name: string }

interface SelectedItem {
  material: MaterialRecord;
  qty: number;
  unitPrice: string;
}

interface Props {
  vendors: VendorOption[];
  sites: SiteOption[];
  pendingRequests: MaterialRequestRecord[];
  user: AuthUser;
  onClose: () => void;
  onSaved: () => void;
}

const USER_DEFAULT_MAT_TYPE: Record<string, "DS" | "TK"> = {
  "황진한": "DS",
  "박은숙": "TK",
};

export default function PurchaseOrderModal({ vendors, sites, pendingRequests, user, onClose, onSaved }: Props) {
  const defaultMatType = USER_DEFAULT_MAT_TYPE[user.name] ?? "ALL";
  const [matType, setMatType] = useState<"ALL" | "DS" | "TK">(defaultMatType);
  const [matQuery, setMatQuery] = useState("");
  const [matResults, setMatResults] = useState<MaterialRecord[]>([]);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [linkedKey, setLinkedKey] = useState<string>("");
  const [linkedRequestId, setLinkedRequestId] = useState<number | null>(null);
  const [siteName, setSiteName] = useState("");
  const [elevators, setElevators] = useState<ElevatorRecord[]>([]);
  const [elevatorId, setElevatorId] = useState<number | "">("");
  const [requesterName, setRequesterName] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLDivElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  const handleSiteChange = useCallback(async (name: string): Promise<ElevatorRecord[]> => {
    setSiteName(name);
    setElevatorId("");
    if (!name) { setElevators([]); return []; }
    const res = await fetch(`/api/elevators?site=${encodeURIComponent(name)}`);
    const data: ElevatorRecord[] = await res.json();
    setElevators(data);
    return data;
  }, []);

  const pendingItems = pendingRequests.flatMap(r =>
    r.items.map((item, idx) => ({
      key: `${r.id}-${idx}`,
      reqId: r.id,
      materialId: item.materialId,
      materialName: item.materialName,
      qty: item.qty,
      elevatorName: item.elevatorName,
      siteName: r.siteName,
      requesterName: r.requesterName,
    }))
  );

  useEffect(() => {
    if (!matQuery.trim()) { setMatResults([]); setShowDropdown(false); return; }
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ q: matQuery });
      if (matType !== "ALL") params.set("matType", matType);
      const res = await fetch(`/api/materials?${params}`);
      const data: MaterialRecord[] = await res.json();
      setMatResults(data.slice(0, 10));
      setShowDropdown(true);
    }, 200);
    return () => clearTimeout(t);
  }, [matQuery, matType]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node))
        setShowDropdown(false);
      if (linkRef.current && !linkRef.current.contains(e.target as Node))
        setLinkOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleRequestLink(key: string) {
    setLinkedKey(key);
    if (!key) { setLinkedRequestId(null); return; }
    const item = pendingItems.find(p => p.key === key);
    if (!item) return;
    setLinkedRequestId(item.reqId);
    setRequesterName(item.requesterName);
    setMatType(item.materialId.startsWith("D") ? "DS" : "TK");

    // 신청 자재를 selectedItems에 자동 추가 (수량은 신청 수량으로 초기값, 편집 가능)
    const res = await fetch(`/api/materials?q=${encodeURIComponent(item.materialId)}`);
    const list: MaterialRecord[] = await res.json();
    const mat = list.find(m => m.id === item.materialId);
    if (mat) {
      setSelectedItems(prev => {
        const already = prev.find(i => i.material.id === mat.id);
        if (already) {
          // 이미 있으면 수량만 신청 수량으로 업데이트
          return prev.map(i => i.material.id === mat.id ? { ...i, qty: item.qty } : i);
        }
        return [...prev, {
          material: mat,
          qty: item.qty,
          unitPrice: mat.buyPrice ? String(mat.buyPrice) : "",
        }];
      });
      setMatQuery(mat.name);
    }

    if (item.siteName) {
      const elevList = await handleSiteChange(item.siteName);
      if (item.elevatorName) {
        const match = elevList.find(e => e.unitName === item.elevatorName);
        if (match) setElevatorId(match.id);
      }
    }
  }

  function toggleMaterial(m: MaterialRecord) {
    const exists = selectedItems.find(i => i.material.id === m.id);
    if (exists) {
      setSelectedItems(prev => prev.filter(i => i.material.id !== m.id));
    } else {
      setSelectedItems(prev => [...prev, {
        material: m,
        qty: 1,
        unitPrice: m.buyPrice ? String(m.buyPrice) : "",
      }]);
    }
    setError("");
    inputRef.current?.focus();
  }

  function removeItem(id: string) {
    setSelectedItems(prev => prev.filter(i => i.material.id !== id));
  }

  function updateItem(id: string, patch: Partial<Omit<SelectedItem, "material">>) {
    setSelectedItems(prev => prev.map(i => i.material.id === id ? { ...i, ...patch } : i));
  }

  function handleMatTypeChange(t: "ALL" | "DS" | "TK") {
    setMatType(t);
    setMatQuery("");
    setMatResults([]);
    setShowDropdown(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (selectedItems.length === 0) { setError("자재를 1개 이상 선택해 주세요."); return; }
    setSaving(true);
    try {
      const elevatorName = elevatorId !== ""
        ? (elevators.find(e => e.id === elevatorId)?.unitName ?? null)
        : null;
      await Promise.all(selectedItems.map(item =>
        fetch("/api/purchase-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            materialId: item.material.id,
            materialName: item.material.name,
            qty: item.qty,
            vendorName: vendorName || null,
            unitPrice: item.unitPrice ? Number(item.unitPrice) : null,
            requestId: linkedRequestId,
            siteName: siteName || null,
            elevatorName,
            requesterName: requesterName || null,
            note: note || null,
            userId: user.id,
            userName: user.name,
          }),
        })
      ));
      onSaved();
    } catch {
      setError("오류가 발생했습니다.");
      setSaving(false);
    }
  }

  const isSelected = (id: string) => selectedItems.some(i => i.material.id === id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-800">발주 등록</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto flex-1">

          {/* DS / TK 토글 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">자재 구분</label>
            <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
              {(["ALL", "DS", "TK"] as const).map(t => (
                <button key={t} type="button" onClick={() => handleMatTypeChange(t)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors
                    ${matType === t
                      ? t === "DS" ? "bg-slate-700 text-white shadow-sm"
                        : t === "TK" ? "bg-blue-600 text-white shadow-sm"
                        : "bg-white text-gray-700 shadow-sm"
                      : "text-gray-400 hover:text-gray-600"}`}>
                  {t === "ALL" ? "전체" : t}
                </button>
              ))}
            </div>
          </div>

          {/* 신청건 연결 (선택사항) */}
          {pendingItems.length > 0 && (
            <div className="space-y-1.5" ref={linkRef}>
              <label className="text-sm font-medium text-gray-700">
                신청건 연결
                <span className="ml-1.5 text-xs font-normal text-gray-400">(선택사항)</span>
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setLinkOpen(o => !o)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
                >
                  {linkedKey ? (() => {
                    const p = pendingItems.find(x => x.key === linkedKey);
                    const isTk = p && !p.materialId.startsWith("D");
                    return p ? (
                      <span className={isTk ? "text-blue-600 font-medium" : "text-slate-700 font-medium"}>
                        #{p.reqId} [{p.siteName ?? "현장미지정"}] {p.materialName} × {p.qty} — {p.requesterName}
                      </span>
                    ) : null;
                  })() : (
                    <span className="text-gray-400">연결 안 함 (직접 입력)</span>
                  )}
                  <span className="text-gray-400 ml-2 shrink-0">{linkOpen ? "▲" : "▼"}</span>
                </button>

                {linkOpen && (
                  <ul className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-y-auto max-h-56">
                    <li>
                      <button type="button"
                        onClick={() => { handleRequestLink(""); setLinkOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-400 hover:bg-gray-50 transition-colors">
                        연결 안 함 (직접 입력)
                      </button>
                    </li>
                    {pendingItems.map(p => {
                      const isTk = !p.materialId.startsWith("D");
                      return (
                        <li key={p.key}>
                          <button type="button"
                            onClick={() => { handleRequestLink(p.key); setLinkOpen(false); }}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors ${p.key === linkedKey ? "bg-slate-50" : ""}`}>
                            <div className={`font-medium ${isTk ? "text-blue-600" : "text-slate-700"}`}>
                              <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded mr-1.5 font-semibold ${isTk ? "bg-blue-50 text-blue-500" : "bg-red-50 text-red-500"}`}>
                                {isTk ? "TK" : "DS"}
                              </span>
                              #{p.reqId} {p.materialName} × {p.qty}
                              {p.elevatorName && <span className="font-normal"> ({p.elevatorName})</span>}
                            </div>
                            <div className="text-xs mt-0.5 text-gray-400">
                              {p.siteName ?? "현장미지정"} · {p.requesterName}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* 자재 검색 */}
          <div className="space-y-1.5" ref={searchRef}>
            <label className="text-sm font-medium text-gray-700">
              자재 <span className="text-red-400">*</span>
              {selectedItems.length > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-500">{selectedItems.length}개 선택됨</span>
              )}
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={matQuery}
                onChange={e => setMatQuery(e.target.value)}
                onFocus={() => matResults.length > 0 && setShowDropdown(true)}
                placeholder={matType === "DS" ? "DS 자재 검색" : matType === "TK" ? "TK 자재 검색" : "부품명, 코드, 별칭 검색 후 클릭으로 추가"}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
              {showDropdown && matResults.length > 0 && (
                <ul className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-y-auto max-h-52">
                  {matResults.map(m => {
                    const checked = isSelected(m.id);
                    return (
                      <li key={m.id}>
                        <button type="button" onClick={() => toggleMaterial(m)}
                          className={`w-full text-left px-4 py-2.5 transition-colors flex items-start gap-3 ${checked ? "bg-slate-50 hover:bg-slate-100" : "hover:bg-gray-50"}`}>
                          <span className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold
                            ${checked ? "bg-slate-700 border-slate-700 text-white" : "border-gray-300"}`}>
                            {checked && "✓"}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${m.id.startsWith("D") ? "bg-red-50 text-red-500" : "bg-blue-50 text-blue-500"}`}>
                                {m.id.startsWith("D") ? "DS" : "TK"}
                              </span>
                              <span className="text-xs font-mono text-slate-400 shrink-0">{m.id}</span>
                              <span className="text-sm text-gray-800 font-medium truncate">{m.name}</span>
                            </span>
                            {m.alias && <span className="text-xs text-gray-400 mt-0.5 block">{m.alias}</span>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* 선택된 자재 목록 */}
          {selectedItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">선택된 자재</p>
              <ul className="space-y-2">
                {selectedItems.map(item => (
                  <li key={item.material.id} className="bg-slate-50 rounded-xl px-3 py-2.5 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${item.material.id.startsWith("D") ? "bg-red-50 text-red-500" : "bg-blue-50 text-blue-500"}`}>
                            {item.material.id.startsWith("D") ? "DS" : "TK"}
                          </span>
                          <span className="text-xs font-mono text-slate-400 shrink-0">{item.material.id}</span>
                          <span className="text-sm font-medium text-gray-800 truncate">{item.material.name}</span>
                        </div>
                      </div>
                      <button type="button" onClick={() => removeItem(item.material.id)}
                        className="text-gray-300 hover:text-red-400 transition-colors text-xl leading-none shrink-0">×</button>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* 수량 */}
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500 shrink-0">수량</span>
                        <button type="button" onClick={() => updateItem(item.material.id, { qty: Math.max(1, item.qty - 1) })}
                          disabled={item.qty <= 1}
                          className="w-6 h-6 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 disabled:opacity-30 flex items-center justify-center text-sm">−</button>
                        <input type="number" min={1} value={item.qty}
                          onChange={e => updateItem(item.material.id, { qty: Math.max(1, Number(e.target.value)) })}
                          className="w-12 text-center text-sm font-semibold text-gray-800 border border-gray-200 rounded-lg py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
                        <button type="button" onClick={() => updateItem(item.material.id, { qty: item.qty + 1 })}
                          className="w-6 h-6 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 flex items-center justify-center text-sm">+</button>
                      </div>
                      {/* 단가 */}
                      <div className="flex items-center gap-1 flex-1">
                        <span className="text-xs text-gray-500 shrink-0">단가</span>
                        <input type="number" min={0} value={item.unitPrice}
                          onChange={e => updateItem(item.material.id, { unitPrice: e.target.value })}
                          placeholder="0"
                          className="flex-1 min-w-0 px-2 py-0.5 text-sm text-gray-800 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 현장 + 호기 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">현장</label>
              <SiteSearchInput
                sites={sites}
                value={siteName}
                onChange={handleSiteChange}
                placeholder="현장명 입력"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">호기</label>
              <select value={elevatorId} onChange={e => setElevatorId(e.target.value ? Number(e.target.value) : "")}
                disabled={elevators.length === 0}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-gray-50 disabled:text-gray-400">
                <option value="">{siteName ? "호기 선택" : "현장 먼저 선택"}</option>
                {elevators.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.unitName}{e.elevatorNo ? ` (${e.elevatorNo})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 신청자 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">신청자</label>
            <input type="text" value={requesterName} onChange={e => setRequesterName(e.target.value)}
              placeholder="자재를 신청한 담당자 이름"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-slate-400" />
          </div>

          {/* 거래처 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">거래처</label>
            <SearchableSelect
              options={vendors}
              value={vendorName}
              onChange={setVendorName}
              placeholder="거래처명 입력 (선택사항)"
            />
          </div>

          {/* 비고 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">비고</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder="납기 요청, 특이사항 등"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-slate-400" />
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-400 pt-1">
            <span>담당자:</span>
            <span className="font-medium text-gray-600">{user.name}</span>
            <span>({user.dept})</span>
          </div>

          {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-2.5">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">취소</button>
            <button type="submit" disabled={saving || selectedItems.length === 0}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-60">
              {saving ? "등록 중..." : selectedItems.length > 1 ? `${selectedItems.length}건 발주 등록` : "발주 등록"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
