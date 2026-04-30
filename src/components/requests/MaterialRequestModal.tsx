"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import { AuthUser } from "@/context/AuthContext";
import { MaterialRecord } from "@/lib/mock-materials";
import SiteSearchInput from "@/components/ui/SiteSearchInput";
import { ElevatorRecord } from "@/lib/mock-elevators";
import { api, getErrorMessage } from "@/lib/api-client";

interface SiteOption { id: number; name: string }
interface SelectedItem { material: MaterialRecord; qty: number }
interface ElevatorGroup { id: string; elevatorName: string; items: SelectedItem[] }

interface Props {
  sites: SiteOption[];
  user: AuthUser;
  onClose: () => void;
  onSaved: () => void;
}

// ── 호기 1개 행 ────────────────────────────────────────────
interface GroupRowProps {
  group: ElevatorGroup;
  elevators: ElevatorRecord[];
  index: number;
  canRemove: boolean;
  onElevatorChange: (name: string) => void;
  onItemsChange: (items: SelectedItem[]) => void;
  onRemove: () => void;
}

function ElevatorGroupRow({
  group, elevators, index, canRemove,
  onElevatorChange, onItemsChange, onRemove,
}: GroupRowProps) {
  const [matQuery, setMatQuery] = useState("");
  const [matType, setMatType] = useState<"ALL" | "DS" | "TK">("ALL");
  const [matResults, setMatResults] = useState<MaterialRecord[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!matQuery.trim()) { setMatResults([]); setShowDropdown(false); return; }
      const params = new URLSearchParams({ q: matQuery });
      if (matType !== "ALL") params.set("matType", matType);
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

  function toggleMaterial(m: MaterialRecord) {
    const exists = group.items.find(i => i.material.id === m.id);
    if (exists) onItemsChange(group.items.filter(i => i.material.id !== m.id));
    else onItemsChange([...group.items, { material: m, qty: 1 }]);
    inputRef.current?.focus();
  }

  function removeItem(id: string) {
    onItemsChange(group.items.filter(i => i.material.id !== id));
  }

  function updateQty(id: string, qty: number) {
    if (qty < 1) return;
    onItemsChange(group.items.map(i => i.material.id === id ? { ...i, qty } : i));
  }

  const isSelected = (id: string) => group.items.some(i => i.material.id === id);

  return (
    <div className="border border-gray-200 dark:border-gray-600 rounded-xl p-3.5 space-y-3 bg-gray-50/60 dark:bg-gray-700/30">
      {/* 행 헤더 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wide">호기 {index + 1}</span>
        {canRemove && (
          <button type="button" onClick={onRemove}
            className="text-xs text-red-400 hover:text-red-600 transition-colors">
            삭제
          </button>
        )}
      </div>

      {/* 호기 선택 */}
      <select
        value={group.elevatorName}
        onChange={e => onElevatorChange(e.target.value)}
        className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-400"
      >
        <option value="">호기 선택 (선택사항)</option>
        {elevators.map(e => (
          <option key={e.id} value={e.unitName ?? e.elevatorNo ?? String(e.id)}>
            {e.unitName ?? "-"} {e.elevatorNo ? `(${e.elevatorNo})` : ""}
          </option>
        ))}
      </select>

      {/* 자재 검색 */}
      <div ref={searchRef} className="space-y-1.5">
        {/* DS / TK 토글 */}
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-700 rounded-xl">
          {(["ALL", "DS", "TK"] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => { setMatType(t); setMatResults([]); setShowDropdown(false); }}
              className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-colors
                ${matType === t
                  ? t === "DS" ? "bg-slate-700 text-white shadow-sm"
                    : t === "TK" ? "bg-blue-600 text-white shadow-sm"
                    : "bg-white dark:bg-gray-600 text-gray-700 dark:text-gray-200 shadow-sm"
                  : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"}`}
            >
              {t === "ALL" ? "전체" : t}
            </button>
          ))}
        </div>
        <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={matQuery}
          onChange={e => setMatQuery(e.target.value)}
          onFocus={() => matResults.length > 0 && setShowDropdown(true)}
          placeholder={matType === "DS" ? "DS 자재 검색" : matType === "TK" ? "TK 자재 검색" : "자재 검색 (부품명·코드·별칭)"}
          className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        {showDropdown && matResults.length > 0 && (
          <ul className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg overflow-y-auto max-h-48">
            {matResults.map(m => {
              const checked = isSelected(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => toggleMaterial(m)}
                    className={`w-full text-left px-3 py-2 transition-colors flex items-start gap-2.5 ${checked ? "bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600" : "hover:bg-gray-50 dark:hover:bg-gray-700"}`}
                  >
                    <span className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold
                      ${checked ? "bg-slate-700 border-slate-700 text-white" : "border-gray-300 dark:border-gray-600"}`}>
                      {checked && "✓"}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-slate-400 dark:text-slate-500 shrink-0">{m.id}</span>
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{m.name}</span>
                      </span>
                      <span className="flex gap-2 mt-0.5">
                        {m.alias && <span className="text-xs text-gray-400 dark:text-gray-500">{m.alias}</span>}
                        <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">재고 {m.stockQty}</span>
                      </span>
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
      {group.items.length > 0 ? (
        <ul className="space-y-1.5">
          {group.items.map(item => (
            <li key={item.material.id}
              className="flex items-center gap-2 bg-white dark:bg-gray-700 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-600">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono text-slate-400 dark:text-slate-500 shrink-0">{item.material.id}</span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{item.material.name}</span>
                </div>
                <span className={`text-xs ${item.material.stockQty === 0 ? "text-red-500" : "text-gray-400 dark:text-gray-500"}`}>
                  재고 {item.material.stockQty}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => updateQty(item.material.id, item.qty - 1)}
                  disabled={item.qty <= 1}
                  className="w-6 h-6 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-30 flex items-center justify-center text-sm">
                  −
                </button>
                <input type="number" min={1} value={item.qty}
                  onChange={e => updateQty(item.material.id, Number(e.target.value))}
                  className="w-10 text-center text-sm font-semibold text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-lg py-0.5 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                <button type="button" onClick={() => updateQty(item.material.id, item.qty + 1)}
                  className="w-6 h-6 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center justify-center text-sm">
                  +
                </button>
              </div>
              <button type="button" onClick={() => removeItem(item.material.id)}
                className="text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors text-xl leading-none ml-1">
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-0.5">자재를 검색하여 추가하세요</p>
      )}
    </div>
  );
}

// ── 메인 모달 ───────────────────────────────────────────────
export default function MaterialRequestModal({ sites, user, onClose, onSaved }: Props) {
  const [siteName, setSiteName] = useState("");
  const [elevators, setElevators] = useState<ElevatorRecord[]>([]);
  const [groups, setGroups] = useState<ElevatorGroup[]>([
    { id: "1", elevatorName: "", items: [] },
  ]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!siteName) {
      const t = setTimeout(() => setElevators([]), 0);
      return () => clearTimeout(t);
    }
    api.get<ElevatorRecord[]>(`/api/elevators?site=${encodeURIComponent(siteName)}`)
      .then(setElevators).catch(() => setElevators([]));
  }, [siteName]);

  function addGroup() {
    setGroups(prev => [...prev, { id: Date.now().toString(), elevatorName: "", items: [] }]);
  }

  function removeGroup(id: string) {
    setGroups(prev => prev.filter(g => g.id !== id));
  }

  function updateGroup(id: string, patch: Partial<ElevatorGroup>) {
    setGroups(prev => prev.map(g => g.id === id ? { ...g, ...patch } : g));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const filled = groups.filter(g => g.items.length > 0);
    if (filled.length === 0) { setError("자재를 1개 이상 추가해 주세요."); return; }
    setSaving(true);
    try {
      const items = filled.flatMap(group =>
        group.items.map(item => ({
          materialId: item.material.id,
          materialName: item.material.name,
          qty: item.qty,
          elevatorName: group.elevatorName || null,
        }))
      );
      await api.post("/api/material-requests", {
        siteName: siteName || null,
        items,
        note: note || null,
        requesterId: user.id,
        requesterName: user.name,
        requesterDept: user.dept,
      });
      onSaved();
    } catch (e) {
      setError(getErrorMessage(e));
      setSaving(false);
    }
  }

  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">자재 신청</h2>
          <button type="button" onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {/* 현장 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              현장 <span className="text-red-400">*</span>
            </label>
            <SiteSearchInput
              sites={sites}
              value={siteName}
              onChange={name => { setSiteName(name); setError(""); }}
              placeholder="현장명 입력 (선택사항)"
            />
          </div>

          {/* 호기별 자재 그룹 */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">호기별 자재</label>
              {totalItems > 0 && (
                <span className="text-xs text-slate-500 dark:text-slate-400">총 {totalItems}종</span>
              )}
            </div>

            {groups.map((group, index) => (
              <ElevatorGroupRow
                key={group.id}
                group={group}
                elevators={elevators}
                index={index}
                canRemove={groups.length > 1}
                onElevatorChange={name => updateGroup(group.id, { elevatorName: name })}
                onItemsChange={items => updateGroup(group.id, { items })}
                onRemove={() => removeGroup(group.id)}
              />
            ))}

            {/* 호기 추가 버튼 */}
            <button
              type="button"
              onClick={addGroup}
              className="w-full py-2.5 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-600 text-sm text-gray-400 dark:text-gray-500
                hover:border-slate-300 dark:hover:border-slate-500 hover:text-slate-600 dark:hover:text-slate-400 transition-colors"
            >
              + 호기 추가
            </button>
          </div>

          {/* 메모 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">신청 사유 / 메모</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="교체 사유, 긴급 여부 등"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-400 resize-none" />
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
            <span>신청자:</span>
            <span className="font-medium text-gray-600 dark:text-gray-400">{user.name}</span>
            <span>({user.dept})</span>
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/30 rounded-lg px-4 py-2.5">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              취소
            </button>
            <button type="submit" disabled={saving || totalItems === 0}
              className="flex-1 py-2.5 rounded-xl bg-slate-700 text-white text-sm font-semibold hover:bg-slate-800 transition-colors disabled:opacity-60">
              {saving ? "신청 중..." : totalItems > 0 ? `${totalItems}건 신청 등록` : "신청 등록"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
