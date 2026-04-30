"use client";

import { useState, FormEvent } from "react";
import { MaterialRecord } from "@/lib/mock-materials";
import RegisterRepairModal from "./RegisterRepairModal";

interface Props {
  material: MaterialRecord;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditMaterialModal({ material, onClose, onSaved }: Props) {
  const [name,       setName]       = useState(material.name);
  const [alias,      setAlias]      = useState(material.alias ?? "");
  const [modelNo,    setModelNo]    = useState(material.modelNo ?? "");
  const [unit,       setUnit]       = useState(material.unit ?? "EA");
  const [buyPrice,   setBuyPrice]   = useState(material.buyPrice != null ? String(material.buyPrice) : "");
  const [sellPrice,  setSellPrice]  = useState(material.sellPrice != null ? String(material.sellPrice) : "");
  const [storageLoc, setStorageLoc] = useState(material.storageLoc ?? "");
  const [stockQty,   setStockQty]   = useState(material.stockQty);
  const [isRepair,   setIsRepair]   = useState(material.isRepair);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState("");
  const [showRepair,   setShowRepair]   = useState(false);

  const isDs = material.id.startsWith("D");
  const canRegisterRepair = isDs && !material.isRepair;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("부품명을 입력해 주세요."); return; }
    setSaving(true);
    const res = await fetch(`/api/materials/${encodeURIComponent(material.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, alias, modelNo, unit, buyPrice, sellPrice, storageLoc, stockQty, isRepair }),
    });
    setSaving(false);
    if (!res.ok) { setError("저장 중 오류가 발생했습니다."); return; }
    onSaved();
  }

  const field = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-slate-400";

  return (
    <>
    {showRepair && (
      <RegisterRepairModal
        parent={material}
        onClose={() => setShowRepair(false)}
        onSaved={() => { setShowRepair(false); onSaved(); }}
      />
    )}
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-800">자재 수정</h2>
            <p className="text-xs text-gray-400 mt-0.5 font-mono">{material.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${isDs ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>
              {isDs ? "DS" : "TK"}
            </span>
            {canRegisterRepair && (
              <button type="button" onClick={() => setShowRepair(true)}
                className="text-xs px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 font-medium transition-colors">
                + 수리품 등록
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-1">×</button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* 부품명 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">부품명 <span className="text-red-500">*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} className={field} />
          </div>

          {/* 별칭 + 기종명 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">별칭</label>
              <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="예: 클로저" className={field} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">기종명/규격</label>
              <input value={modelNo} onChange={e => setModelNo(e.target.value)} placeholder="예: DC-200A" className={field} />
            </div>
          </div>

          {/* 단위 + 수리품 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">단위</label>
              <select value={unit} onChange={e => setUnit(e.target.value)} className={field}>
                {["EA","ST","M","BOX","SET"].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">수리품 여부</label>
              <select value={isRepair ? "R" : "_"} onChange={e => setIsRepair(e.target.value === "R")} className={field}>
                <option value="_">신품</option>
                <option value="R">수리품</option>
              </select>
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

          {/* 보관장소 + 재고 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">보관 장소</label>
              <input value={storageLoc} onChange={e => setStorageLoc(e.target.value)} placeholder="예: A-01" className={field} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">재고</label>
              <input type="number" min={0} value={stockQty} onChange={e => setStockQty(Number(e.target.value))} className={field} />
            </div>
          </div>

          {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-2.5">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              취소
            </button>
            <button type="submit" disabled={saving || !name.trim()}
              className="flex-1 rounded-lg bg-slate-700 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors">
              {saving ? "저장 중..." : "수정 저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
    </>
  );
}
