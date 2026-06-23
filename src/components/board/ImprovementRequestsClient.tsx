"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { insertNotification } from "@/lib/notify";
import Header from "@/components/layout/Header";

type Status = "접수" | "검토중" | "반영" | "거부";
const STATUSES: Status[] = ["접수", "검토중", "반영", "거부"];

const STATUS_STYLE: Record<Status, string> = {
  "접수":   "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  "검토중": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "반영":   "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "거부":   "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

interface Row {
  id: number;
  title: string;
  content: string;
  status: Status;
  response: string | null;
  author_id: number;
  assignee_id: number | null;
  created_at: string;
  updated_at: string;
  author?:   { username: string | null } | null;
  assignee?: { username: string | null } | null;
}

const SELECT_COLS =
  "id, title, content, status, response, author_id, assignee_id, created_at, updated_at, " +
  "author:accounts!author_id(username), assignee:accounts!assignee_id(username)";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

export default function ImprovementRequestsClient() {
  const { user } = useAuth();
  const admin = !!user && isAdmin(user);
  const canCreate = !!user && hasMenuPermission(user, "/board/improvements", "create");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Status | "전체">("전체");

  const [openId, setOpenId] = useState<number | "new" | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("improvement_requests")
      .select(SELECT_COLS)
      .order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      setRows([]);
    } else {
      setRows((data ?? []) as unknown as Row[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useReloadOnActivate(() => { void refresh(); });

  const filtered = useMemo(() =>
    filter === "전체" ? rows : rows.filter(r => r.status === filter), [rows, filter]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { "접수":0, "검토중":0, "반영":0, "거부":0 };
    rows.forEach(r => { c[r.status]++; });
    return c;
  }, [rows]);

  const openRow = openId !== null && openId !== "new" ? rows.find(r => r.id === openId) ?? null : null;

  return (
    <>
      <Header title="개선요청 게시판" />
      <main className="flex-1 p-6 bg-gray-50 dark:bg-gray-900 overflow-y-auto">
        <div className="max-w-5xl mx-auto space-y-4">

          {/* 상단 컨트롤 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              <FilterChip active={filter==="전체"} label={`전체 ${rows.length}`} onClick={() => setFilter("전체")} />
              {STATUSES.map(s => (
                <FilterChip key={s} active={filter===s} label={`${s} ${counts[s]}`} onClick={() => setFilter(s)} />
              ))}
            </div>
            <div className="ml-auto" />
            {canCreate && (
              <button
                onClick={() => setOpenId("new")}
                className="px-3 py-1.5 text-sm font-medium rounded bg-blue-500 text-white hover:bg-blue-600"
              >
                + 등록
              </button>
            )}
          </div>

          {/* 목록 */}
          {loading ? (
            <div className="text-sm text-gray-500 py-12 text-center">불러오는 중...</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-gray-500 py-16 text-center">
              {filter === "전체" ? "등록된 개선요청이 없습니다." : `${filter} 상태의 항목이 없습니다.`}
            </div>
          ) : (
            <ul className="space-y-2">
              {filtered.map(r => (
                <li
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm hover:shadow cursor-pointer transition"
                >
                  <div className="flex items-start gap-3">
                    <span className={`shrink-0 px-2 py-0.5 text-[11px] rounded font-semibold ${STATUS_STYLE[r.status]}`}>
                      {r.status}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">
                        {r.title}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-2 whitespace-pre-wrap">
                        {r.content}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1.5 flex items-center gap-2">
                        <span>{r.author?.username ?? "?"}</span>
                        <span>·</span>
                        <span>{fmtDate(r.created_at)}</span>
                        {r.response && <span className="ml-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-[9px]">답변</span>}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {openId === "new" && (
        <CreateModal onClose={() => setOpenId(null)} onCreated={() => { setOpenId(null); refresh(); }} userId={user?.id ?? null} />
      )}
      {openRow && (
        <DetailModal
          row={openRow}
          admin={admin}
          isAuthor={openRow.author_id === user?.id}
          currentUserId={user?.id ?? null}
          onClose={() => setOpenId(null)}
          onChanged={() => { setOpenId(null); refresh(); }}
        />
      )}
    </>
  );
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
        active
          ? "bg-blue-500 text-white border-blue-500"
          : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
      }`}
    >
      {label}
    </button>
  );
}

function ModalShell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
      >
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="font-bold text-gray-800 dark:text-gray-100">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function CreateModal({ onClose, onCreated, userId }: { onClose: () => void; onCreated: () => void; userId: number | null }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!userId) { alert("로그인이 필요합니다."); return; }
    const t = title.trim();
    const c = content.trim();
    if (!t || !c) { alert("제목과 내용을 입력하세요."); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("improvement_requests").insert({
        author_id: userId, title: t, content: c,
      });
      if (error) throw error;
      onCreated();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="개선요청 등록" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">제목</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={200}
          placeholder="간결한 제목을 입력하세요"
          className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        />
        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">내용</label>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={10}
          placeholder="개선이 필요한 부분과 기대 효과를 적어 주세요."
          className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-y"
        />
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">취소</button>
          <button onClick={submit} disabled={saving} className="px-3 py-1.5 text-sm font-medium rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
            {saving ? "저장 중..." : "등록"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function DetailModal({ row, admin, isAuthor, currentUserId, onClose, onChanged }:
  { row: Row; admin: boolean; isAuthor: boolean; currentUserId: number | null; onClose: () => void; onChanged: () => void }) {
  const canEdit = admin || isAuthor;

  const [editMode, setEditMode] = useState(false);
  const [title, setTitle] = useState(row.title);
  const [content, setContent] = useState(row.content);
  const [status, setStatus] = useState<Status>(row.status);
  const [response, setResponse] = useState(row.response ?? "");
  const [saving, setSaving] = useState(false);

  async function saveEdit() {
    if (!canEdit) return;
    setSaving(true);
    try {
      const patch: Partial<Row> = { title: title.trim(), content: content.trim() };
      const { error } = await supabase.from("improvement_requests").update(patch).eq("id", row.id);
      if (error) throw error;
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveAdminFields() {
    if (!admin) return;
    setSaving(true);
    try {
      const newResponse = response.trim() || null;
      const patch: Partial<Row> = { status, response: newResponse };
      const { error } = await supabase.from("improvement_requests").update(patch).eq("id", row.id);
      if (error) throw error;

      // 작성자에게 답변/상태변경 알림 (작성자 본인이 처리한 경우는 제외)
      const responseChanged = newResponse !== (row.response ?? null);
      const statusChanged = status !== row.status;
      if (row.author_id !== currentUserId && (responseChanged || statusChanged)) {
        await insertNotification({
          userId:  row.author_id,
          type:    "improvement_response",
          title:   responseChanged ? "개선요청에 답변이 등록되었습니다" : "개선요청 처리상태가 변경되었습니다",
          message: `[${status}] ${row.title}`,
          link:    "/board/improvements",
          refType: "improvement_request",
          refId:   row.id,
        }).catch(e => console.warn("[notify] 개선요청 알림 실패:", e));
      }

      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!canEdit) return;
    if (!confirm("이 개선요청을 삭제하시겠습니까?")) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("improvement_requests").delete().eq("id", row.id);
      if (error) throw error;
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="개선요청 상세" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <span className={`px-2 py-0.5 rounded font-semibold ${STATUS_STYLE[row.status]}`}>{row.status}</span>
          <span>{row.author?.username ?? "?"}</span>
          <span>·</span>
          <span>{fmtDate(row.created_at)}</span>
          {row.updated_at && row.updated_at !== row.created_at && (
            <span className="text-gray-400">(수정 {fmtDate(row.updated_at)})</span>
          )}
        </div>

        {!editMode ? (
          <>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{row.title}</h3>
            <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{row.content}</div>
          </>
        ) : (
          <div className="space-y-2">
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
              className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={10}
              className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-y" />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setEditMode(false); setTitle(row.title); setContent(row.content); }}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600">취소</button>
              <button onClick={saveEdit} disabled={saving}
                className="px-3 py-1.5 text-sm font-medium rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        )}

        {/* 관리자 응답 영역 */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
          <div className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">처리 결과 / 응답</div>
          {!admin ? (
            row.response ? (
              <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap p-3 rounded bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700">
                {row.response}
              </div>
            ) : (
              <div className="text-sm text-gray-400 italic">아직 응답이 없습니다.</div>
            )
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-600 dark:text-gray-400">상태</label>
                <select value={status} onChange={e => setStatus(e.target.value as Status)}
                  className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <textarea value={response} onChange={e => setResponse(e.target.value)} rows={4}
                placeholder="처리 결과나 의견을 작성하세요 (선택)"
                className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-y" />
              <div className="flex justify-end">
                <button onClick={saveAdminFields} disabled={saving}
                  className="px-3 py-1.5 text-sm font-medium rounded bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50">
                  {saving ? "저장 중..." : "상태·응답 저장"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 액션 */}
        {canEdit && !editMode && (
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <button onClick={() => setEditMode(true)}
              className="px-3 py-1.5 text-sm rounded border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30">
              수정
            </button>
            <button onClick={remove} disabled={saving}
              className="px-3 py-1.5 text-sm rounded border border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/30 disabled:opacity-50">
              삭제
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
