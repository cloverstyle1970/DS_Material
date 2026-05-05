"use client";

import { useEffect, useMemo, useState } from "react";
import { api, getErrorMessage } from "@/lib/api-client";
import { MaterialUnitRecord } from "@/lib/mock-material-units";

interface Props {
  mode: "inbound" | "outbound";
  materialId: string;
  materialName: string;
  initial: string[];
  onClose: () => void;
  onSave: (serialNos: string[]) => void;
}

export default function SerialEntryModal({ mode, materialId, materialName, initial, onClose, onSave }: Props) {
  const [text,    setText]    = useState(initial.join("\n"));
  const [units,   setUnits]   = useState<MaterialUnitRecord[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set(initial));
  const [loading, setLoading] = useState(false);
  const [query,   setQuery]   = useState("");

  useEffect(() => {
    if (mode !== "outbound") return;
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      api.get<MaterialUnitRecord[]>(`/api/material-units?materialId=${encodeURIComponent(materialId)}&status=재고`)
        .then(rows => { if (!cancelled) setUnits(rows); })
        .catch(e => { if (!cancelled) alert(getErrorMessage(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [mode, materialId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return units;
    return units.filter(u => u.serialNo.toLowerCase().includes(q));
  }, [units, query]);

  function toggle(serial: string) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(serial)) next.delete(serial); else next.add(serial);
      return next;
    });
  }

  function handleSave() {
    if (mode === "inbound") {
      const list = text
        .split(/[\r\n,]+/)
        .map(s => s.trim())
        .filter(Boolean);
      const dup = list.find((s, i) => list.indexOf(s) !== i);
      if (dup) { alert(`중복된 S/N: ${dup}`); return; }
      onSave(list);
    } else {
      onSave(Array.from(checked));
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[560px] max-w-[95vw] flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{mode === "inbound" ? "입고 S/N 입력" : "출고 S/N 선택"}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{materialName} <span className="font-mono ml-1 text-slate-400">({materialId})</span></p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">×</button>
        </div>

        {mode === "inbound" ? (
          <div className="p-4 flex-1 overflow-auto">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">한 줄에 하나씩 시리얼 번호 입력 (또는 쉼표로 구분)</p>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={10}
              placeholder="SN-001&#10;SN-002&#10;SN-003"
              className="w-full px-3 py-2 text-xs font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-300 placeholder:text-gray-400 dark:placeholder:text-gray-500" />
            <p className="text-[11px] text-gray-400 mt-1.5">
              현재 입력 {text.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean).length}개 / 빈 줄·중복은 자동 제거
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 shrink-0 flex items-center gap-2">
              <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="S/N 검색"
                className="flex-1 px-2.5 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-300 placeholder:text-gray-400 dark:placeholder:text-gray-500" />
              <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">재고 {filtered.length}개 / 선택 {checked.size}개</span>
            </div>
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="text-center py-8 text-xs text-gray-400">로딩 중...</div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-8 text-xs text-gray-400">재고 상태인 S/N이 없습니다.</div>
              ) : (
                <ul className="divide-y divide-gray-50 dark:divide-gray-700">
                  {filtered.map(u => {
                    const sel = checked.has(u.serialNo);
                    return (
                      <li key={u.id}>
                        <button type="button" onClick={() => toggle(u.serialNo)}
                          className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${sel ? "bg-blue-50 dark:bg-blue-900/30" : "hover:bg-gray-50 dark:hover:bg-gray-700"}`}>
                          <input type="checkbox" readOnly checked={sel} className="accent-blue-600" />
                          <span className="font-mono text-xs text-gray-800 dark:text-gray-200 flex-1">{u.serialNo}</span>
                          <span className="text-[10px] text-gray-400">입고 {u.inboundAt.slice(0,10)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-2 shrink-0 bg-gray-50 dark:bg-gray-700/50">
          <button type="button" onClick={onClose}
            className="text-xs px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600">취소</button>
          <button type="button" onClick={handleSave}
            className="text-xs px-4 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700">확인</button>
        </div>
      </div>
    </div>
  );
}
