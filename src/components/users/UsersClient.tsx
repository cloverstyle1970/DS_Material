"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { UserRecord, Permission } from "@/lib/mock-users";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useViewMode } from "@/context/ViewModeContext";
import { useTabs, MAX_TABS } from "@/context/TabsContext";
import { api, getErrorMessage } from "@/lib/api-client";
import { fmtNum } from "@/lib/format";
import { daysUntilExpiry, isExpiryAlert, EXPIRY_WARN_DAYS } from "@/lib/cert-expiry";
import { useAutoPageSize } from "@/lib/useAutoPageSize";
import DraggableModal from "@/components/common/DraggableModal";
import PermissionsModal from "./PermissionsModal";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

export const ADMIN_EDIT_USER_KEY = "ds_admin_edit_user_id";

type SortKey = "id" | "name" | "dept" | "rank" | "cert" | "hireDate" | "phone" | "status";
type SortDir = "asc" | "desc";
type StatusFilter = "전체" | "재직" | "퇴직" | "휴직";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "id",       label: "번호"     },
  { key: "name",     label: "이름"     },
  { key: "dept",     label: "부서"     },
  { key: "rank",     label: "직급"     },
  { key: "cert",     label: "자격증"   },
  { key: "hireDate", label: "입사일"   },
  { key: "phone",    label: "전화번호" },
  { key: "status",   label: "상태"     },
];

const STATUS_CLS: Record<string, string> = {
  "재직": "bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  "퇴직": "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300",
  "휴직": "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

const PERMISSION_OPTIONS: { value: Permission; label: string; desc: string; color: string }[] = [
  { value: "admin",       label: "시스템 관리자", desc: "모든 기능 접근",        color: "bg-red-50 text-red-600 dark:bg-red-900/40 dark:text-red-300"    },
  { value: "site_manage", label: "현장 관리",     desc: "현장 등록·수정 가능",   color: "bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300"  },
  { value: "view_only",   label: "조회 전용",     desc: "읽기만 가능",           color: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300" },
];

function PermBadge({ perms }: { perms: string[] }) {
  if (perms.includes("admin")) return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-50 text-red-600 dark:bg-red-900/40 dark:text-red-300">시스템 관리자</span>;
  const menuPerms = perms.filter(p => p.startsWith("menu:"));
  const viewOnly = perms.includes("view_only");
  const siteManage = perms.includes("site_manage");
  return (
    <>
      {siteManage && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">현장 관리</span>}
      {viewOnly && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300">조회 전용</span>}
      {menuPerms.length > 0 && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300">상세 권한 {menuPerms.length}개</span>}
    </>
  );
}

function SelfCheckBadge() {
  return (
    <span title="자체점검 자격 보유"
      className="inline-flex items-center align-middle text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300 whitespace-nowrap">
      🛡️ 자체점검
    </span>
  );
}

function ExpiryBadge({ daysLeft, certName }: { daysLeft: number; certName?: string }) {
  const expired = daysLeft < 0;
  return (
    <span title={`${certName ? certName + " · " : ""}${expired ? "자격 만료됨" : `자격 만료 ${daysLeft}일 전`}`}
      className={`inline-flex items-center align-middle text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${
        expired
          ? "bg-red-50 text-red-600 dark:bg-red-900/40 dark:text-red-300"
          : "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      }`}>
      {expired ? "☠️ 만료" : `⚠️ D-${daysLeft}`}
    </span>
  );
}

function maskSsn(ssn: string | null): string {
  if (!ssn) return "-";
  const s = String(ssn);
  if (s.length >= 7) return s.slice(0, 6) + "-" + s[6] + "******";
  return s;
}

// 엑셀 추출 컬럼 — 비밀번호(password/password_hash)는 의도적으로 제외해 아예 받아오지 않음
const ACCOUNT_EXPORT_COLS =
  "id, username, role, site_name, created_at, name, phone, position, team, unit, " +
  "\"group\", dept, rank, ssn, cert, hire_date, resign_date, status, address, permissions, " +
  "theme, photo_url, emergency_contact, postal_code, uniform_top_size, uniform_bottom_size, " +
  "safety_shoes_size, email, gender, blood_type, permission_group_id, crew_id, " +
  "notifications_enabled, push_enabled";

/** accounts 테이블을 엑셀로 다운로드 (비밀번호 컬럼은 조회 자체에서 제외) */
async function downloadAccountsExcel() {
  const PAGE = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("accounts")
      .select(ACCOUNT_EXPORT_COLS)
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  if (all.length === 0) {
    alert("accounts 테이블에 데이터가 없습니다.");
    return;
  }
  const ws = XLSX.utils.json_to_sheet(all);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "accounts");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `accounts_전체_${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function UsersClient({ initial }: { initial: UserRecord[] }) {
  const PAGE_SIZE = useAutoPageSize();
  const [users, setUsers]           = useState(initial);
  const [query, setQuery]           = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("재직");
  const [page, setPage]             = useState(1);
  const [selected, setSelected]     = useState<UserRecord | null>(null);
  const [editPerms, setEditPerms]   = useState<UserRecord | null>(null);
  const [sortKey, setSortKey]       = useState<SortKey>("id");
  const [sortDir, setSortDir]       = useState<SortDir>("asc");
  // 자체점검 자격 보유자(user_certifications.self_check=true) accounts.id 집합
  const [selfCheckIds, setSelfCheckIds] = useState<Set<number>>(new Set());
  const [selfCheckOnly, setSelfCheckOnly] = useState(false); // 자체점검 보유자만 필터
  // 사원별 가장 임박한 자격 만료 정보 (만료일이 있는 자격 중 최소 잔여일)
  const [expiryByUser, setExpiryByUser] = useState<Map<number, { daysLeft: number; certName: string }>>(new Map());
  const [expiryOnly, setExpiryOnly] = useState(false); // 만료 임박/만료자만 필터

  const { user: me } = useAuth();
  const meIsAdmin = me ? isAdmin(me) : false;
  // 사원 클릭 시 개인정보수정 진입 권한 — admin 또는 사원관리 update 권한 보유
  const canEditUser = me ? (meIsAdmin || hasMenuPermission(me, "/data/users", "update")) : false;
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { viewMode } = useViewMode();
  const isMobile = viewMode === "mobile";
  const { tabs, openTab } = useTabs();

  // 숨어 있던 탭이 다시 보일 때 사원 목록을 다시 받아 stale 방지
  // (인사이동 탭에서 발령 등록 → accounts 변경분을 새로고침 없이 반영)
  const reloadUsers = useCallback(() => {
    api.get<UserRecord[]>("/api/users").then(setUsers).catch(() => {});
    // 자격 정보 로드 — 자체점검 보유자 + 사원별 만료 임박 계산 (배지/필터용)
    // PostgREST 기본 max-rows(1000) 회피 — range로 전량 페이징 (사원×자격 누적 대비)
    (async () => {
      type CertRow = { user_id: number; self_check: boolean | null; expiry_date: string | null; cert_name: string | null };
      const PAGE = 1000;
      const rows: CertRow[] = [];
      for (let off = 0; ; off += PAGE) {
        const { data } = await supabase.from("user_certifications").select("user_id, self_check, expiry_date, cert_name").range(off, off + PAGE - 1);
        const batch = (data as CertRow[] | null) ?? [];
        rows.push(...batch);
        if (batch.length < PAGE) break;
      }
      const sc = new Set<number>();
      const exp = new Map<number, { daysLeft: number; certName: string }>();
      for (const r of rows) {
        const uid = Number(r.user_id);
        if (r.self_check) sc.add(uid);
        const d = daysUntilExpiry(r.expiry_date);
        if (d !== null) {
          const prev = exp.get(uid);
          if (!prev || d < prev.daysLeft) exp.set(uid, { daysLeft: d, certName: r.cert_name ?? "" });
        }
      }
      setSelfCheckIds(sc);
      setExpiryByUser(exp);
    })();
  }, []);
  useReloadOnActivate(reloadUsers);

  useEffect(() => {
    reloadUsers();
  }, [reloadUsers]);

  // 사원 이름 클릭 → 개인정보수정 탭에 대상 사용자로 진입 (admin 또는 사원관리 update 권한)
  function openProfileEdit(u: UserRecord) {
    if (!canEditUser) return;
    try {
      sessionStorage.setItem(ADMIN_EDIT_USER_KEY, String(u.id));
      // MyProfileClient 가 같은 탭에 마운트돼 있으면 즉시 재로딩하도록 이벤트 발행
      window.dispatchEvent(new CustomEvent("ds:admin-edit-user-changed", { detail: { userId: u.id } }));
    } catch {}
    const href = "/data/profile";
    const alreadyOpen = tabs.some(t => t.href === href);
    if (!alreadyOpen && tabs.length >= MAX_TABS) {
      alert(`탭은 최대 ${MAX_TABS}개까지 열 수 있습니다. 다른 탭을 닫고 다시 시도해주세요.`);
      return;
    }
    openTab(href, "개인정보수정");
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
    setPage(1);
  }

  function resetPage() { setPage(1); }
  function changePage(next: number) { setPage(Math.max(1, Math.min(next, totalPages))); }

  const q = query.trim().toLowerCase();
  const filtered = users.filter(u => {
    if (statusFilter !== "전체" && u.status !== statusFilter) return false;
    if (selfCheckOnly && !selfCheckIds.has(u.id)) return false;
    if (expiryOnly && !isExpiryAlert(expiryByUser.get(u.id)?.daysLeft ?? null)) return false;
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      (u.dept?.toLowerCase().includes(q) ?? false) ||
      (u.rank?.toLowerCase().includes(q) ?? false) ||
      (u.phone?.includes(q) ?? false) ||
      String(u.id).includes(q)
    );
  });

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "ko");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  // 전체 사원 중 만료 임박/만료 자격 보유자 수 (집계용)
  const expiringCount = useMemo(() => {
    let n = 0;
    expiryByUser.forEach(e => { if (isExpiryAlert(e.daysLeft)) n++; });
    return n;
  }, [expiryByUser]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <>
      {/* 툴바 — 모바일: 세로 스택 / PC: 가로 */}
      <div className={`flex gap-3 ${isMobile ? "flex-col" : "items-center flex-wrap"}`}>
        {/* 상태 필터 */}
        <div className={`flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl ${isMobile ? "w-full justify-between" : "shrink-0"}`}>
          {(["전체", "재직", "퇴직", "휴직"] as const).map(s => {
            const count = s === "전체" ? users.length : users.filter(u => u.status === s).length;
            return (
              <button key={s} type="button" onClick={() => { setStatusFilter(s); resetPage(); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${isMobile ? "flex-1" : ""}
                  ${statusFilter === s
                    ? s === "전체" ? "bg-gray-900 text-white shadow-sm" : "bg-white text-gray-700 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                    : isDark ? "text-gray-400 hover:text-gray-200" : "text-gray-400 hover:text-gray-600"}`}>
                {s} <span className="font-normal opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {/* 자체점검 자격 보유자 필터 + 집계(전체 보유자 수) */}
        <button type="button" onClick={() => { setSelfCheckOnly(v => !v); resetPage(); }}
          title="자체점검 자격 보유자만 보기"
          className={`${isMobile ? "w-full justify-center" : "shrink-0"} flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors border ${
            selfCheckOnly
              ? "border-emerald-500 bg-emerald-500 text-white"
              : isDark ? "border-emerald-700 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-800/50" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          }`}>
          🛡️ 자체점검 <span className="font-normal opacity-80">{fmtNum(selfCheckIds.size)}</span>
        </button>

        {/* 자격 만료 임박/만료자 필터 + 집계 */}
        <button type="button" onClick={() => { setExpiryOnly(v => !v); resetPage(); }}
          title={`자격 만료 임박(D-${EXPIRY_WARN_DAYS})·만료자만 보기`}
          className={`${isMobile ? "w-full justify-center" : "shrink-0"} flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors border ${
            expiryOnly
              ? "border-amber-500 bg-amber-500 text-white"
              : isDark ? "border-amber-700 bg-amber-900/30 text-amber-300 hover:bg-amber-800/50" : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
          }`}>
          ⚠️ 만료임박 <span className="font-normal opacity-80">{fmtNum(expiringCount)}</span>
        </button>

        {/* 검색 */}
        <div className={`relative min-w-48 ${isMobile ? "w-full" : "flex-1"}`}>
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input lang="ko" value={query} onChange={e => { setQuery(e.target.value); resetPage(); }}
            placeholder="이름, 부서, 직급, 전화번호 검색"
            className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500" />
          {query && (
            <button type="button" onClick={() => { setQuery(""); resetPage(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
          )}
        </div>

        {/* 카운트 + 엑셀 — 모바일에서는 한 줄로 묶음 */}
        <div className={isMobile ? "flex items-center justify-between w-full" : "contents"}>
          <span className="text-sm text-gray-500 shrink-0">
            {expiryOnly
              ? `만료임박 ${fmtNum(filtered.length)}명`
              : selfCheckOnly
                ? `자체점검 ${fmtNum(filtered.length)}명`
                : q
                  ? `검색 ${fmtNum(filtered.length)}명`
                  : statusFilter !== "전체"
                    ? `${statusFilter} ${fmtNum(filtered.length)}명`
                    : `전체 ${fmtNum(users.length)}명`}
          </span>

          {/* accounts 전체 엑셀 다운로드 (관리자 전용) */}
          {meIsAdmin && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await downloadAccountsExcel();
                } catch (e) {
                  alert(`다운로드 실패: ${getErrorMessage(e)}`);
                }
              }}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors border ${
                isDark
                  ? "border-emerald-700 bg-emerald-900/40 text-emerald-300 hover:bg-emerald-800/60"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              }`}
            >
              📥 계정 전체 엑셀
            </button>
          )}
        </div>
      </div>

      {/* 목록 — 모바일: 카드 / PC: 테이블 */}
      <div className={`rounded-xl border overflow-hidden transition-colors ${isDark ? "bg-gray-900 border-gray-700" : "bg-white border-gray-200"}`}>
        {isMobile ? (
          <div className={`divide-y ${isDark ? "divide-gray-700" : "divide-gray-100"}`}>
            {filtered.length === 0 ? (
              <div className={`text-center py-12 text-sm ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                {q ? "검색 결과가 없습니다" : "등록된 사용자가 없습니다"}
              </div>
            ) : paginated.map(u => (
              <div key={u.id} onClick={() => setSelected(u)}
                className={`p-4 cursor-pointer transition-colors ${isDark ? "active:bg-gray-800" : "active:bg-gray-50"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {canEditUser ? (
                        <button type="button" onClick={e => { e.stopPropagation(); openProfileEdit(u); }}
                          className="font-semibold text-gray-800 dark:text-white underline decoration-dotted decoration-slate-400">
                          {u.name}
                        </button>
                      ) : <span className="font-semibold text-gray-800 dark:text-white">{u.name}</span>}
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CLS[u.status ?? ""] ?? "bg-gray-100 text-gray-500"}`}>{u.status ?? "-"}</span>
                      {selfCheckIds.has(u.id) && <SelfCheckBadge />}
                      {(() => {
                        const e = expiryByUser.get(u.id);
                        if (!e || !isExpiryAlert(e.daysLeft)) return null;
                        return <ExpiryBadge daysLeft={e.daysLeft} certName={e.certName} />;
                      })()}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">#{u.id} · {u.dept ?? "-"} · {u.rank ?? "-"}</p>
                  </div>
                  {meIsAdmin && (
                    <button type="button" onClick={e => { e.stopPropagation(); setEditPerms(u); }}
                      className={`shrink-0 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${isDark ? "border-gray-600 text-gray-300 hover:bg-gray-700" : "border-gray-200 text-gray-500 hover:bg-slate-50"}`}>
                      권한
                    </button>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
                  <div><span className="text-gray-400">전화 </span>{u.phone ?? "-"}</div>
                  <div><span className="text-gray-400">입사 </span>{u.hireDate ?? "-"}</div>
                  <div className="col-span-2 truncate"><span className="text-gray-400">자격증 </span>{u.cert ?? "-"}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
        <div className="overflow-auto max-h-[calc(100vh-250px)]">
          <table className="w-full min-w-[700px] text-sm">
            <thead className={`sticky top-0 z-10 border-b transition-colors ${isDark ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-100"}`}>
              <tr>
                {COLUMNS.map(c => {
                  const active = c.key === sortKey;
                  return (
                    <th key={c.key} className={`px-4 py-3 text-center text-xs font-medium whitespace-nowrap ${isDark ? "text-gray-300" : "text-gray-500"}`}>
                      <button type="button" onClick={() => toggleSort(c.key)}
                        className={`flex items-center justify-center mx-auto gap-1 hover:text-gray-700 dark:hover:text-gray-200 transition-colors ${active ? "text-gray-700 dark:text-gray-100 font-semibold" : ""}`}>
                        {c.label}
                        <span className={`text-[10px] ${active ? "opacity-100" : "opacity-30"}`}>
                          {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                        </span>
                      </button>
                    </th>
                  );
                })}
                {meIsAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? "divide-gray-700" : "divide-gray-50"}`}>
              {filtered.length === 0 ? (
                <tr><td colSpan={meIsAdmin ? 9 : 8} className={`text-center py-12 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                  {q ? "검색 결과가 없습니다" : "등록된 사용자가 없습니다"}
                </td></tr>
              ) : paginated.map(u => (
                <tr key={u.id} onClick={() => setSelected(u)}
                  className={`transition-colors cursor-pointer ${isDark ? "hover:bg-gray-800" : "hover:bg-gray-50"}`}>
                  <td className={`px-4 py-3 text-center text-xs whitespace-nowrap ${isDark ? "text-gray-400" : "text-gray-400"}`}>{u.id}</td>
                  <td className={`px-4 py-3 text-center font-medium whitespace-nowrap ${isDark ? "text-white" : "text-gray-800"}`}>
                    {canEditUser ? (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); openProfileEdit(u); }}
                        title="개인정보수정으로 이동"
                        className="inline-flex items-center gap-1 group hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      >
                        <span className="underline decoration-dotted decoration-slate-400 group-hover:decoration-blue-500">{u.name}</span>
                        <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
                      </button>
                    ) : u.name}
                    {selfCheckIds.has(u.id) && <>{" "}<SelfCheckBadge /></>}
                    {(() => {
                      const e = expiryByUser.get(u.id);
                      if (!e || !isExpiryAlert(e.daysLeft)) return null;
                      return <>{" "}<ExpiryBadge daysLeft={e.daysLeft} certName={e.certName} /></>;
                    })()}
                  </td>
                  <td className={`px-4 py-3 text-center whitespace-nowrap ${isDark ? "text-gray-300" : "text-gray-600"}`}>{u.dept ?? "-"}</td>
                  <td className={`px-4 py-3 text-center whitespace-nowrap ${isDark ? "text-gray-300" : "text-gray-600"}`}>{u.rank ?? "-"}</td>
                  <td className={`px-4 py-3 text-center text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>{u.cert ?? "-"}</td>
                  <td className={`px-4 py-3 text-center whitespace-nowrap ${isDark ? "text-gray-400" : "text-gray-500"}`}>{u.hireDate ?? "-"}</td>
                  <td className={`px-4 py-3 text-center whitespace-nowrap ${isDark ? "text-gray-300" : "text-gray-600"}`}>{u.phone ?? "-"}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CLS[u.status ?? ""] ?? "bg-gray-100 text-gray-500"}`}>
                      {u.status ?? "-"}
                    </span>
                  </td>
                  {meIsAdmin && (
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => setEditPerms(u)}
                        className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${isDark ? "border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white" : "border-gray-200 text-gray-500 hover:bg-slate-50 hover:text-slate-700"}`}>
                        권한 수정
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {/* 페이지네이션 — 모바일: 이전/다음만 간소화 */}
        {totalPages > 1 && (isMobile ? (
          <div className={`flex items-center justify-between px-4 py-3 border-t ${isDark ? "border-gray-700 bg-gray-800/60" : "border-gray-100 bg-gray-50/60"}`}>
            <button onClick={() => changePage(safePage - 1)} disabled={safePage === 1}
              className={`px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${isDark ? "text-gray-300 bg-gray-700/60 hover:bg-gray-700" : "text-gray-600 bg-gray-100 hover:bg-gray-200"}`}>‹ 이전</button>
            <span className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>{safePage} / {totalPages} 페이지 · {fmtNum(sorted.length)}명</span>
            <button onClick={() => changePage(safePage + 1)} disabled={safePage === totalPages}
              className={`px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${isDark ? "text-gray-300 bg-gray-700/60 hover:bg-gray-700" : "text-gray-600 bg-gray-100 hover:bg-gray-200"}`}>다음 ›</button>
          </div>
        ) : (
          <div className={`flex items-center justify-between px-5 py-3 border-t ${isDark ? "border-gray-700 bg-gray-800/60" : "border-gray-100 bg-gray-50/60"}`}>
            <span className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>
              {fmtNum((safePage - 1) * PAGE_SIZE + 1)}–{fmtNum(Math.min(safePage * PAGE_SIZE, sorted.length))} / {fmtNum(sorted.length)}명
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => changePage(1)} disabled={safePage === 1}
                className={`px-2 py-1.5 rounded text-xs disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${isDark ? "text-gray-400 hover:bg-gray-700" : "text-gray-500 hover:bg-gray-200"}`}>«</button>
              <button onClick={() => changePage(safePage - 1)} disabled={safePage === 1}
                className={`px-3 py-1.5 rounded text-xs disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${isDark ? "text-gray-400 hover:bg-gray-700" : "text-gray-500 hover:bg-gray-200"}`}>‹ 이전</button>
              {(() => {
                const half = 2;
                let start = Math.max(1, safePage - half);
                const end = Math.min(totalPages, start + 4);
                if (end - start < 4) start = Math.max(1, end - 4);
                return Array.from({ length: end - start + 1 }, (_, i) => start + i).map(p => (
                  <button key={p} onClick={() => changePage(p)}
                    className={`min-w-[32px] px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                      p === safePage ? "bg-slate-700 text-white" : isDark ? "text-gray-300 hover:bg-gray-700" : "text-gray-600 hover:bg-gray-200"
                    }`}>{p}</button>
                ));
              })()}
              <button onClick={() => changePage(safePage + 1)} disabled={safePage === totalPages}
                className={`px-3 py-1.5 rounded text-xs disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${isDark ? "text-gray-400 hover:bg-gray-700" : "text-gray-500 hover:bg-gray-200"}`}>다음 ›</button>
              <button onClick={() => changePage(totalPages)} disabled={safePage === totalPages}
                className={`px-2 py-1.5 rounded text-xs disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${isDark ? "text-gray-400 hover:bg-gray-700" : "text-gray-500 hover:bg-gray-200"}`}>»</button>
            </div>
            <span className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>{safePage} / {totalPages} 페이지</span>
          </div>
        ))}
      </div>

      {/* 상세 모달 (읽기 전용) */}
      <DraggableModal
        open={!!selected && !editPerms}
        onClose={() => setSelected(null)}
        panelClassName="w-full max-w-md mx-4 max-h-[85vh]"
        header={selected && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">{selected.name}</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CLS[selected.status ?? ""] ?? "bg-gray-100 text-gray-500"}`}>{selected.status}</span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{selected.dept} · {selected.rank}</p>
            </div>
            <div className="flex items-center gap-2">
              {meIsAdmin && (
                <>
                  <button type="button" onClick={() => { setSelected(null); openProfileEdit(selected); }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors font-medium">📝 정보 수정</button>
                  <button type="button" onClick={() => setEditPerms(selected)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors font-medium">권한 수정</button>
                </>
              )}
              <button type="button" onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-1">×</button>
            </div>
          </div>
        )}
      >
        {selected && (
          <div className="px-6 py-5 space-y-2.5 overflow-y-auto">
              {[
                ["사원번호", String(selected.id)],
                ["주민번호", selected.ssn ? maskSsn(selected.ssn) : "-"],
                ["자격증",   selected.cert ?? "-"],
                ["전화번호", selected.phone ?? "-"],
                ["입사일",   selected.hireDate ?? "-"],
                ["퇴사일",   selected.resignDate ?? "-"],
                ["주소",     selected.address ?? "-"],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-3">
                  <span className="text-gray-400 w-24 shrink-0 text-sm">{label}</span>
                  <span className="text-gray-800 dark:text-gray-100 text-sm break-all">{value}</span>
                </div>
              ))}
              {selfCheckIds.has(selected.id) && (
                <div className="flex gap-3">
                  <span className="text-gray-400 w-24 shrink-0 text-sm">자체점검</span>
                  <SelfCheckBadge />
                </div>
              )}
              {(() => {
                const e = expiryByUser.get(selected.id);
                if (!e || !isExpiryAlert(e.daysLeft)) return null;
                return (
                  <div className="flex gap-3">
                    <span className="text-gray-400 w-24 shrink-0 text-sm">자격만료</span>
                    <ExpiryBadge daysLeft={e.daysLeft} certName={e.certName} />
                  </div>
                );
              })()}
              {(selected.permissions ?? []).length > 0 && (
                <div className="flex gap-3">
                  <span className="text-gray-400 w-24 shrink-0 text-sm">권한</span>
                  <div className="flex gap-1 flex-wrap">
                    <PermBadge perms={selected.permissions ?? []} />
                  </div>
                </div>
              )}
          </div>
        )}
      </DraggableModal>

      {/* 권한 수정 모달 */}
      {editPerms && (
        <PermissionsModal
          user={editPerms}
          onClose={() => setEditPerms(null)}
          onSave={async (newPerms) => {
            try {
              const updated = await api.patch<UserRecord>(`/api/users/${editPerms.id}`, { permissions: newPerms });
              setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
              if (selected?.id === updated.id) setSelected(updated);
              setEditPerms(null);
            } catch (e) {
              alert(getErrorMessage(e));
            }
          }}
        />
      )}
    </>
  );
}
