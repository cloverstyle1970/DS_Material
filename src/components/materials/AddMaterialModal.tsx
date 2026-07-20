"use client";

import { useState, useEffect, useRef } from "react";
import { useViewMode } from "@/context/ViewModeContext";
import { CategoryStore } from "@/lib/mock-categories";
import { generateMaterialCode } from "@/lib/category-codes";
import { api, getErrorMessage } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { MaterialRecord } from "@/lib/mock-materials";
import { VendorRecord } from "@/lib/mock-vendors";
import { parseNum } from "@/lib/format";
import { formatMoney } from "@/lib/input-format";
import CategoryManagerModal from "./CategoryManagerModal";
import DraggableModal from "@/components/common/DraggableModal";
import SearchableSelect from "@/components/ui/SearchableSelect";

const REFERENCE_BUCKET = "material-references";

interface Props {
  onClose: () => void;
  onSaved: () => void;
  source?: MaterialRecord | null;
}

export default function AddMaterialModal({ onClose, onSaved, source }: Props) {
  const isRepairMode = !!source;
  const { viewMode } = useViewMode();
  const isMobile = viewMode === "mobile";

  const [cats, setCats] = useState<CategoryStore | null>(null);
  const [showCatManager, setShowCatManager] = useState(false);

  const [isDs, setIsDs] = useState(source ? source.id.startsWith("D") : true);
  const [major, setMajor] = useState(source ? source.id.slice(1, 3) : "");
  const [mid, setMid] = useState(source ? source.id.slice(3, 5) : "");
  const [sub, setSub] = useState(source ? source.id.slice(5, 7) : "");
  const [isRepair, setIsRepair] = useState(isRepairMode);
  const [name, setName] = useState(source?.name ?? "");
  const [alias, setAlias] = useState(source?.alias ?? "");
  const [modelNo, setModelNo] = useState(source?.modelNo ?? "");
  const [unit, setUnit] = useState(source?.unit ?? "EA");
  const [buyPrice, setBuyPrice] = useState(source?.buyPrice != null ? formatMoney(source.buyPrice) : "");
  const [sellPrice, setSellPrice] = useState(source?.sellPrice != null ? formatMoney(source.sellPrice) : "");
  const [storageLoc, setStorageLoc] = useState(source?.storageLoc ?? "");
  const [stockQty, setStockQty] = useState(0);
  const [saving, setSaving] = useState(false);

  // 구입처 (매입/공통 거래처 중 선택)
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [vendor1Name, setVendor1Name] = useState("");
  const [vendor2Name, setVendor2Name] = useState("");

  // 참조 사진
  const [refFile1, setRefFile1] = useState<File | null>(null);
  const [refFile2, setRefFile2] = useState<File | null>(null);
  const [refUploading, setRefUploading] = useState(false);

  // 코드 직접 입력 모드 (수리품 등록 모드에서는 사용 안 함)
  const [isManual, setIsManual] = useState(false);
  const [manualId, setManualId] = useState("");
  const [idError, setIdError] = useState("");

  const skipInitialCascadeRef = useRef(isRepairMode);

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

  // 매입/공통 거래처 로드 + 수리품 등록 시 원본 자재의 구입처 초기값 세팅
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await api.get<VendorRecord[]>("/api/vendors?type=매입");
        if (!alive) return;
        setVendors(list);
        if (source) {
          const v1 = list.find(v => v.id === source.vendor1Id);
          const v2 = list.find(v => v.id === source.vendor2Id);
          if (v1) setVendor1Name(v1.name);
          if (v2) setVendor2Name(v2.name);
        }
      } catch { /* 거래처 목록 실패는 자재 등록 자체를 막지 않는다 */ }
    })();
    return () => { alive = false; };
  }, [source]);

  // TK 자재(_)는 자재코드 체계를 따르지 않으므로 직접 입력만 허용
  useEffect(() => {
    if (!isRepairMode && !isDs) setIsManual(true);
  }, [isDs, isRepairMode]);

  const midList = cats?.mid[major] ?? [];
  const subList = cats?.sub[`${major}${mid}`] ?? [];

  useEffect(() => {
    if (!cats) return;
    if (skipInitialCascadeRef.current) return;
    const mi = cats.mid[major]?.[0]?.code ?? "";
    const t = setTimeout(() => setMid(mi), 0);
    return () => clearTimeout(t);
  }, [major, cats]);

  useEffect(() => {
    if (!cats) return;
    if (skipInitialCascadeRef.current) {
      skipInitialCascadeRef.current = false;
      return;
    }
    const s = cats.sub[`${major}${mid}`]?.[0]?.code ?? "";
    const t = setTimeout(() => setSub(s), 0);
    return () => clearTimeout(t);
  }, [major, mid, cats]);

  const previewCode = isRepairMode && source
    ? `${source.id}R`
    : major && mid && sub
      ? generateMaterialCode({ isDs, major, mid, sub, seq: 9999, isRepair }).slice(0, 7) + "?????"
      : "____________";

  // 직접 입력 시 수리품 자동 판정 — DS: 끝글자 'R', TK: 첫글자 'A'
  const trimmedManualId = manualId.trim().toUpperCase();
  const computedIsRepair = isManual
    ? (isDs ? trimmedManualId.endsWith("R") : trimmedManualId.startsWith("A"))
    : isRepair;

  async function uploadReferenceImage(file: File, slot: 1 | 2): Promise<string> {
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
    const path = `new/ref${slot}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from(REFERENCE_BUCKET).upload(path, file, { cacheControl: "3600", upsert: false });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(REFERENCE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !major || !mid || !sub) return;

    if (isManual && !isRepairMode) {
      const id = trimmedManualId;
      if (!id) { setIdError("코드를 입력하세요."); return; }
      if (isDs && !id.startsWith("D")) {
        setIdError("DS 자재 코드는 'D'로 시작해야 합니다.");
        return;
      }
    }

    setSaving(true);
    try {
      // 참조 사진 업로드 (신규는 material.id가 없어서 path는 new/ prefix)
      let referenceImageUrl1 = "";
      let referenceImageUrl2 = "";
      if (refFile1 || refFile2) {
        setRefUploading(true);
        try {
          if (refFile1) referenceImageUrl1 = await uploadReferenceImage(refFile1, 1);
          if (refFile2) referenceImageUrl2 = await uploadReferenceImage(refFile2, 2);
        } finally { setRefUploading(false); }
      }

      const vendor1Id = vendor1Name.trim() ? (vendors.find(v => v.name === vendor1Name.trim())?.id ?? null) : null;
      const vendor2Id = vendor2Name.trim() ? (vendors.find(v => v.name === vendor2Name.trim())?.id ?? null) : null;
      const extra = {
        referenceImageUrl1,
        referenceImageUrl2,
        vendor1Id,
        vendor2Id,
      };
      const buyPriceNum  = parseNum(buyPrice);
      const sellPriceNum = parseNum(sellPrice);
      const payload = isManual && !isRepairMode
        ? { directId: trimmedManualId, major, mid, sub, isRepair: computedIsRepair, name, alias, modelNo, unit, buyPrice: buyPriceNum, sellPrice: sellPriceNum, storageLoc, stockQty, ...extra }
        : { sourceId: source?.id, isDs, major, mid, sub, isRepair, name, alias, modelNo, unit, buyPrice: buyPriceNum, sellPrice: sellPriceNum, storageLoc, stockQty, ...extra };
      await api.post("/api/materials", payload);
      onSaved();
    } catch (e) {
      const msg = getErrorMessage(e);
      if (isManual && !isRepairMode) setIdError(msg);
      else alert(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DraggableModal
        open={true}
        panelClassName="w-full max-w-lg mx-4"
        header={
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">{isRepairMode ? "수리품 등록" : "신규 자재 등록"}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">×</button>
          </div>
        }
      >
          <form onSubmit={handleSubmit} className={`px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto ${isMobile ? "force-mobile" : ""}`}>
            {/* 코드 미리보기 / 직접 입력 */}
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                {isRepairMode ? (
                  <span className="text-xs text-slate-500 dark:text-slate-400">자동 채번 코드</span>
                ) : (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isManual}
                    disabled={!isDs}
                    onClick={() => { setIsManual(!isManual); setIdError(""); }}
                    className={`flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 select-none ${isDs ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                    style={{ background: "transparent", padding: 0, border: 0 }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 20,
                        height: 20,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 4,
                        border: "2px solid #94a3b8",
                        background: isManual ? "#334155" : "#ffffff",
                        borderColor: isManual ? "#334155" : "#94a3b8",
                        color: "#ffffff",
                        transition: "all 120ms",
                        flexShrink: 0,
                      }}
                    >
                      {isManual && (
                        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 8 7 12 13 4" />
                        </svg>
                      )}
                    </span>
                    <span>{isManual ? "직접 입력 코드" : "자동 채번 코드"}</span>
                  </button>
                )}
                <button type="button" onClick={() => setShowCatManager(true)}
                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline underline-offset-2">
                  분류 관리
                </button>
              </div>
              <div>
                {isManual && !isRepairMode ? (
                  <input
                    value={manualId}
                    onChange={e => { setManualId(e.target.value.toUpperCase()); setIdError(""); }}
                    placeholder={isDs
                      ? "예: D0101010001_  (D로 시작, 끝 R = 수리품)"
                      : "예: A123ABC (수리품) / 1KFE12345 (신품)"}
                    className="w-full font-mono text-sm font-bold text-slate-700 dark:text-slate-100 tracking-widest bg-white dark:bg-gray-700 rounded-md border border-slate-200 dark:border-gray-600 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                  />
                ) : (
                  <span className="font-mono text-sm font-bold text-slate-700 dark:text-slate-200 tracking-widest">{previewCode}</span>
                )}
              </div>
              {isManual && !isRepairMode && idError && (
                <p className="text-xs text-red-500">{idError}</p>
              )}
              {isManual && !isRepairMode && !isDs && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  TK 자재는 자재코드 체계를 따르지 않습니다. 수리품은 첫 글자를{" "}
                  <span className="font-mono font-bold text-purple-600 dark:text-purple-400">A</span>로 입력하세요.
                </p>
              )}
              {isManual && !isRepairMode && isDs && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  DS 자재 코드는 <span className="font-mono font-bold">D</span>로 시작해야 하며,
                  끝 글자 <span className="font-mono font-bold">R</span>은 수리품으로 자동 인식됩니다.
                </p>
              )}
            </div>

            {/* 구분 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">구분</label>
                <select value={isDs ? "D" : "_"} onChange={e => setIsDs(e.target.value === "D")}
                  disabled={isRepairMode}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-60 disabled:cursor-not-allowed">
                  <option value="D">DS 자사 (D)</option>
                  <option value="_">TK (_)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">수리품 여부</label>
                {isManual && !isRepairMode ? (
                  <div className={`w-full rounded-lg border px-3 py-2 text-sm ${
                    computedIsRepair
                      ? "border-purple-200 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                      : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400"
                  }`}>
                    {computedIsRepair ? "수리품 (자동 판정)" : "신품 (자동 판정)"}
                  </div>
                ) : (
                  <select value={isRepair ? "R" : "_"} onChange={e => setIsRepair(e.target.value === "R")}
                    disabled={isRepairMode}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-60 disabled:cursor-not-allowed">
                    <option value="_">신품 (_)</option>
                    <option value="R">수리품 (R)</option>
                  </select>
                )}
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
                    disabled={isRepairMode}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-60 disabled:cursor-not-allowed">
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
                <input type="text" inputMode="numeric" value={buyPrice}
                  onChange={e => setBuyPrice(formatMoney(e.target.value))} placeholder="0"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-right text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">판매단가 (원)</label>
                <input type="text" inputMode="numeric" value={sellPrice}
                  onChange={e => setSellPrice(formatMoney(e.target.value))} placeholder="0"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-right text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-400" />
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

            {/* 구입처 (매입/공통 거래처 중 검색·선택, 최대 2개) */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">구입처 1</label>
                <SearchableSelect
                  options={vendors.map(v => ({ id: v.id, name: v.name }))}
                  value={vendor1Name}
                  onChange={setVendor1Name}
                  placeholder="매입 거래처 검색"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">구입처 2</label>
                <SearchableSelect
                  options={vendors.map(v => ({ id: v.id, name: v.name }))}
                  value={vendor2Name}
                  onChange={setVendor2Name}
                  placeholder="매입 거래처 검색"
                />
              </div>
            </div>

            {/* 참조 사진 (자재 자체 식별/유지보수용, 최대 2장) */}
            <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                📷 참조 사진 <span className="text-[10px] text-gray-400">(자재 식별·메모용, 최대 2장)</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                {([1, 2] as const).map(slot => {
                  const file = slot === 1 ? refFile1 : refFile2;
                  const setFile = slot === 1 ? setRefFile1 : setRefFile2;
                  const preview = file ? URL.createObjectURL(file) : "";
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
                        <input id={`add-ref-img-${slot}`} type="file" accept="image/*"
                          onChange={e => setFile(e.target.files?.[0] ?? null)} className="hidden" />
                        <label htmlFor={`add-ref-img-${slot}`}
                          className="flex-1 text-center px-2 py-1 rounded bg-blue-600 text-white text-[11px] font-semibold cursor-pointer hover:bg-blue-700">
                          📁 선택
                        </label>
                        {file && (
                          <button type="button" onClick={() => setFile(null)}
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

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-600 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                취소
              </button>
              <button type="submit" disabled={saving || refUploading || !name.trim() || !major || !mid || !sub || (isManual && !isRepairMode && !trimmedManualId)}
                className="flex-1 rounded-lg bg-slate-700 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors">
                {saving ? "저장 중..." : "등록"}
              </button>
            </div>
          </form>
      </DraggableModal>

      {showCatManager && (
        <CategoryManagerModal onClose={() => { setShowCatManager(false); loadCats(); }} />
      )}
    </>
  );
}
