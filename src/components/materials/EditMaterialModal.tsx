"use client";

import { useState, FormEvent } from "react";
import { useViewMode } from "@/context/ViewModeContext";
import { MaterialRecord } from "@/lib/mock-materials";
import { api, getErrorMessage } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import RegisterRepairModal from "./RegisterRepairModal";
import DraggableModal from "@/components/common/DraggableModal";
import { parseNum } from "@/lib/format";
import { formatMoney } from "@/lib/input-format";

const REFERENCE_BUCKET = "material-references";

interface Props {
  material: MaterialRecord;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditMaterialModal({ material, onClose, onSaved }: Props) {
  const { viewMode } = useViewMode();
  const isMobile = viewMode === "mobile";
  const [name,       setName]       = useState(material.name);
  const [alias,      setAlias]      = useState(material.alias ?? "");
  const [modelNo,    setModelNo]    = useState(material.modelNo ?? "");
  const [unit,       setUnit]       = useState(material.unit ?? "EA");
  const [buyPrice,   setBuyPrice]   = useState(material.buyPrice != null ? formatMoney(material.buyPrice) : "");
  const [sellPrice,  setSellPrice]  = useState(material.sellPrice != null ? formatMoney(material.sellPrice) : "");
  const [storageLoc, setStorageLoc] = useState(material.storageLoc ?? "");
  const [stockQty,   setStockQty]   = useState(material.stockQty);
  const [isRepair,   setIsRepair]   = useState(material.isRepair);
  const [refUrl1, setRefUrl1] = useState(material.referenceImageUrl1 ?? "");
  const [refUrl2, setRefUrl2] = useState(material.referenceImageUrl2 ?? "");
  const [refFile1, setRefFile1] = useState<File | null>(null);
  const [refFile2, setRefFile2] = useState<File | null>(null);
  const [refUploading, setRefUploading] = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState("");
  const [showRepair,   setShowRepair]   = useState(false);

  const isDs = material.id.startsWith("D");
  const canRegisterRepair = isDs && !material.isRepair;

  async function uploadReferenceImage(file: File, slot: 1 | 2): Promise<string> {
    setRefUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
      const path = `${material.id}/ref${slot}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from(REFERENCE_BUCKET).upload(path, file, { cacheControl: "3600", upsert: false });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from(REFERENCE_BUCKET).getPublicUrl(path);
      return data.publicUrl;
    } finally {
      setRefUploading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("부품명을 입력해 주세요."); return; }
    setSaving(true);
    try {
      let finalRef1 = refUrl1;
      if (refFile1) finalRef1 = await uploadReferenceImage(refFile1, 1);
      let finalRef2 = refUrl2;
      if (refFile2) finalRef2 = await uploadReferenceImage(refFile2, 2);
      await api.patch(`/api/materials/${encodeURIComponent(material.id)}`, {
        name, alias, modelNo, unit, buyPrice: parseNum(buyPrice), sellPrice: parseNum(sellPrice), storageLoc, stockQty, isRepair,
        referenceImageUrl1: finalRef1 || "",
        referenceImageUrl2: finalRef2 || "",
      });
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
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-full max-w-lg mx-4"
      header={
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
      }
    >
        <form onSubmit={handleSubmit} className={`px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto ${isMobile ? "force-mobile" : ""}`}>
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
              <input type="text" inputMode="numeric" value={buyPrice}
                onChange={e => setBuyPrice(formatMoney(e.target.value))} placeholder="0" className={field + " text-right"} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">판매단가 (원)</label>
              <input type="text" inputMode="numeric" value={sellPrice}
                onChange={e => setSellPrice(formatMoney(e.target.value))} placeholder="0" className={field + " text-right"} />
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
                className={field} />
            </div>
          </div>

          {/* 참조 사진 (자재 자체 식별/유지보수용, 최대 2장) */}
          <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
              📷 참조 사진 <span className="text-[10px] text-gray-400">(자재 식별·메모용, 최대 2장)</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              {([1, 2] as const).map(slot => {
                const url = slot === 1 ? refUrl1 : refUrl2;
                const file = slot === 1 ? refFile1 : refFile2;
                const setUrl = slot === 1 ? setRefUrl1 : setRefUrl2;
                const setFile = slot === 1 ? setRefFile1 : setRefFile2;
                const preview = file ? URL.createObjectURL(file) : (url || "");
                return (
                  <div key={slot} className="space-y-1.5">
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">사진 {slot}</div>
                    {preview ? (
                      <a href={preview} target="_blank" rel="noopener noreferrer"
                        className="block w-full aspect-square rounded border border-gray-200 dark:border-gray-600 overflow-hidden bg-gray-50 dark:bg-gray-700">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={preview} alt={`참조 ${slot}`} className="w-full h-full object-cover" />
                      </a>
                    ) : (
                      <div className="w-full aspect-square rounded border border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center text-[11px] text-gray-400">
                        없음
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <input id={`ref-img-${slot}`} type="file" accept="image/*"
                        onChange={e => setFile(e.target.files?.[0] ?? null)} className="hidden" />
                      <label htmlFor={`ref-img-${slot}`}
                        className="flex-1 text-center px-2 py-1 rounded bg-blue-600 text-white text-[11px] font-semibold cursor-pointer hover:bg-blue-700">
                        📁 선택
                      </label>
                      {(file || url) && (
                        <button type="button"
                          onClick={() => { setFile(null); setUrl(""); }}
                          className="px-2 py-1 rounded text-[11px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30">
                          지우기
                        </button>
                      )}
                    </div>
                    {file && (
                      <div className="text-[10px] text-gray-500 truncate" title={file.name}>{file.name}</div>
                    )}
                  </div>
                );
              })}
            </div>
            {refUploading && <div className="text-[11px] text-gray-500 mt-1">참조 사진 업로드 중...</div>}
          </div>

          {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/30 rounded-lg px-4 py-2.5">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-gray-200 dark:border-gray-600 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              취소
            </button>
            <button type="submit" disabled={saving || refUploading || !name.trim()}
              className="flex-1 rounded-lg bg-slate-700 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors">
              {saving ? "저장 중..." : "수정 저장"}
            </button>
          </div>
        </form>
    </DraggableModal>
    </>
  );
}
