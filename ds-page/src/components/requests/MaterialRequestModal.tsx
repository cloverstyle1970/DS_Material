"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import { AuthUser } from "@/context/AuthContext";
import { MaterialRecord } from "@/lib/mock-materials";
import SiteSearchInput from "@/components/ui/SiteSearchInput";
import { ElevatorRecord } from "@/lib/mock-elevators";

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
    <div className="border border-gray-200 rounded-xl p-3.5 space-y-3 bg-gray-50/60">
      {/* 행 헤더 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 tracking-wide">호기 {index + 1}</span>
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
        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
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
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
          {(["ALL", "DS", "TK"] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => { setMatType(t); setMatResults([]); setShowDropdown(false); }}
              className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-colors
                ${matType === t
                  ? t === "DS" ? "bg-slate-700 text-white shadow-sm"
                    : t === "TK" ? "bg-blue-600 text-white shadow-sm"
                    : "bg-white text-gray-700 shadow-sm"
                  : "text-gray-400 hover:text-gray-600"}`}
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
          className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        {showDropdown && matResults.length > 0 && (
          <ul className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-y-auto max-h-48">
            {matResults.map(m => {
              const checked = isSelected(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => toggleMaterial(m)}
                    className={`w-full text-left px-3 py-2 transition-colors flex items-start gap-2.5 ${checked ? "bg-slate-50 hover:bg-slate-100" : "hover:bg-gray-50"}`}
                  >
                    <span className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold
                      ${checked ? "bg-slate-700 border-slate-700 text-white" : "border-gray-300"}`}>
                      {checked && "✓"}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-slate-400 shrink-0">{m.id}</span>
                        <span className="text-sm font-medium text-gray-800 truncate">{m.name}</span>
                      </span>
                      <span className="flex gap-2 mt-0.5">
                        {m.alias && <span className="text-xs text-gray-400">{m.alias}</span>}
                        <span className="text-xs text-gray-400 ml-auto">재고 {m.stockQty}</span>
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
              className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-gray-100">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono text-slate-400 shrink-0">{item.material.id}</span>
                  <span className="text-sm font-medium text-gray-800 truncate">{item.material.name}</span>
                </div>
                <span className={`text-xs ${item.material.stockQty === 0 ? "text-red-500" : "text-gray-400"}`}>
                  재고 {item.material.stockQty}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => updateQty(item.material.id, item.qty - 1)}
                  disabled={item.qty <= 1}
                  className="w-6 h-6 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 flex items-center justify-center text-sm">
                  −
                </button>
                <input type="number" min={1} value={item.qty}
                  onChange={e => updateQty(item.material.id, Number(e.target.value))}
                  className="w-10 text-center text-sm font-semibold text-gray-800 border border-gray-200 rounded-lg py-0.5 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                <button type="button" onClick={() => updateQty(item.material.id, item.qty + 1)}
                  className="w-6 h-6 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 flex items-center justify-center text-sm">
                  +
                </button>
              </div>
              <button type="button" onClick={() => removeItem(item.material.id)}
                className="text-gray-300 hover:text-red-400 transition-colors text-xl leading-none ml-1">
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-400 text-center py-0.5">자재를 검색하여 추가하세요</p>
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
    if (!siteName) { setElevators([]); return; }
    fetch(`/api/elevators?site=${encodeURIComponent(siteName)}`)
      .then(r => r.json())
      .then(setElevators);
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
      const res = await fetch("/api/material-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteName: siteName || null,
          items,
          note: note || null,
          requesterId: user.id,
          requesterName: user.name,
          requesterDept: user.dept,
        }),
      });
      if (!res.ok) throw new Error();
      onSaved();
    } catch {
      setError("오류가 발생했습니다.");
      setSaving(false);
    }
  }

  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-800">자재 신청</h2>
          <button type="button" onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {/* 현장 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
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
              <label className="text-sm font-medium text-gray-700">호기별 자재</label>
              {totalItems > 0 && (
                <span className="text-xs text-slate-500">총 {totalItems}종</span>
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
              className="w-full py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400
                hover:border-slate-300 hover:text-slate-600 transition-colors"
            >
              + 호기 추가
            </button>
          </div>

          {/* 메모 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">신청 사유 / 메모</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="교체 사유, 긴급 여부 등"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-slate-400 resize-none" />
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>신청자:</span>
            <span className="font-medium text-gray-600">{user.name}</span>
            <span>({user.dept})</span>
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-2.5">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
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
