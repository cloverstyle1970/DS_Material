"use client";

import { useState, FormEvent } from "react";
import { MaterialRecord } from "@/lib/mock-materials";
import { api, getErrorMessage } from "@/lib/api-client";
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
  const [trackSerial, setTrackSerial] = useState(material.trackSerial);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState("");
  const [showRepair,   setShowRepair]   = useState(false);

  const isDs = material.id.startsWith("D");
  const canRegisterRepair = isDs && !material.isRepair;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("부품명을 입력해 주세요."); return; }
    setSaving(true);
    try {
      await api.patch(`/api/materials/${encodeURIComponent(material.id)}`, { name, alias, modelNo, unit, buyPrice, sellPrice, storageLoc, stockQty, isRepair, trackSerial });
      onSaved();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-400";

  return (
    <>
    {showRepair && (
      <RegisterRepairModal
        parent={material}
        onClose={() => setShowRepair(false)}
        onSaved={() => { setShowRepair(false); onSaved(); }}
      />
    )}
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">자재 수정</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 font-mono">{material.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${isDs ? "bg-red-50 dark:bg-red-900/40 text-red-600 dark:text-red-400" : "bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400"}`}>
              {isDs ? "DS" : "TK"}
            </span>
            {canRegisterRepair && (
              <button type="button" onClick={() => setShowRepair(true)}
                className="text-xs px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/60 font-medium transition-colors">
                + 수리품 등록
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none ml-1">×</button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* 부품명 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">부품명 <span className="text-red-500">*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} className={field} />
          </div>

          {/* 별칭 + 기종명 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">별칭</label>
              <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="예: 클로저" className={field} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">기종명/규격</label>
              <input value={modelNo} onChange={e => setModelNo(e.target.value)} placeholder="예: DC-200A" className={field} />
            </div>
          </div>

          {/* 단위 + 수리품 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">단위</label>
              <select value={unit} onChange={e => setUnit(e.target.value)} className={field}>
                {["EA","ST","M","BOX","SET"].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">수리품 여부</label>
              <select value={isRepair ? "R" : "_"} onChange={e => setIsRepair(e.target.value === "R")} className={field}>
                <option value="_">신품</option>
                <option value="R">수리품</option>
              </select>
            </div>
          </div>

          {/* 단가 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">구매단가 (원)</label>
              <input type="number" min={0} value={buyPrice} onChange={e => setBuyPrice(e.target.value)} placeholder="0" className={field} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">판매단가 (원)</label>
              <input type="number" min={0} value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder="0" className={field} />
            </div>
          </div>

          {/* 보관장소 + 재고 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">보관 장소</label>
              <input value={storageLoc} onChange={e => setStorageLoc(e.target.value)} placeholder="예: A-01" className={field} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">재고</label>
              <input type="number" min={0} value={stockQty} onChange={e => setStockQty(Number(e.target.value))}
                disabled={trackSerial}
                className={`${field} disabled:opacity-60 disabled:cursor-not-allowed`} />
            </div>
          </div>

          <label className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors">
            <input type="checkbox" checked={trackSerial} onChange={e => setTrackSerial(e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-slate-700 cursor-pointer" />
            <div className="flex-1">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-200">S/N 단위 추적 사용</div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">활성화 시 입고/출고에 시리얼 번호 입력이 필요합니다. 기존 누적 재고 수량은 추적되지 않으며 신규 입고분부터 unit이 생성됩니다.</p>
            </div>
          </label>

          {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/30 rounded-lg px-4 py-2.5">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-gray-200 dark:border-gray-600 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
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
