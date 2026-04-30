"use client";

import { useState, useEffect, useCallback } from "react";
import { CategoryStore, CategoryItem } from "@/lib/mock-categories";
import { api as apiClient, getErrorMessage } from "@/lib/api-client";

interface Props {
  onClose: () => void;
}

function EditableRow({
  item, onSave, onDelete,
}: {
  item: CategoryItem;
  onSave: (code: string, label: string) => Promise<void>;
  onDelete: (code: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.label);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!draft.trim() || draft === item.label) { setEditing(false); return; }
    setBusy(true);
    await onSave(item.code, draft.trim());
    setBusy(false);
    setEditing(false);
  }

  async function remove() {
    if (!confirm(`"${item.label}" 분류를 삭제하면 하위 분류도 모두 삭제됩니다. 계속할까요?`)) return;
    setBusy(true);
    await onDelete(item.code);
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 group">
      <span className="font-mono text-xs text-gray-400 dark:text-gray-500 w-6 shrink-0">{item.code}</span>
      {editing ? (
        <>
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(item.label); setEditing(false); } }}
            className="flex-1 text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-0.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-slate-400" />
          <button type="button" onClick={save} disabled={busy} className="text-xs text-green-600 hover:text-green-800 font-medium">저장</button>
          <button type="button" onClick={() => { setDraft(item.label); setEditing(false); }} className="text-xs text-gray-400">취소</button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{item.label}</span>
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">수정</button>
          <button type="button" onClick={remove} disabled={busy} className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">삭제</button>
        </>
      )}
    </div>
  );
}

function AddRow({ onAdd }: { onAdd: (label: string) => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!label.trim()) return;
    setBusy(true);
    await onAdd(label.trim());
    setLabel("");
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-2 mt-2 shrink-0">
      <input value={label} onChange={e => setLabel(e.target.value)} placeholder="새 항목 이름"
        onKeyDown={e => e.key === "Enter" && submit()}
        className="flex-1 text-sm text-gray-800 dark:text-gray-100 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-700 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-slate-400" />
      <button type="button" onClick={submit} disabled={busy || !label.trim()}
        className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 disabled:opacity-40 transition-colors shrink-0">
        추가
      </button>
    </div>
  );
}

export default function CategoryManagerModal({ onClose }: Props) {
  const [store, setStore] = useState<CategoryStore | null>(null);
  const [selMajor, setSelMajor] = useState<string | null>(null);
  const [selMid, setSelMid] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiClient.get<CategoryStore>("/api/categories");
      setStore(data);
      if (!selMajor && data.major.length) setSelMajor(data.major[0].code);
    } catch (e) {
      alert(getErrorMessage(e));
    }
  }, [selMajor]);

  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function api(method: string, body: object) {
    try {
      if (method === "POST")        await apiClient.post("/api/categories", body);
      else if (method === "PATCH")  await apiClient.patch("/api/categories", body);
      else if (method === "DELETE") {
        // DELETE에 body 전달 위해 직접 fetch — api-client는 body 미지원
        const res = await fetch("/api/categories", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(`${res.status}`);
      }
      await load();
    } catch (e) {
      alert(getErrorMessage(e));
    }
  }

  if (!store) return null;

  const midList = selMajor ? (store.mid[selMajor] ?? []) : [];
  const subList = selMajor && selMid ? (store.sub[`${selMajor}${selMid}`] ?? []) : [];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">분류 관리</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">×</button>
        </div>

        <div className="flex flex-1 min-h-0 divide-x divide-gray-100 dark:divide-gray-700 overflow-hidden">
          {/* 대분류 */}
          <div className="w-1/3 flex flex-col min-h-0 p-4">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 shrink-0">대분류</p>
            <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
              {store.major.map(m => (
                <div key={m.code}
                  className={`cursor-pointer rounded-lg transition-colors ${selMajor === m.code ? "bg-slate-100 dark:bg-slate-700" : ""}`}
                  onClick={() => { setSelMajor(m.code); setSelMid(null); }}>
                  <EditableRow item={m}
                    onSave={(code, label) => api("PATCH", { level: "major", code, label })}
                    onDelete={(code) => { if (selMajor === code) setSelMajor(null); return api("DELETE", { level: "major", code }); }} />
                </div>
              ))}
            </div>
            <AddRow onAdd={label => api("POST", { level: "major", label })} />
          </div>

          {/* 중분류 */}
          <div className="w-1/3 flex flex-col min-h-0 p-4">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 shrink-0">
              중분류 {selMajor ? <span className="text-slate-400 dark:text-slate-500 font-normal normal-case">({store.major.find(m => m.code === selMajor)?.label})</span> : ""}
            </p>
            {!selMajor ? (
              <p className="text-sm text-gray-300 dark:text-gray-600 mt-4 text-center">대분류를 선택하세요</p>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
                  {midList.map(m => (
                    <div key={m.code}
                      className={`cursor-pointer rounded-lg transition-colors ${selMid === m.code ? "bg-slate-100 dark:bg-slate-700" : ""}`}
                      onClick={() => setSelMid(m.code)}>
                      <EditableRow item={m}
                        onSave={(code, label) => api("PATCH", { level: "mid", majorCode: selMajor, code, label })}
                        onDelete={(code) => { if (selMid === code) setSelMid(null); return api("DELETE", { level: "mid", majorCode: selMajor, code }); }} />
                    </div>
                  ))}
                </div>
                <AddRow onAdd={label => api("POST", { level: "mid", majorCode: selMajor, label })} />
              </>
            )}
          </div>

          {/* 소분류 */}
          <div className="w-1/3 flex flex-col min-h-0 p-4">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 shrink-0">
              소분류 {selMid ? <span className="text-slate-400 dark:text-slate-500 font-normal normal-case">({midList.find(m => m.code === selMid)?.label})</span> : ""}
            </p>
            {!selMid ? (
              <p className="text-sm text-gray-300 dark:text-gray-600 mt-4 text-center">중분류를 선택하세요</p>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
                  {subList.map(s => (
                    <div key={s.code}>
                      <EditableRow item={s}
                        onSave={(code, label) => api("PATCH", { level: "sub", majorCode: selMajor, midCode: selMid, code, label })}
                        onDelete={(code) => api("DELETE", { level: "sub", majorCode: selMajor, midCode: selMid, code })} />
                    </div>
                  ))}
                </div>
                <AddRow onAdd={label => api("POST", { level: "sub", majorCode: selMajor, midCode: selMid, label })} />
              </>
            )}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 shrink-0 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">닫기</button>
        </div>
      </div>
    </div>
  );
}
