"use client";

import { useState, FormEvent } from "react";
import { MaterialRecord } from "@/lib/mock-materials";

interface Props {
  parent: MaterialRecord;
  onClose: () => void;
  onSaved: () => void;
}

export default function RegisterRepairModal({ parent, onClose, onSaved }: Props) {
  const repairId = parent.id + "R";

  const [name,       setName]       = useState(`[수리품] ${parent.name}`);
  const [alias,      setAlias]      = useState(parent.alias ?? "");
  const [modelNo,    setModelNo]    = useState(parent.modelNo ?? "");
  const [unit,       setUnit]       = useState(parent.unit ?? "EA");
  const [buyPrice,   setBuyPrice]   = useState(parent.buyPrice  != null ? String(Math.round(parent.buyPrice  * 0.5)) : "");
  const [sellPrice,  setSellPrice]  = useState(parent.sellPrice != null ? String(Math.round(parent.sellPrice * 0.5)) : "");
  const [storageLoc, setStorageLoc] = useState(parent.storageLoc ?? "");
  const [stockQty,   setStockQty]   = useState(0);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("부품명을 입력해 주세요."); return; }
    setSaving(true);
    const res = await fetch("/api/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        directId: repairId,
        categoryCode: parent.categoryCode,
        isRepair: true,
        name, alias, modelNo, unit,
        buyPrice, sellPrice, storageLoc, stockQty,
      }),
    });
    setSaving(false);
    if (res.status === 409) { setError(`이미 등록된 수리품 코드입니다 (${repairId})`); return; }
    if (!res.ok) { setError("저장 중 오류가 발생했습니다."); return; }
    onSaved();
  }

  const field = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-slate-400";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-800">수리품 신규 등록</h2>
            <p className="text-xs text-gray-400 mt-0.5">원본: <span className="font-mono">{parent.id}</span> → 수리품: <span className="font-mono font-semibold text-purple-600">{repairId}</span></p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* 원본 자재 정보 */}
        <div className="mx-6 mt-4 px-4 py-3 bg-slate-50 rounded-xl text-xs text-gray-600 space-y-1.5">
          <div className="flex gap-3">
            <span className="text-gray-400 shrink-0 w-16">원본명</span>
            <span className="font-medium text-gray-800">{parent.name}</span>
          </div>
          <div className="flex gap-3">
            <span className="text-gray-400 shrink-0 w-16">수리품 코드</span>
            <span className="font-mono font-bold text-purple-600">{repairId}</span>
            <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">수리품</span>
          </div>
          {(parent.buyPrice != null || parent.sellPrice != null) && (
            <div className="flex gap-3">
              <span className="text-gray-400 shrink-0 w-16">단가 기준</span>
              <span className="text-gray-500">
                신품가의 50% 자동 적용
                {parent.buyPrice  != null && <span className="ml-1.5">구매 {parent.buyPrice.toLocaleString()} → <span className="text-slate-700 font-medium">{Math.round(parent.buyPrice * 0.5).toLocaleString()}</span></span>}
                {parent.sellPrice != null && <span className="ml-1.5">/ 판매 {parent.sellPrice.toLocaleString()} → <span className="text-slate-700 font-medium">{Math.round(parent.sellPrice * 0.5).toLocaleString()}</span></span>}
              </span>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* 부품명 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">부품명 <span className="text-red-500">*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} className={field} />
          </div>

          {/* 별칭 + 기종명 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">별칭</label>
              <input value={alias} onChange={e => setAlias(e.target.value)} className={field} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">기종명/규격</label>
              <input value={modelNo} onChange={e => setModelNo(e.target.value)} className={field} />
            </div>
          </div>

          {/* 단위 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">단위</label>
              <select value={unit} onChange={e => setUnit(e.target.value)} className={field}>
                {["EA","ST","M","BOX","SET"].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">초기 재고</label>
              <input type="number" min={0} value={stockQty} onChange={e => setStockQty(Number(e.target.value))} className={field} />
            </div>
          </div>

          {/* 단가 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">구매단가 (원)</label>
              <input type="number" min={0} value={buyPrice} onChange={e => setBuyPrice(e.target.value)} placeholder="0" className={field} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">판매단가 (원)</label>
              <input type="number" min={0} value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder="0" className={field} />
            </div>
          </div>

          {/* 보관장소 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">보관 장소</label>
            <input value={storageLoc} onChange={e => setStorageLoc(e.target.value)} placeholder="예: A-01" className={field} />
          </div>

          {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-2.5">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              취소
            </button>
            <button type="submit" disabled={saving || !name.trim()}
              className="flex-1 rounded-lg bg-purple-600 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 transition-colors">
              {saving ? "등록 중..." : "수리품 등록"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
