"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { useAuth, hasMenuPermission, isAdmin } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useViewMode } from "@/context/ViewModeContext";
import { supabase } from "@/lib/supabase";
import { formatDate as formatYmd } from "@/lib/input-format";
import { fmtNum } from "@/lib/format";
import DraggableModal from "@/components/common/DraggableModal";

export const RP_MENU_HREF = "/hr/rewards-punishments";

type Kind = "상" | "벌" | "";
type KindFilter = "전체" | "상" | "벌";

interface RPRow {
  id: number;        // 0이면 신규 등록
  user_id: number;
  kind: Kind;
  content: string;
  occurred_on: string | null;
}

interface Account {
  id: number;
  username: string;
  dept: string | null;
  status: string | null;
}

function KindBadge({ kind }: { kind: Kind }) {
  if (kind === "상")
    return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 whitespace-nowrap">🏆 상</span>;
  if (kind === "벌")
    return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-50 text-red-600 dark:bg-red-900/40 dark:text-red-300 whitespace-nowrap">⚠️ 벌</span>;
  return <span className="text-xs text-gray-400">-</span>;
}

export default function RewardsPunishmentsClient() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { viewMode } = useViewMode();
  const isMobile = viewMode === "mobile";

  const canCreate = user ? (isAdmin(user) || hasMenuPermission(user, RP_MENU_HREF, "create")) : false;
  const canUpdate = user ? (isAdmin(user) || hasMenuPermission(user, RP_MENU_HREF, "update")) : false;

  const [rows, setRows] = useState<RPRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("전체");
  const [editing, setEditing] = useState<RPRow | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(() => {
    supabase.from("user_rewards_punishments").select("id, user_id, kind, content, occurred_on").then(({ data }) => {
      setRows((data as RPRow[] | null) ?? []);
    });
    supabase.from("accounts").select("id, username, dept, status").order("username").then(({ data }) => {
      setAccounts((data as Account[] | null) ?? []);
    });
  }, []);
  useReloadOnActivate(reload);
  useEffect(() => { reload(); }, [reload]);

  const accById = useMemo(() => {
    const m = new Map<number, Account>();
    accounts.forEach(a => m.set(a.id, a));
    return m;
  }, [accounts]);

  // 등록 모달 사원 후보: 재직자 우선
  const selectableAccounts = useMemo(
    () => [...accounts].sort((a, b) => {
      const ax = a.status === "재직" ? 0 : 1;
      const bx = b.status === "재직" ? 0 : 1;
      return ax !== bx ? ax - bx : a.username.localeCompare(b.username, "ko");
    }),
    [accounts]
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    return rows
      .filter(r => kindFilter === "전체" || r.kind === kindFilter)
      .filter(r => {
        if (!q) return true;
        const acc = accById.get(r.user_id);
        return (acc?.username?.toLowerCase().includes(q) ?? false) || r.content.toLowerCase().includes(q);
      })
      .sort((a, b) => (b.occurred_on ?? "").localeCompare(a.occurred_on ?? ""));
  }, [rows, kindFilter, q, accById]);

  async function handleSave(draft: RPRow) {
    if (!draft.user_id) { alert("사원을 선택하세요."); return; }
    if (!draft.kind) { alert("구분(상/벌)을 선택하세요."); return; }
    if (!draft.content.trim()) { alert("내용을 입력하세요."); return; }
    setSaving(true);
    try {
      if (draft.id === 0) {
        const { error } = await supabase.from("user_rewards_punishments").insert({
          user_id: draft.user_id, kind: draft.kind, content: draft.content.trim(),
          occurred_on: draft.occurred_on || null, sort_order: 0,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("user_rewards_punishments").update({
          user_id: draft.user_id, kind: draft.kind, content: draft.content.trim(),
          occurred_on: draft.occurred_on || null,
        }).eq("id", draft.id);
        if (error) throw error;
      }
      setEditing(null);
      reload();
    } catch (e) {
      alert("저장 실패: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: RPRow) {
    const name = accById.get(row.user_id)?.username ?? "";
    if (!confirm(`${name} 님의 상벌 '${row.content}'을(를) 삭제할까요?`)) return;
    try {
      const { error } = await supabase.from("user_rewards_punishments").delete().eq("id", row.id);
      if (error) throw error;
      reload();
    } catch (e) {
      alert("삭제 실패: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  const inputCls = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400";
  const labelCls = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1";

  return (
    <>
      {/* 툴바 */}
      <div className={`flex gap-3 ${isMobile ? "flex-col" : "items-center flex-wrap"}`}>
        {/* 구분 필터 */}
        <div className={`flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl ${isMobile ? "w-full justify-between" : "shrink-0"}`}>
          {(["전체", "상", "벌"] as const).map(k => {
            const count = k === "전체" ? rows.length : rows.filter(r => r.kind === k).length;
            return (
              <button key={k} type="button" onClick={() => setKindFilter(k)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${isMobile ? "flex-1" : ""}
                  ${kindFilter === k
                    ? k === "전체" ? "bg-gray-900 text-white shadow-sm" : "bg-white text-gray-700 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                    : isDark ? "text-gray-400 hover:text-gray-200" : "text-gray-400 hover:text-gray-600"}`}>
                {k === "상" ? "🏆 상" : k === "벌" ? "⚠️ 벌" : "전체"} <span className="font-normal opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {/* 검색 */}
        <div className={`relative min-w-48 ${isMobile ? "w-full" : "flex-1"}`}>
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input lang="ko" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="사원명, 내용 검색"
            className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500" />
          {query && (
            <button type="button" onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
          )}
        </div>

        <div className={isMobile ? "flex items-center justify-between w-full" : "contents"}>
          <span className="text-sm text-gray-500 shrink-0">{fmtNum(filtered.length)}건</span>
          {canCreate && (
            <button type="button"
              onClick={() => setEditing({ id: 0, user_id: 0, kind: "", content: "", occurred_on: "" })}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-700 text-white hover:bg-slate-800 transition-colors">
              + 상벌 등록
            </button>
          )}
        </div>
      </div>

      {/* 목록 — 모바일: 카드 / PC: 테이블 */}
      <div className={`mt-4 rounded-xl border overflow-hidden transition-colors ${isDark ? "bg-gray-900 border-gray-700" : "bg-white border-gray-200"}`}>
        {isMobile ? (
          <div className={`divide-y ${isDark ? "divide-gray-700" : "divide-gray-100"}`}>
            {filtered.length === 0 ? (
              <div className={`text-center py-12 text-sm ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                {q || kindFilter !== "전체" ? "조건에 맞는 상벌이 없습니다" : "등록된 상벌이 없습니다"}
              </div>
            ) : filtered.map(r => {
              const acc = accById.get(r.user_id);
              return (
                <div key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800 dark:text-white">{acc?.username ?? `#${r.user_id}`}</span>
                        <KindBadge kind={r.kind} />
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{acc?.dept ?? "-"} · {r.occurred_on ?? "일자 미상"}</p>
                      <p className="text-sm text-gray-700 dark:text-gray-200 mt-1.5 break-words">{r.content}</p>
                    </div>
                    {canUpdate && (
                      <div className="flex flex-col gap-1 shrink-0">
                        <button type="button" onClick={() => setEditing(r)} className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-300">✏️</button>
                        <button type="button" onClick={() => handleDelete(r)} className="text-xs px-2 py-1 rounded border border-red-200 dark:border-red-800 text-red-500">🗑</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-260px)]">
            <table className="w-full min-w-[640px] text-sm">
              <thead className={`sticky top-0 z-10 border-b transition-colors ${isDark ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-100"}`}>
                <tr className={`text-xs font-medium ${isDark ? "text-gray-300" : "text-gray-500"}`}>
                  <th className="px-4 py-3 text-left whitespace-nowrap">사원</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">부서</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">구분</th>
                  <th className="px-4 py-3 text-left">내용</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">일자</th>
                  {canUpdate && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? "divide-gray-700" : "divide-gray-50"}`}>
                {filtered.length === 0 ? (
                  <tr><td colSpan={canUpdate ? 6 : 5} className={`text-center py-12 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                    {q || kindFilter !== "전체" ? "조건에 맞는 상벌이 없습니다" : "등록된 상벌이 없습니다"}
                  </td></tr>
                ) : filtered.map(r => {
                  const acc = accById.get(r.user_id);
                  return (
                    <tr key={r.id} className={`transition-colors ${isDark ? "hover:bg-gray-800" : "hover:bg-gray-50"}`}>
                      <td className={`px-4 py-3 font-medium whitespace-nowrap ${isDark ? "text-white" : "text-gray-800"}`}>{acc?.username ?? `#${r.user_id}`}</td>
                      <td className={`px-4 py-3 whitespace-nowrap ${isDark ? "text-gray-300" : "text-gray-600"}`}>{acc?.dept ?? "-"}</td>
                      <td className="px-4 py-3 text-center"><KindBadge kind={r.kind} /></td>
                      <td className={`px-4 py-3 ${isDark ? "text-gray-200" : "text-gray-700"}`}>{r.content}</td>
                      <td className={`px-4 py-3 text-center whitespace-nowrap font-mono text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>{r.occurred_on ?? "-"}</td>
                      {canUpdate && (
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          <button type="button" onClick={() => setEditing(r)}
                            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors mr-1 ${isDark ? "border-gray-600 text-gray-300 hover:bg-gray-700" : "border-gray-200 text-gray-500 hover:bg-slate-50"}`}>수정</button>
                          <button type="button" onClick={() => handleDelete(r)}
                            className="text-xs px-2.5 py-1 rounded-lg border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">삭제</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 등록/수정 모달 */}
      {editing && (
        <DraggableModal
          open={!!editing}
          onClose={() => setEditing(null)}
          panelClassName="w-full max-w-md mx-4 max-h-[85vh]"
          header={
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">{editing.id === 0 ? "상벌 등록" : "상벌 수정"}</h2>
              <button type="button" onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
          }
        >
          <div className="px-6 py-5 space-y-3 overflow-y-auto">
            <div>
              <label className={labelCls}>사원 *</label>
              <select value={editing.user_id || ""}
                onChange={e => setEditing(prev => prev ? { ...prev, user_id: Number(e.target.value) } : prev)}
                className={inputCls}>
                <option value="">사원 선택</option>
                {selectableAccounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.username}{a.dept ? ` (${a.dept})` : ""}{a.status && a.status !== "재직" ? ` · ${a.status}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>구분 *</label>
              <select value={editing.kind}
                onChange={e => setEditing(prev => prev ? { ...prev, kind: e.target.value as Kind } : prev)}
                className={inputCls}>
                <option value="">선택</option>
                <option value="상">🏆 상</option>
                <option value="벌">⚠️ 벌</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>내용 *</label>
              <input type="text" value={editing.content}
                onChange={e => setEditing(prev => prev ? { ...prev, content: e.target.value } : prev)}
                placeholder="예: 우수사원 표창, 안전수칙 위반 경고" lang="ko" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>일자</label>
              <input type="text" value={editing.occurred_on ?? ""}
                onChange={e => setEditing(prev => prev ? { ...prev, occurred_on: formatYmd(e.target.value) } : prev)}
                placeholder="YYYYMMDD" inputMode="numeric" maxLength={10} className={inputCls + " font-mono"} />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">취소</button>
              <button type="button" disabled={saving} onClick={() => handleSave(editing)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-slate-700 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50">
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </DraggableModal>
      )}
    </>
  );
}
