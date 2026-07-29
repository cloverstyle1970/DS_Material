"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";

// ============================================================
// 권한 트리 정의 (사이드바 메뉴 기준)
// 각 항목은 {href, label}; 권한 키는 menu:{href}:{op}
// op: read | create | update
// ------------------------------------------------------------
type PermOp = "read" | "create" | "update";
const PERM_OPS: PermOp[] = ["read", "create", "update"];

interface MenuItem {
  href: string;
  label: string;
  ops?: PermOp[]; // 기본: ["read","create","update"], 단순 조회 메뉴는 ["read"]만
}
interface MenuSection {
  id: string;
  label: string;
  color: string; // text-color tailwind class
  items: MenuItem[];
}

const PERMISSION_TREE: MenuSection[] = [
  {
    id: "data", label: "데이터관리", color: "text-sky-500",
    items: [
      { href: "/data/users",            label: "사원 관리" },
      { href: "/data/profile",          label: "개인정보수정", ops: ["read","update"] },
      { href: "/data/company-info",     label: "회사 정보 관리" },
      { href: "/data/permission-groups",label: "사용자권한그룹" },
      { href: "/manual",                label: "도움말 매뉴얼 관리", ops: ["update"] },
    ],
  },
  {
    id: "site", label: "현장관리", color: "text-emerald-500",
    items: [
      { href: "/site/units",     label: "현장/호기 관리" },
      { href: "/data/vendors",   label: "거래처 관리" },
    ],
  },
  {
    id: "quotes", label: "견적관리", color: "text-yellow-500",
    items: [
      { href: "/quotes",             label: "견적서 목록", ops: ["read"] },
      { href: "/quotes/new",         label: "견적서 작성", ops: ["read","create"] },
      { href: "/quotes/labor-rates", label: "공정별 공수표" },
      { href: "/quotes/settings",    label: "견적 기본 설정" },
      { href: "/quotes/legacy",      label: "구 견적조회" },
    ],
  },
  {
    id: "material", label: "자재관리", color: "text-amber-500",
    items: [
      { href: "/claim/new",            label: "견적 및 자재청구 등록" },
      { href: "/claim/quote-requests", label: "견적요청 목록" },
      { href: "/material",         label: "자재품목 관리" },
      { href: "/requests",         label: "자재 신청 관리" },
      { href: "/purchase-orders",  label: "발주 관리" },
      { href: "/inbound",          label: "입고 관리" },
      { href: "/outbound",         label: "출고 관리" },
      { href: "/returns",          label: "회수/반납 관리" },
      { href: "/serial-history",   label: "S/N 이력 추적", ops: ["read"] },
      { href: "/stats/period",     label: "기간별 입출고 내역", ops: ["read"] },
      { href: "/stats/sites",      label: "현장/호기별 현황", ops: ["read"] },
      { href: "/stats/performance", label: "사원 실적 (매출)", ops: ["read"] },
      { href: "/inventory-check",  label: "재고실사" },
    ],
  },
  {
    id: "safety", label: "산업안전", color: "text-rose-500",
    items: [
      { href: "/safety/tbm",           label: "TBM등록" },
      { href: "/safety/tbm/admin",     label: "TBM 관리" },
      { href: "/safety/tbm/master",    label: "TBM 마스터" },
      { href: "/safety/work-journal",  label: "작업일지" },
      { href: "/safety/work-journal-register", label: "작업일지대장" },
      { href: "/safety/hazard-survey", label: "유해요인조사표 등록" },
      { href: "/safety/hazard-register", label: "유해요인조사대장" },
      { href: "/safety/hazard-master", label: "유해요인조사 마스터" },
      { href: "/safety/risk-assessment", label: "위험성평가 등록" },
      { href: "/safety/risk-register",   label: "위험성평가대장" },
      { href: "/uniform-safety",       label: "근무복·안전장구 신청" },
      { href: "/uniform-safety/admin", label: "근무복·안전장구 관리" },
    ],
  },
  {
    id: "construction", label: "공사일정", color: "text-orange-500",
    items: [
      { href: "/construction/schedule", label: "일정 캘린더" },
      { href: "/construction/requests", label: "공사 요청" },
    ],
  },
  {
    id: "hr", label: "관리/인사", color: "text-purple-500",
    items: [
      { href: "/hr/company-vehicles",   label: "회사차량관리" },
      { href: "/hr/employee-register",  label: "사원등록" },
      { href: "/hr/dept-rank",          label: "부서/직급관리" },
      { href: "/hr/team-crew",          label: "팀구성 관리" },
      { href: "/hr/transfer",           label: "인사 이동" },
      { href: "/hr/employment-status",  label: "재직상태 관리" },
    ],
  },
  {
    id: "accounting", label: "회계/세무", color: "text-indigo-500",
    items: [
      { href: "/payroll/payslip", label: "급여명세표" },
      { href: "/accounting/sales-invoices", label: "계산서 발행내역" },
      { href: "/accounting/incentive", label: "인센티브 관리" },
    ],
  },
  {
    id: "board", label: "게시판", color: "text-teal-500",
    items: [
      { href: "/board/improvements", label: "개선요청" },
    ],
  },
];

const ALL_PERM_KEYS: string[] = (() => {
  const out: string[] = ["admin"];
  PERMISSION_TREE.forEach(sec =>
    sec.items.forEach(item => {
      const ops = item.ops ?? PERM_OPS;
      ops.forEach(op => out.push(`menu:${item.href}:${op}`));
    })
  );
  return out;
})();

const COLOR_OPTIONS: { key: string; label: string; bg: string; text: string; border: string }[] = [
  { key: "slate",   label: "슬레이트", bg: "bg-slate-100",   text: "text-slate-700",   border: "border-slate-300" },
  { key: "sky",     label: "하늘",    bg: "bg-sky-100",     text: "text-sky-700",     border: "border-sky-300" },
  { key: "blue",    label: "파랑",    bg: "bg-blue-100",    text: "text-blue-700",    border: "border-blue-300" },
  { key: "emerald", label: "에메랄드", bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-300" },
  { key: "green",   label: "초록",    bg: "bg-green-100",   text: "text-green-700",   border: "border-green-300" },
  { key: "amber",   label: "앰버",    bg: "bg-amber-100",   text: "text-amber-700",   border: "border-amber-300" },
  { key: "orange",  label: "오렌지",  bg: "bg-orange-100",  text: "text-orange-700",  border: "border-orange-300" },
  { key: "rose",    label: "장미",    bg: "bg-rose-100",    text: "text-rose-700",    border: "border-rose-300" },
  { key: "purple",  label: "보라",    bg: "bg-purple-100",  text: "text-purple-700",  border: "border-purple-300" },
];

function colorCls(c: string) {
  const o = COLOR_OPTIONS.find(x => x.key === c) ?? COLOR_OPTIONS[0];
  return `${o.bg} ${o.text} ${o.border}`;
}

interface Group {
  id: number;
  name: string;
  description: string | null;
  color: string;
  sort_order: number;
  is_system_role: boolean;
  permissions: string[];
}

interface UserRow {
  id: number;
  name: string;
  dept: string | null;
  rank: string | null;
  status: string | null;
  permission_group_id: number | null;
  permissions: string[] | null;
}

export default function PermissionGroupsClient() {
  const { user } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Group | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 사용자 추가 검색
  const [userSearch, setUserSearch] = useState("");

  // 멤버 목록 페이지네이션
  const MEMBER_PAGE_SIZE = 10;
  const [memberPage, setMemberPage] = useState(1);

  // 세부권한 모달
  const [detailUser, setDetailUser] = useState<UserRow | null>(null);
  const [detailPerms, setDetailPerms] = useState<string[]>([]);

  // 아코디언 펼침 상태 (섹션 id 집합) — 기본: 첫 번째 섹션만 펼침
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set([PERMISSION_TREE[0].id]));
  function toggleSection(id: string) {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function expandAll() { setExpandedSections(new Set(PERMISSION_TREE.map(s => s.id))); }
  function collapseAll() { setExpandedSections(new Set()); }

  async function reload() {
    // groups는 단일 쿼리
    const gRes = supabase.from("permission_groups").select("*").order("sort_order");
    // accounts는 Supabase 기본 1000건 limit이 걸려 일부 사용자가 누락될 수 있어 페이지네이션.
    // 누락되면 멤버 목록에도, syncMembers 적용 대상에도 빠져 권한이 안 반영됨.
    async function loadAllAccounts(): Promise<UserRow[]> {
      const PAGE = 1000;
      const all: UserRow[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase.from("accounts")
          .select("id, name:username, dept, rank, status, permission_group_id, permissions")
          .eq("status", "재직")
          .order("username")
          .range(offset, offset + PAGE - 1);
        if (error) break;
        const rows = (data ?? []) as UserRow[];
        all.push(...rows);
        if (rows.length < PAGE) break;
      }
      return all;
    }
    const [g, allUsers] = await Promise.all([gRes, loadAllAccounts()]);
    setGroups((g.data ?? []) as Group[]);
    setUsers(allUsers);
    setLoaded(true);
  }

  useEffect(() => { if (hasMenuPermission(user, "/data/permission-groups", "read")) void reload(); }, [user]);
  useReloadOnActivate(() => { if (hasMenuPermission(user, "/data/permission-groups", "read")) void reload(); });

  useEffect(() => {
    if (selectedId == null && groups.length > 0) setSelectedId(groups[0].id);
  }, [groups, selectedId]);

  useEffect(() => {
    const g = groups.find(x => x.id === selectedId);
    setEditing(g ? { ...g, permissions: [...g.permissions] } : null);
    setMemberPage(1);
  }, [selectedId, groups]);

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  if (!hasMenuPermission(user, "/data/permission-groups", "read")) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
      </div>
    );
  }
  if (!loaded) return <div className="p-12 text-center text-sm text-gray-500">로딩 중...</div>;

  const canWrite = hasMenuPermission(user, "/data/permission-groups", "create") || hasMenuPermission(user, "/data/permission-groups", "update");

  const members = users
    .filter(u => u.permission_group_id === selectedId)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const memberTotalPages = Math.max(1, Math.ceil(members.length / MEMBER_PAGE_SIZE));
  const memberPageSafe = Math.min(memberPage, memberTotalPages);
  const membersOnPage = members.slice((memberPageSafe - 1) * MEMBER_PAGE_SIZE, memberPageSafe * MEMBER_PAGE_SIZE);

  // 그룹 미지정 사용자만 추가 후보 (단일 그룹 정책 — 이미 다른 그룹에 속한 사용자는 해당 그룹에서 먼저 제거)
  const nonMembers = users
    .filter(u =>
      u.permission_group_id == null &&
      (userSearch.trim() === "" || u.name.includes(userSearch.trim()) || (u.dept ?? "").includes(userSearch.trim()))
    )
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const isAdminAll = editing?.permissions.includes("admin") ?? false;
  const editingPermSet = new Set(editing?.permissions ?? []);

  function togglePerm(key: string) {
    if (!editing) return;
    setEditing(e => {
      if (!e) return e;
      const has = e.permissions.includes(key);
      return { ...e, permissions: has ? e.permissions.filter(p => p !== key) : [...e.permissions, key] };
    });
  }

  function toggleAdminAll(on: boolean) {
    if (!editing) return;
    setEditing(e => e ? { ...e, permissions: on ? ["admin"] : [] } : e);
  }

  function toggleAllInSection(sec: MenuSection, on: boolean) {
    if (!editing) return;
    const sectionKeys = sec.items.flatMap(it => (it.ops ?? PERM_OPS).map(op => `menu:${it.href}:${op}`));
    setEditing(e => {
      if (!e) return e;
      const set = new Set(e.permissions);
      sectionKeys.forEach(k => on ? set.add(k) : set.delete(k));
      return { ...e, permissions: Array.from(set) };
    });
  }

  async function saveGroup() {
    if (!editing) return;
    setSaving(true); setMessage(null);
    try {
      const { error } = await supabase
        .from("permission_groups")
        .update({
          name: editing.name.trim(),
          description: editing.description?.trim() || null,
          color: editing.color,
          sort_order: editing.sort_order,
          permissions: editing.permissions,
        })
        .eq("id", editing.id);
      if (error) throw error;
      setMessage({ type: "success", text: `그룹 [${editing.name}] 저장 완료` });
      await reload();
    } catch (err) {
      setMessage({ type: "error", text: `저장 실패: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  }

  async function syncMembers() {
    if (!editing || members.length === 0) return;
    // 그룹에 미저장 변경이 있으면 sync 전에 함께 저장 (그러지 않으면 reload 후 체크박스가 풀려 보임)
    const savedGroup = groups.find(g => g.id === editing.id);
    const dirty = !savedGroup || savedGroup.permissions.length !== editing.permissions.length ||
      editing.permissions.some(p => !savedGroup.permissions.includes(p));
    const msg = dirty
      ? `그룹 [${editing.name}] 의 현재 편집 중인 권한 ${editing.permissions.length}개를\n① 그룹에 저장 + ② 멤버 ${members.length}명 모두에게 적용합니다.\n각 사용자의 기존 세부권한은 덮어쓰기 됩니다. 계속할까요?`
      : `그룹 [${editing.name}] 의 권한 ${editing.permissions.length}개를 멤버 ${members.length}명 모두에게 적용합니다.\n각 사용자의 기존 세부권한은 덮어쓰기 됩니다. 계속할까요?`;
    if (!confirm(msg)) return;
    setSaving(true); setMessage(null);
    try {
      if (dirty) {
        const { error: gErr } = await supabase
          .from("permission_groups")
          .update({
            name: editing.name.trim(),
            description: editing.description?.trim() || null,
            color: editing.color,
            sort_order: editing.sort_order,
            permissions: editing.permissions,
          })
          .eq("id", editing.id);
        if (gErr) throw gErr;
      }
      const ids = members.map(m => m.id);
      const { error } = await supabase
        .from("accounts")
        .update({ permissions: editing.permissions })
        .in("id", ids);
      if (error) throw error;
      setMessage({ type: "success", text: `${members.length}명에게 그룹 권한 적용 완료${dirty ? " (그룹도 저장됨)" : ""}` });
      await reload();
    } catch (err) {
      setMessage({ type: "error", text: `적용 실패: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  }

  async function addGroup() {
    const name = prompt("새 그룹 이름:");
    if (!name?.trim()) return;
    const { data, error } = await supabase
      .from("permission_groups")
      .insert({ name: name.trim(), color: "slate", sort_order: (groups[groups.length-1]?.sort_order ?? 0) + 10, permissions: [] })
      .select("id").single();
    if (error) { alert("추가 실패: " + error.message); return; }
    await reload();
    if (data?.id) setSelectedId(data.id as number);
  }

  async function deleteGroup() {
    if (!editing) return;
    if (editing.is_system_role) { alert("시스템 그룹은 삭제할 수 없습니다."); return; }
    if (members.length > 0) { alert(`그룹에 멤버가 ${members.length}명 있습니다. 먼저 멤버를 다른 그룹으로 이동하거나 제거하세요.`); return; }
    if (!confirm(`그룹 [${editing.name}] 을 삭제할까요?`)) return;
    const { error } = await supabase.from("permission_groups").delete().eq("id", editing.id);
    if (error) { alert("삭제 실패: " + error.message); return; }
    setSelectedId(null);
    await reload();
  }

  async function assignUser(uId: number, gid: number | null, applyGroupPerms: boolean) {
    const target = users.find(u => u.id === uId);
    if (!target) return;
    const update: { permission_group_id: number | null; permissions?: string[] } = { permission_group_id: gid };
    if (applyGroupPerms) {
      const g = groups.find(x => x.id === gid);
      update.permissions = g ? g.permissions : [];
    }
    const { error } = await supabase.from("accounts").update(update).eq("id", uId);
    if (error) { alert("어사인 실패: " + error.message); return; }
    await reload();
  }

  function openDetail(u: UserRow) {
    setDetailUser(u);
    setDetailPerms(u.permissions ?? []);
  }

  async function saveDetail() {
    if (!detailUser) return;
    const { error } = await supabase
      .from("accounts")
      .update({ permissions: detailPerms })
      .eq("id", detailUser.id);
    if (error) { alert("저장 실패: " + error.message); return; }
    setDetailUser(null);
    await reload();
    setMessage({ type: "success", text: `${detailUser.name}님 세부 권한 저장 완료` });
  }

  function toggleDetailPerm(key: string) {
    setDetailPerms(prev => prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]);
  }
  function toggleDetailAll(sec: MenuSection, on: boolean) {
    const keys = sec.items.flatMap(it => (it.ops ?? PERM_OPS).map(op => `menu:${it.href}:${op}`));
    setDetailPerms(prev => {
      const set = new Set(prev);
      keys.forEach(k => on ? set.add(k) : set.delete(k));
      return Array.from(set);
    });
  }

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">사용자권한그룹</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">권한 그룹을 생성하고 사용자에게 그룹·세부권한을 지정합니다 (관리자 전용)</p>
      </div>

      {message && (
        <div className={`mx-6 mt-4 px-4 py-3 rounded-lg text-sm ${
          message.type === "success"
            ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700"
            : "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700"
        }`}>{message.text}</div>
      )}

      <div className="p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* 좌: 그룹 목록 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">그룹 ({groups.length})</h2>
            {canWrite && (
              <button type="button" onClick={addGroup}
                className="px-2 py-1 rounded bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">+ 추가</button>
            )}
          </div>
          <div className="space-y-1">
            {groups.map(g => {
              const memCnt = users.filter(u => u.permission_group_id === g.id).length;
              const active = g.id === selectedId;
              // 편집 중인 그룹은 저장 전 local 상태(editing.permissions)를 노출
              const livePerms = editing && editing.id === g.id ? editing.permissions : g.permissions;
              const isDirty = editing && editing.id === g.id && (
                editing.permissions.length !== g.permissions.length ||
                editing.permissions.some(p => !g.permissions.includes(p))
              );
              return (
                <button key={g.id} type="button" onClick={() => setSelectedId(g.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                    active
                      ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20"
                      : "border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/30"
                  }`}>
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border ${colorCls(g.color)}`}>
                      {g.name}
                    </span>
                    <div className="flex items-center gap-1">
                      {isDirty && <span title="저장되지 않은 변경" className="text-[10px] font-bold text-amber-600 dark:text-amber-400">●</span>}
                      {g.is_system_role && <span className="text-[10px] font-bold text-rose-500">SYS</span>}
                    </div>
                  </div>
                  <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                    👤 {memCnt}명 · 🔑 {livePerms.includes("admin") ? "전체(admin)" : `${livePerms.length}개`}
                    {isDirty && <span className="ml-1 text-amber-600 dark:text-amber-400">(미저장)</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 우: 그룹 상세 */}
        {editing && (
          <div className="space-y-4">
            {/* 그룹 정보 + 액션 */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_120px_auto] gap-3 items-end">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">그룹명</label>
                  <input type="text" value={editing.name}
                    onChange={e => setEditing(p => p ? { ...p, name: e.target.value } : p)}
                    disabled={editing.is_system_role}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 disabled:bg-gray-100 dark:disabled:bg-gray-900/40 disabled:cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">색상</label>
                  <select value={editing.color}
                    onChange={e => setEditing(p => p ? { ...p, color: e.target.value } : p)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100">
                    {COLOR_OPTIONS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">정렬</label>
                  <input type="number" value={editing.sort_order}
                    onChange={e => setEditing(p => p ? { ...p, sort_order: Number(e.target.value) || 0 } : p)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 font-mono" />
                </div>
                <div className="flex gap-2 justify-end">
                  {canWrite && (
                    <button type="button" onClick={saveGroup} disabled={saving}
                      className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50">
                      💾 저장
                    </button>
                  )}
                  {canWrite && !editing.is_system_role && (
                    <button type="button" onClick={deleteGroup}
                      className="px-3 py-2 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600">
                      삭제
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">설명</label>
                <input type="text" value={editing.description ?? ""}
                  onChange={e => setEditing(p => p ? { ...p, description: e.target.value } : p)}
                  placeholder="그룹 설명 (예: 보수팀 일반 사원용)"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
              </div>
            </div>

            {/* 권한 트리 (아코디언) */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">사용 권한</h2>
                <div className="flex items-center gap-3">
                  {!isAdminAll && (
                    <div className="flex items-center gap-1 text-[11px]">
                      <button type="button" onClick={expandAll}
                        className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200">
                        ▾ 전체 펼치기
                      </button>
                      <button type="button" onClick={collapseAll}
                        className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200">
                        ▸ 전체 접기
                      </button>
                    </div>
                  )}
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={isAdminAll} disabled={!canWrite}
                      onChange={e => toggleAdminAll(e.target.checked)} className="rounded disabled:opacity-50" />
                    <span className="text-xs font-semibold text-rose-600 dark:text-rose-300">⚡ 전체 권한 (admin)</span>
                  </label>
                </div>
              </div>

              {isAdminAll ? (
                <div className="text-xs text-gray-500 dark:text-gray-400 italic px-2 py-3">
                  전체 권한이 부여되어 모든 메뉴/기능에 접근할 수 있습니다.
                </div>
              ) : (
                <div className="space-y-2">
                  {PERMISSION_TREE.map(sec => {
                    const sectionKeys = sec.items.flatMap(it => (it.ops ?? PERM_OPS).map(op => `menu:${it.href}:${op}`));
                    const allOn = sectionKeys.every(k => editingPermSet.has(k));
                    const someOn = sectionKeys.some(k => editingPermSet.has(k));
                    const enabledCount = sectionKeys.filter(k => editingPermSet.has(k)).length;
                    const isOpen = expandedSections.has(sec.id);
                    return (
                      <div key={sec.id} className="rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
                        <button type="button" onClick={() => toggleSection(sec.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/40 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors text-left ${sec.color}`}>
                          <span className={`text-xs transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}>▸</span>
                          <span className="text-xs font-bold flex-1">{sec.label}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                            enabledCount === 0
                              ? "bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-400"
                              : enabledCount === sectionKeys.length
                                ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                                : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                          }`}>
                            {enabledCount} / {sectionKeys.length}
                          </span>
                          <label onClick={e => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] text-gray-600 dark:text-gray-300 ml-1">
                            <input type="checkbox" checked={allOn} disabled={!canWrite}
                              ref={el => { if (el) el.indeterminate = !allOn && someOn; }}
                              onChange={e => toggleAllInSection(sec, e.target.checked)} className="rounded disabled:opacity-50" />
                            전체
                          </label>
                        </button>
                        {isOpen && (
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50 dark:bg-gray-700/20">
                              <tr className="text-[10px] text-gray-500 dark:text-gray-400">
                                <th className="text-left px-3 py-1.5">메뉴</th>
                                <th className="px-2 py-1.5 w-16">조회</th>
                                <th className="px-2 py-1.5 w-16">생성</th>
                                <th className="px-2 py-1.5 w-16">수정</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sec.items.map(item => {
                                const ops = item.ops ?? PERM_OPS;
                                return (
                                  <tr key={item.href} className="border-t border-gray-100 dark:border-gray-700/50">
                                    <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{item.label}<div className="text-[10px] text-gray-400 font-mono">{item.href}</div></td>
                                    {(["read","create","update"] as PermOp[]).map(op => {
                                      const key = `menu:${item.href}:${op}`;
                                      const allowed = ops.includes(op);
                                      return (
                                        <td key={op} className="text-center px-2 py-2">
                                          {allowed ? (
                                            <input type="checkbox" checked={editingPermSet.has(key)} disabled={!canWrite}
                                              onChange={() => togglePerm(key)} className="rounded disabled:opacity-50" />
                                          ) : (
                                            <span className="text-gray-300 dark:text-gray-600">—</span>
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
                선택된 권한: <span className="font-mono font-bold">{editing.permissions.length}</span>개
                {!isAdminAll && ` / ${ALL_PERM_KEYS.length - 1}개`}
              </div>
            </div>

            {/* 멤버 목록 */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">멤버 ({members.length}명)</h2>
                {canWrite && (
                  <button type="button" onClick={syncMembers} disabled={members.length === 0 || saving}
                    className="px-3 py-1.5 rounded bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 disabled:opacity-50">
                    ↻ 그룹 권한을 멤버 전체에 적용
                  </button>
                )}
              </div>
              {members.length === 0 ? (
                <div className="text-center py-4 text-xs text-gray-400">이 그룹에 속한 사용자가 없습니다.</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[10px] text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left px-2 py-1.5">사번</th>
                          <th className="text-left px-2 py-1.5">성명</th>
                          <th className="text-left px-2 py-1.5">부서</th>
                          <th className="text-left px-2 py-1.5">직급</th>
                          <th className="text-left px-2 py-1.5">개별 권한</th>
                          <th className="text-right px-2 py-1.5">작업</th>
                        </tr>
                      </thead>
                      <tbody>
                        {membersOnPage.map(m => {
                          const userPerms = m.permissions ?? [];
                          const matched = editing.permissions.length > 0 &&
                            userPerms.length === editing.permissions.length &&
                            editing.permissions.every(p => userPerms.includes(p));
                          return (
                            <tr key={m.id} className="border-b border-gray-100 dark:border-gray-700/50">
                              <td className="px-2 py-2 font-mono text-gray-500">{m.id}</td>
                              <td className="px-2 py-2 font-semibold text-gray-700 dark:text-gray-200">{m.name}</td>
                              <td className="px-2 py-2 text-gray-600 dark:text-gray-300">{m.dept ?? "—"}</td>
                              <td className="px-2 py-2 text-gray-600 dark:text-gray-300">{m.rank ?? "—"}</td>
                              <td className="px-2 py-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  matched
                                    ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                                    : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                                }`}>
                                  {matched ? "그룹과 동일" : `세부 (${userPerms.length}개)`}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-right whitespace-nowrap">
                                {canWrite ? (
                                  <>
                                    <button type="button" onClick={() => openDetail(m)}
                                      className="text-blue-600 hover:underline mr-3">세부권한</button>
                                    <button type="button" onClick={() => assignUser(m.id, null, false)}
                                      className="text-red-500 hover:underline">제거</button>
                                  </>
                                ) : (
                                  <span className="text-gray-300 dark:text-gray-600">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* 페이지네이션 */}
                  {memberTotalPages > 1 && (
                    <div className="mt-3 flex items-center justify-between text-xs">
                      <div className="text-gray-500 dark:text-gray-400">
                        {(memberPageSafe - 1) * MEMBER_PAGE_SIZE + 1}–{Math.min(memberPageSafe * MEMBER_PAGE_SIZE, members.length)}
                        <span className="mx-1">/</span>
                        {members.length}명 <span className="text-[10px] text-gray-400">(가나다 순)</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setMemberPage(1)} disabled={memberPageSafe === 1}
                          className="px-2 py-1 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700">«</button>
                        <button type="button" onClick={() => setMemberPage(p => Math.max(1, p - 1))} disabled={memberPageSafe === 1}
                          className="px-2 py-1 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700">‹</button>
                        {Array.from({ length: memberTotalPages }, (_, i) => i + 1)
                          .filter(p => Math.abs(p - memberPageSafe) <= 2 || p === 1 || p === memberTotalPages)
                          .map((p, idx, arr) => (
                            <span key={p} className="flex items-center">
                              {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-gray-400">…</span>}
                              <button type="button" onClick={() => setMemberPage(p)}
                                className={`min-w-[28px] px-2 py-1 rounded border transition-colors ${
                                  p === memberPageSafe
                                    ? "border-blue-500 bg-blue-600 text-white font-bold"
                                    : "border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                                }`}>{p}</button>
                            </span>
                          ))}
                        <button type="button" onClick={() => setMemberPage(p => Math.min(memberTotalPages, p + 1))} disabled={memberPageSafe === memberTotalPages}
                          className="px-2 py-1 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700">›</button>
                        <button type="button" onClick={() => setMemberPage(memberTotalPages)} disabled={memberPageSafe === memberTotalPages}
                          className="px-2 py-1 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700">»</button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* 멤버 추가 */}
              {canWrite && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300">멤버 추가</h3>
                  <span className="text-[10px] text-gray-400">미지정 사용자 {nonMembers.length}명 · 가나다 순</span>
                  <input type="text" value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    placeholder="이름·부서 검색"
                    className="flex-1 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-gray-900 dark:text-gray-100" />
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">
                  ℹ️ 사용자는 하나의 그룹에만 속할 수 있습니다. 이미 다른 그룹에 속한 사용자는 해당 그룹에서 먼저 제거하세요.
                </p>
                <div className="max-h-48 overflow-y-auto rounded border border-gray-200 dark:border-gray-700">
                  {nonMembers.length === 0 ? (
                    <div className="text-center py-3 text-xs text-gray-400">
                      {userSearch ? "검색 조건에 맞는 미지정 사용자가 없습니다." : "그룹 미지정 사용자가 없습니다."}
                    </div>
                  ) : (
                    nonMembers.slice(0, 30).map(u => (
                      <div key={u.id} className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                        <div>
                          <span className="font-semibold text-gray-700 dark:text-gray-200">{u.name}</span>
                          <span className="ml-2 text-gray-500 dark:text-gray-400">{u.dept ?? "—"} · {u.rank ?? "—"}</span>
                        </div>
                        <div className="flex gap-1">
                          <button type="button" onClick={() => assignUser(u.id, editing.id, true)}
                            className="px-2 py-1 rounded bg-blue-600 text-white text-[10px] font-semibold hover:bg-blue-700">
                            그룹 권한으로 추가
                          </button>
                          <button type="button" onClick={() => assignUser(u.id, editing.id, false)}
                            className="px-2 py-1 rounded bg-slate-500 text-white text-[10px] font-semibold hover:bg-slate-600">
                            그룹만 (권한 유지)
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  {nonMembers.length > 30 && (
                    <div className="text-center py-2 text-[10px] text-gray-400">
                      ...상위 30명만 표시. 검색어로 좁혀주세요.
                    </div>
                  )}
                </div>
              </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 세부권한 모달 */}
      {detailUser && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDetailUser(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">{detailUser.name} — 세부 권한</h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{detailUser.dept ?? "—"} · {detailUser.rank ?? "—"}</p>
              </div>
              <button type="button" onClick={() => setDetailUser(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={detailPerms.includes("admin")}
                  onChange={e => setDetailPerms(e.target.checked ? ["admin"] : [])} className="rounded" />
                <span className="text-xs font-semibold text-rose-600 dark:text-rose-300">⚡ 전체 권한 (admin)</span>
              </label>
              {!detailPerms.includes("admin") && (
                <>
                  <div className="flex items-center gap-1 text-[11px] mb-2">
                    <button type="button" onClick={expandAll}
                      className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200">
                      ▾ 전체 펼치기
                    </button>
                    <button type="button" onClick={collapseAll}
                      className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200">
                      ▸ 전체 접기
                    </button>
                  </div>
                  <div className="space-y-2">
                    {PERMISSION_TREE.map(sec => {
                      const sectionKeys = sec.items.flatMap(it => (it.ops ?? PERM_OPS).map(op => `menu:${it.href}:${op}`));
                      const allOn = sectionKeys.every(k => detailPerms.includes(k));
                      const someOn = sectionKeys.some(k => detailPerms.includes(k));
                      const enabledCount = sectionKeys.filter(k => detailPerms.includes(k)).length;
                      const isOpen = expandedSections.has(sec.id);
                      return (
                        <div key={sec.id} className="rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
                          <button type="button" onClick={() => toggleSection(sec.id)}
                            className={`w-full flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/40 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors text-left ${sec.color}`}>
                            <span className={`text-xs transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}>▸</span>
                            <span className="text-xs font-bold flex-1">{sec.label}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                              enabledCount === 0
                                ? "bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-400"
                                : enabledCount === sectionKeys.length
                                  ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                                  : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                            }`}>
                              {enabledCount} / {sectionKeys.length}
                            </span>
                            <label onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] text-gray-600 dark:text-gray-300 ml-1">
                              <input type="checkbox" checked={allOn}
                                ref={el => { if (el) el.indeterminate = !allOn && someOn; }}
                                onChange={e => toggleDetailAll(sec, e.target.checked)} className="rounded" />
                              전체
                            </label>
                          </button>
                          {isOpen && (
                            <table className="w-full text-xs">
                              <thead className="bg-gray-50 dark:bg-gray-700/20">
                                <tr className="text-[10px] text-gray-500 dark:text-gray-400">
                                  <th className="text-left px-3 py-1.5">메뉴</th>
                                  <th className="px-2 py-1.5 w-16">조회</th>
                                  <th className="px-2 py-1.5 w-16">생성</th>
                                  <th className="px-2 py-1.5 w-16">수정</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sec.items.map(item => {
                                  const ops = item.ops ?? PERM_OPS;
                                  return (
                                    <tr key={item.href} className="border-t border-gray-100 dark:border-gray-700/50">
                                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{item.label}</td>
                                      {(["read","create","update"] as PermOp[]).map(op => {
                                        const key = `menu:${item.href}:${op}`;
                                        const allowed = ops.includes(op);
                                        return (
                                          <td key={op} className="text-center px-2 py-2">
                                            {allowed ? (
                                              <input type="checkbox" checked={detailPerms.includes(key)}
                                                onChange={() => toggleDetailPerm(key)} className="rounded" />
                                            ) : (
                                              <span className="text-gray-300 dark:text-gray-600">—</span>
                                            )}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button type="button" onClick={() => setDetailUser(null)}
                className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold">
                취소
              </button>
              <button type="button" onClick={saveDetail}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700">
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
