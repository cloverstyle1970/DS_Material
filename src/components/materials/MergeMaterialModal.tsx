"use client";

import { useState, useRef } from "react";
import { MaterialRecord } from "@/lib/mock-materials";
import { useAuth } from "@/context/AuthContext";
import { api, getErrorMessage } from "@/lib/api-client";

interface Props {
  source: MaterialRecord;
  allMaterials: MaterialRecord[];
  onClose: () => void;
  onSaved: () => void;
}

export default function MergeMaterialModal({ source, allMaterials, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const [targetId, setTargetId] = useState("");
  const [targetMaterial, setTargetMaterial] = useState<MaterialRecord | null>(null);
  const [search, setSearch] = useState("");
  const [showList, setShowList] = useState(false);
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const candidates = allMaterials.filter(m =>
    m.isActive &&
    m.id !== source.id &&
    (search.trim() === "" ||
      m.id.toLowerCase().includes(search.toLowerCase()) ||
      m.name.toLowerCase().includes(search.toLowerCase()))
  ).slice(0, 20);

  function selectTarget(m: MaterialRecord) {
    setTargetMaterial(m);
    setTargetId(m.id);
    setSearch(`${m.id}  ${m.name}`);
    setShowList(false);
  }

  function clearTarget() {
    setTargetMaterial(null);
    setTargetId("");
    setSearch("");
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  async function handleConfirm() {
    if (!targetMaterial) return;
    const msg =
      `아래 통합을 실행합니다.\n\n` +
      `비활성화(원본): ${source.id}  ${source.name}  [재고 ${source.stockQty}]\n` +
      `유지(대상):     ${targetMaterial.id}  ${targetMaterial.name}  [재고 ${targetMaterial.stockQty}]\n\n` +
      `원본 재고(${source.stockQty})가 대상으로 이관되고 원본은 비활성화됩니다.\n계속하시겠습니까?`;
    if (!confirm(msg)) return;
    setSaving(true);
    try {
      await api.post("/api/materials/merge", {
        sourceId:  source.id,
        targetId,
        userId:   user?.id   ?? 0,
        userName: user?.name ?? "",
      });
      onSaved();
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">파트번호 통합</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* 원본 (비활성화될 쪽) */}
          <div>
            <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1.5">비활성화될 원본</p>
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm">
              <p className="font-mono font-medium text-gray-800 dark:text-gray-100">{source.id}</p>
              <p className="text-gray-600 dark:text-gray-300 mt-0.5">{source.name}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">현재 재고: {source.stockQty}</p>
            </div>
          </div>

          {/* 화살표 */}
          <div className="text-center text-gray-400 text-lg">↓ 통합 후</div>

          {/* 대상 (유지될 마스터) */}
          <div>
            <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1.5">유지될 대상 자재 검색</p>
            {targetMaterial ? (
              <div className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 px-4 py-3 text-sm flex items-center justify-between">
                <div>
                  <p className="font-mono font-medium text-gray-800 dark:text-gray-100">{targetMaterial.id}</p>
                  <p className="text-gray-600 dark:text-gray-300 mt-0.5">{targetMaterial.name}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">현재 재고: {targetMaterial.stockQty} → 통합 후: {targetMaterial.stockQty + source.stockQty}</p>
                </div>
                <button type="button" onClick={clearTarget}
                  className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-3 shrink-0">×</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  ref={searchRef}
                  value={search}
                  onChange={e => { setSearch(e.target.value); setShowList(true); }}
                  onFocus={() => setShowList(true)}
                  placeholder="자재코드 또는 부품명 검색"
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-green-400 placeholder:text-gray-400"
                />
                {showList && candidates.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-52 overflow-auto">
                    {candidates.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onMouseDown={e => { e.preventDefault(); selectTarget(m); }}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{m.id}</span>
                        <span className="ml-2 text-sm text-gray-800 dark:text-gray-100">{m.name}</span>
                        <span className="ml-2 text-xs text-gray-400">재고 {m.stockQty}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 안내 */}
          <p className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2.5 leading-relaxed">
            통합 실행 시 원본의 재고가 대상으로 이관되고, 원본 파트번호는 비활성 처리됩니다.
            기존 출고·입고·발주 이력은 원본 파트번호로 그대로 유지됩니다.
          </p>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            취소
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!targetMaterial || saving}
            className="px-5 py-2 rounded-lg bg-orange-600 text-white text-sm font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "처리 중..." : "통합 실행"}
          </button>
        </div>
      </div>
    </div>
  );
}
