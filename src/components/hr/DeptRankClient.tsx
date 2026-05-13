"use client";

import { useEffect, useState } from "react";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import DraggableModal from "@/components/common/DraggableModal";

interface OrgItem {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
}

type Tab = "dept" | "rank";

export default function DeptRankClient() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("dept");

  if (!user) {
    return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  }
  if (!isAdmin(user)) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">관리자 권한이 필요합니다</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">부서/직급관리 페이지는 관리자만 접근할 수 있습니다.</div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">부서/직급 관리</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">사원등록 시 사용할 부서·직급 코드 관리 (관리자 전용)</p>
      </div>

      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6">
        <div className="flex gap-1">
          {([["dept", "🏢 부서"], ["rank", "🎖️ 직급"]] as [Tab, string][]).map(([t, label]) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors ${
                tab === t
                  ? "text-blue-600 dark:text-blue-400 border-blue-500"
                  : "text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-200"
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 py-4">
        {tab === "dept" && <OrgEditor table="departments" title="부서" />}
        {tab === "rank" && <OrgEditor table="ranks" title="직급" />}
      </div>
    </div>
  );
}

// ============================================================
// 부서/직급 공용 에디터
// ============================================================

function OrgEditor({ table, title }: { table: "departments" | "ranks"; title: string }) {
  const [items, setItems] = useState<OrgItem[]>([]);
  const [editing, setEditing] = useState<OrgItem | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    const { data } = await supabase.from(table).select("*").order("sort_order");
    setItems((data ?? []) as OrgItem[]);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [table]);

  async function toggleActive(id: number, v: boolean) {
    await supabase.from(table).update({ is_active: v }).eq("id", id);
    load();
  }

  async function remove(id: number, name: string) {
    if (!confirm(`${title} '${name}'을(를) 삭제하시겠습니까?`)) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) { alert(`삭제 실패: ${error.message}`); return; }
    load();
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="text-xs text-gray-500 dark:text-gray-400">총 {items.length}건</div>
        <button type="button" onClick={() => setShowNew(true)}
          className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">
          + {title} 추가
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase">
            <tr>
              <th className="px-3 py-2 text-center">{title}명</th>
              <th className="px-3 py-2 text-center">정렬</th>
              <th className="px-3 py-2 text-center">상태</th>
              <th className="px-3 py-2 text-right">액션</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {items.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-xs text-gray-500">등록된 항목이 없습니다.</td></tr>
            )}
            {items.map(r => (
              <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-3 py-2 text-center text-xs font-semibold text-gray-800 dark:text-gray-100">{r.name}</td>
                <td className="px-3 py-2 text-center text-xs text-gray-500 dark:text-gray-400">{r.sort_order}</td>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => toggleActive(r.id, !r.is_active)}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      r.is_active
                        ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                    }`}>
                    {r.is_active ? "활성" : "비활성"}
                  </button>
                </td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <button type="button" onClick={() => setEditing(r)}
                    className="px-2 py-0.5 text-[11px] rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 mr-1">
                    수정
                  </button>
                  <button type="button" onClick={() => remove(r.id, r.name)}
                    className="px-2 py-0.5 text-[11px] rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200">
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(showNew || editing) && (
        <OrgEditModal
          table={table}
          title={title}
          initial={editing}
          onClose={() => { setShowNew(false); setEditing(null); }}
          onSaved={() => { setShowNew(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function OrgEditModal({
  table, title, initial, onClose, onSaved,
}: {
  table: "departments" | "ranks";
  title: string;
  initial: OrgItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) { alert(`${title}명은 필수입니다.`); return; }
    setSaving(true);
    const payload = { name: name.trim(), sort_order: Number(sortOrder) || 0 };
    const res = initial
      ? await supabase.from(table).update(payload).eq("id", initial.id)
      : await supabase.from(table).insert(payload);
    setSaving(false);
    if (res.error) {
      alert(res.error.code === "23505" ? `이미 존재하는 ${title}명입니다.` : res.error.message);
      return;
    }
    onSaved();
  }

  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-full max-w-sm"
      z={60}
      header={
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-base font-bold text-gray-900 dark:text-white">{initial ? `${title} 수정` : `${title} 추가`}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
      }
    >
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{title}명 *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} lang="ko"
              autoFocus
              onKeyDown={e => { if (e.key === "Enter" && !(e.nativeEvent as KeyboardEvent).isComposing) { e.preventDefault(); save(); } }}
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">정렬 순서</label>
            <input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))}
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">취소</button>
          <button type="button" onClick={save} disabled={saving}
            className="px-4 py-2 rounded text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
    </DraggableModal>
  );
}
