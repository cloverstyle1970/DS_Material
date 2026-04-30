"use client";

import { useState, useEffect } from "react";
import { CategoryStore } from "@/lib/mock-categories";
import { generateMaterialCode } from "@/lib/category-codes";
import { api, getErrorMessage } from "@/lib/api-client";
import CategoryManagerModal from "./CategoryManagerModal";

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export default function AddMaterialModal({ onClose, onSaved }: Props) {
  const [cats, setCats] = useState<CategoryStore | null>(null);
  const [showCatManager, setShowCatManager] = useState(false);

  const [isDs, setIsDs] = useState(true);
  const [major, setMajor] = useState("");
  const [mid, setMid] = useState("");
  const [sub, setSub] = useState("");
  const [isRepair, setIsRepair] = useState(false);
  const [name, setName] = useState("");
  const [alias, setAlias] = useState("");
  const [modelNo, setModelNo] = useState("");
  const [unit, setUnit] = useState("EA");
  const [buyPrice, setBuyPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [storageLoc, setStorageLoc] = useState("");
  const [stockQty, setStockQty] = useState(0);
  const [saving, setSaving] = useState(false);

  async function loadCats() {
    try {
      const data = await api.get<CategoryStore>("/api/categories");
      setCats(data);
      if (!major && data.major.length) {
        const m = data.major[0].code;
        const mi = (data.mid[m]?.[0]?.code) ?? "";
        const s = (data.sub[`${m}${mi}`]?.[0]?.code) ?? "";
        setMajor(m); setMid(mi); setSub(s);
      }
    } catch (e) {
      alert(getErrorMessage(e));
    }
  }

  useEffect(() => { const t = setTimeout(loadCats, 0); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const midList = cats?.mid[major] ?? [];
  const subList = cats?.sub[`${major}${mid}`] ?? [];

  useEffect(() => {
    if (!cats) return;
    const mi = cats.mid[major]?.[0]?.code ?? "";
    const t = setTimeout(() => setMid(mi), 0);
    return () => clearTimeout(t);
  }, [major, cats]);

  useEffect(() => {
    if (!cats) return;
    const s = cats.sub[`${major}${mid}`]?.[0]?.code ?? "";
    const t = setTimeout(() => setSub(s), 0);
    return () => clearTimeout(t);
  }, [major, mid, cats]);

  const previewCode = major && mid && sub
    ? generateMaterialCode({ isDs, major, mid, sub, seq: 9999, isRepair }).slice(0, 7) + "?????"
    : "____________";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !major || !mid || !sub) return;
    setSaving(true);
    try {
      await api.post("/api/materials", { isDs, major, mid, sub, isRepair, name, alias, modelNo, unit, buyPrice, sellPrice, storageLoc, stockQty });
      onSaved();
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">신규 자재 등록</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">×</button>
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto">
            {/* 코드 미리보기 */}
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">자동 채번 코드</span>
                <span className="font-mono text-sm font-bold text-slate-700 dark:text-slate-200 tracking-widest">{previewCode}</span>
              </div>
              <button type="button" onClick={() => setShowCatManager(true)}
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline underline-offset-2">
                분류 관리
              </button>
            </div>

            {/* 구분 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">구분</label>
                <select value={isDs ? "D" : "_"} onChange={e => setIsDs(e.target.value === "D")}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="D">DS 자사 (D)</option>
                  <option value="_">TKE (_)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">수리품 여부</label>
                <select value={isRepair ? "R" : "_"} onChange={e => setIsRepair(e.target.value === "R")}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="_">신품 (_)</option>
                  <option value="R">수리품 (R)</option>
                </select>
              </div>
            </div>

            {/* 분류 */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "대분류", value: major, onChange: setMajor, options: cats?.major ?? [] },
                { label: "중분류", value: mid, onChange: setMid, options: midList },
                { label: "소분류", value: sub, onChange: setSub, options: subList },
              ].map(({ label, value, onChange, options }) => (
                <div key={label}>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
                  <select value={value} onChange={e => onChange(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-400">
                    {options.map(o => <option key={o.code} value={o.code}>{o.code} {o.label}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {/* 기본 정보 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">부품명 <span className="text-red-500">*</span></label>
              <input required value={name} onChange={e => setName(e.target.value)} placeholder="예: 도어 클로저"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">별칭</label>
                <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="예: 클로저"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">기종명/규격</label>
                <input value={modelNo} onChange={e => setModelNo(e.target.value)} placeholder="예: DC-200A"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
            </div>
            {/* 단위 + 가격 */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">단위</label>
                <select value={unit} onChange={e => setUnit(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-400">
                  <option value="EA">EA</option>
                  <option value="ST">ST</option>
                  <option value="M">M</option>
                  <option value="BOX">BOX</option>
                  <option value="SET">SET</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">구매단가 (원)</label>
                <input type="number" min={0} value={buyPrice} onChange={e => setBuyPrice(e.target.value)} placeholder="0"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">판매단가 (원)</label>
                <input type="number" min={0} value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder="0"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">보관 장소</label>
                <input value={storageLoc} onChange={e => setStorageLoc(e.target.value)} placeholder="예: A-01"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">초기 재고</label>
                <input type="number" min={0} value={stockQty} onChange={e => setStockQty(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-600 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                취소
              </button>
              <button type="submit" disabled={saving || !name.trim() || !major || !mid || !sub}
                className="flex-1 rounded-lg bg-slate-700 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors">
                {saving ? "저장 중..." : "등록"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showCatManager && (
        <CategoryManagerModal onClose={() => { setShowCatManager(false); loadCats(); }} />
      )}
    </>
  );
}
