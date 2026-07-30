"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";

const HREF = "/data/access-stats";

type Category = "login" | "menu" | "material" | "maintenance";
type Tab = "user" | "day" | "month" | "menu";

interface AccountLite {
  id: number;
  name: string;
  dept: string | null;
}

interface Event {
  user_id: number | null;   // null = 유지보수 이름 매칭 실패
  user_name: string;
  dept: string;
  category: Category;
  action: string;           // 세부 액션
  href?: string;            // 메뉴방문 카테고리에서 사용
  at: string;               // ISO
}

const CATEGORY_LABEL: Record<Category, string> = {
  login: "로그인",
  menu: "메뉴방문",
  material: "자재관리",
  maintenance: "유지보수",
};

const CATEGORY_COLOR: Record<Category, string> = {
  login: "text-sky-600 dark:text-sky-300",
  menu: "text-violet-600 dark:text-violet-300",
  material: "text-amber-600 dark:text-amber-300",
  maintenance: "text-rose-600 dark:text-rose-300",
};

const CATEGORY_ORDER: Category[] = ["login", "menu", "material", "maintenance"];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: ymd(from), to: ymd(to) };
}

function eventDayKey(iso: string): string {
  return iso.slice(0, 10);
}
function eventMonthKey(iso: string): string {
  return iso.slice(0, 7);
}

function downloadXlsx(rows: Record<string, unknown>[], sheetName: string, fileName: string) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const url = URL.createObjectURL(new Blob([buf], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}

export default function AccessStatsClient() {
  const { user } = useAuth();

  const init = defaultRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [dept, setDept] = useState<string>("전체");
  const [searchName, setSearchName] = useState<string>("");
  const [enabledCats, setEnabledCats] = useState<Set<Category>>(
    new Set<Category>(CATEGORY_ORDER)
  );
  const [tab, setTab] = useState<Tab>("user");

  const [accounts, setAccounts] = useState<AccountLite[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const fromIso = `${from}T00:00:00+09:00`;
    const toIso = `${to}T23:59:59.999+09:00`;

    const [accRes, loginRes, menuRes, mreqRes, poRes, txRes, uniRes, repRes] = await Promise.all([
      supabase.from("accounts").select("id, name:username, dept").order("username"),
      // 로그인
      supabase
        .from("login_logs")
        .select("user_id, username, created_at")
        .gte("created_at", fromIso)
        .lte("created_at", toIso),
      // 메뉴 방문
      supabase
        .from("menu_visits")
        .select("user_id, username, href, menu_label, visited_at")
        .gte("visited_at", fromIso)
        .lte("visited_at", toIso),
      // 자재신청
      supabase
        .from("material_requests")
        .select("requester_id, requester_name, requester_dept, requested_at")
        .gte("requested_at", fromIso)
        .lte("requested_at", toIso),
      // 발주
      supabase
        .from("purchase_orders")
        .select("user_id, user_name, ordered_at")
        .gte("ordered_at", fromIso)
        .lte("ordered_at", toIso),
      // 입고/출고
      supabase
        .from("transactions")
        .select("user_id, user_name, type, created_at")
        .gte("created_at", fromIso)
        .lte("created_at", toIso),
      // 근무복·안전장구 신청
      supabase
        .from("uniform_safety_requests")
        .select("user_id, user_name, user_dept, requested_at")
        .gte("requested_at", fromIso)
        .lte("requested_at", toIso),
      // 유지보수 고장처리 (처리자 관점 — completion_at 기준)
      supabase
        .from("reports")
        .select("completion_handler, completion_at")
        .not("completion_handler", "is", null)
        .not("completion_at", "is", null)
        .gte("completion_at", fromIso)
        .lte("completion_at", toIso),
    ]);

    const accList = (accRes.data ?? []) as AccountLite[];
    setAccounts(accList);
    const idToAcc = new Map<number, AccountLite>();
    const nameToAcc = new Map<string, AccountLite>();
    for (const a of accList) {
      idToAcc.set(a.id, a);
      // 이름 중복 시 첫 번째 유지 (reports 이름 매칭용)
      if (!nameToAcc.has(a.name)) nameToAcc.set(a.name, a);
    }

    function pickDept(uid: number | null, fallback?: string | null): string {
      if (uid != null) {
        const a = idToAcc.get(uid);
        if (a?.dept) return a.dept;
      }
      return fallback ?? "";
    }
    function pickName(uid: number | null, fallback: string): string {
      if (uid != null) {
        const a = idToAcc.get(uid);
        if (a?.name) return a.name;
      }
      return fallback;
    }

    const ev: Event[] = [];

    for (const r of (loginRes.data ?? []) as { user_id: number; username: string; created_at: string }[]) {
      ev.push({
        user_id: r.user_id,
        user_name: pickName(r.user_id, r.username),
        dept: pickDept(r.user_id),
        category: "login",
        action: "로그인",
        at: r.created_at,
      });
    }
    for (const r of (menuRes.data ?? []) as { user_id: number; username: string; href: string; menu_label: string | null; visited_at: string }[]) {
      ev.push({
        user_id: r.user_id,
        user_name: pickName(r.user_id, r.username),
        dept: pickDept(r.user_id),
        category: "menu",
        action: r.menu_label ?? r.href,
        href: r.href,
        at: r.visited_at,
      });
    }
    for (const r of (mreqRes.data ?? []) as { requester_id: number | null; requester_name: string | null; requester_dept: string | null; requested_at: string }[]) {
      ev.push({
        user_id: r.requester_id,
        user_name: pickName(r.requester_id, r.requester_name ?? "(미상)"),
        dept: pickDept(r.requester_id, r.requester_dept),
        category: "material",
        action: "자재신청",
        at: r.requested_at,
      });
    }
    for (const r of (poRes.data ?? []) as { user_id: number | null; user_name: string | null; ordered_at: string }[]) {
      ev.push({
        user_id: r.user_id,
        user_name: pickName(r.user_id, r.user_name ?? "(미상)"),
        dept: pickDept(r.user_id),
        category: "material",
        action: "발주",
        at: r.ordered_at,
      });
    }
    for (const r of (txRes.data ?? []) as { user_id: number | null; user_name: string | null; type: string; created_at: string }[]) {
      ev.push({
        user_id: r.user_id,
        user_name: pickName(r.user_id, r.user_name ?? "(미상)"),
        dept: pickDept(r.user_id),
        category: "material",
        action: r.type ?? "이동",  // 입고 / 출고
        at: r.created_at,
      });
    }
    for (const r of (uniRes.data ?? []) as { user_id: number | null; user_name: string | null; user_dept: string | null; requested_at: string }[]) {
      ev.push({
        user_id: r.user_id,
        user_name: pickName(r.user_id, r.user_name ?? "(미상)"),
        dept: pickDept(r.user_id, r.user_dept),
        category: "material",
        action: "근무복신청",
        at: r.requested_at,
      });
    }
    for (const r of (repRes.data ?? []) as { completion_handler: string; completion_at: string }[]) {
      const handler = (r.completion_handler ?? "").trim();
      const acc = handler ? nameToAcc.get(handler) : undefined;
      ev.push({
        user_id: acc?.id ?? null,
        user_name: acc?.name ?? (handler || "미분류"),
        dept: acc?.dept ?? "",
        category: "maintenance",
        action: "고장처리",
        at: r.completion_at,
      });
    }

    setEvents(ev);
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    if (user && isAdmin(user)) void load();
  }, [load, user]);
  useReloadOnActivate(() => {
    if (user && isAdmin(user)) void load();
  });

  const deptOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of accounts) if (a.dept) set.add(a.dept);
    return ["전체", ...Array.from(set).sort((a, b) => a.localeCompare(b, "ko"))];
  }, [accounts]);

  const filteredEvents = useMemo(() => {
    const kw = searchName.trim().toLowerCase();
    return events.filter((e) => {
      if (!enabledCats.has(e.category)) return false;
      if (dept !== "전체" && (e.dept || "") !== dept) return false;
      if (kw && !e.user_name.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [events, enabledCats, dept, searchName]);

  // 카테고리별 총합 (요약 카드)
  const summary = useMemo(() => {
    const s: Record<Category, number> = { login: 0, menu: 0, material: 0, maintenance: 0 };
    for (const e of filteredEvents) s[e.category] += 1;
    return s;
  }, [filteredEvents]);

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  if (!isAdmin(user)) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">시스템 관리자만 접근할 수 있는 페이지입니다.</div>
      </div>
    );
  }

  const inputCls =
    "px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400";

  function toggleCat(c: Category) {
    setEnabledCats((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  }

  const rangeStamp = () => `${from.replace(/-/g, "")}-${to.replace(/-/g, "")}`;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white">시스템접속통계</h1>
          <p className="text-sm text-gray-500 dark:text-gray-300 mt-0.5">
            사용자·일자·월별·메뉴별로 로그인·메뉴방문·자재관리·유지보수 활동 집계 (관리자 전용)
          </p>
        </div>
      </div>

      {/* 필터 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex flex-wrap items-center gap-2">
        <label className="text-xs text-gray-600 dark:text-gray-300">기간</label>
        <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-xs text-gray-400">~</span>
        <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />

        <div className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-1" />

        <label className="text-xs text-gray-600 dark:text-gray-300">부서</label>
        <select className={inputCls} value={dept} onChange={(e) => setDept(e.target.value)}>
          {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>

        <div className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-1" />

        <label className="text-xs text-gray-600 dark:text-gray-300">사용자</label>
        <input
          type="text"
          lang="ko"
          className={inputCls}
          placeholder="사원명 검색"
          list="access-stats-user-list"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          style={{ width: "9rem" }}
        />
        <datalist id="access-stats-user-list">
          {accounts
            .filter((a) => a.name && (dept === "전체" || (a.dept || "") === dept))
            .map((a) => (
              <option key={a.id} value={a.name}>{a.dept ?? ""}</option>
            ))}
        </datalist>
        {searchName && (
          <button
            type="button"
            onClick={() => setSearchName("")}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            title="검색 초기화"
          >×</button>
        )}

        <div className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-1" />

        <span className="text-xs text-gray-600 dark:text-gray-300">카테고리</span>
        {CATEGORY_ORDER.map((c) => (
          <label key={c} className="inline-flex items-center gap-1 text-xs text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={enabledCats.has(c)}
              onChange={() => toggleCat(c)}
            />
            <span className={CATEGORY_COLOR[c]}>{CATEGORY_LABEL[c]}</span>
          </label>
        ))}

        <button
          type="button"
          onClick={() => { void load(); }}
          disabled={loading}
          className="ml-2 px-3 py-1.5 text-xs rounded bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-60"
        >
          {loading ? "조회 중…" : "조회"}
        </button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {CATEGORY_ORDER.map((c) => (
          <div key={c} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <div className={`text-xs font-semibold ${CATEGORY_COLOR[c]}`}>{CATEGORY_LABEL[c]}</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
              {summary[c].toLocaleString()}
              <span className="text-xs text-gray-500 dark:text-gray-400 ml-1 font-normal">건</span>
            </div>
          </div>
        ))}
      </div>

      {/* 탭 */}
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700">
        {([
          { k: "user", label: "사용자별" },
          { k: "day", label: "일자별" },
          { k: "month", label: "월별" },
          { k: "menu", label: "메뉴별" },
        ] as { k: Tab; label: string }[]).map(({ k, label }) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === k
                ? "border-blue-500 text-blue-600 dark:text-blue-300"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "user" && (
        <UserTable
          events={filteredEvents}
          enabledCats={enabledCats}
          onExport={(rows) => downloadXlsx(rows, "사용자별", `access-stats-user-${rangeStamp()}.xlsx`)}
        />
      )}
      {tab === "day" && (
        <BucketTable
          bucketKey={eventDayKey}
          bucketLabel="일자"
          events={filteredEvents}
          enabledCats={enabledCats}
          from={from}
          to={to}
          mode="day"
          onExport={(rows) => downloadXlsx(rows, "일자별", `access-stats-day-${rangeStamp()}.xlsx`)}
        />
      )}
      {tab === "month" && (
        <BucketTable
          bucketKey={eventMonthKey}
          bucketLabel="월"
          events={filteredEvents}
          enabledCats={enabledCats}
          from={from}
          to={to}
          mode="month"
          onExport={(rows) => downloadXlsx(rows, "월별", `access-stats-month-${rangeStamp()}.xlsx`)}
        />
      )}
      {tab === "menu" && (
        <MenuTable
          events={filteredEvents}
          onExport={(rows) => downloadXlsx(rows, "메뉴별", `access-stats-menu-${rangeStamp()}.xlsx`)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 정렬 헤더 공통
// ─────────────────────────────────────────────────────────

type SortDir = "asc" | "desc";
type SortState<K extends string> = { key: K; dir: SortDir };

function SortHeader<K extends string>({
  label, columnKey, sort, setSort, align = "left",
}: {
  label: React.ReactNode;
  columnKey: K;
  sort: SortState<K>;
  setSort: (s: SortState<K>) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === columnKey;
  const arrow = !active ? "↕" : sort.dir === "asc" ? "▲" : "▼";
  return (
    <th
      className={`${align === "right" ? "text-right" : "text-left"} px-3 py-2 font-semibold cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-700/40`}
      onClick={() => setSort({ key: columnKey, dir: active && sort.dir === "desc" ? "asc" : "desc" })}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-[9px] ${active ? "text-blue-500 dark:text-blue-300" : "text-gray-300 dark:text-gray-600"}`}>{arrow}</span>
      </span>
    </th>
  );
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""), "ko", { numeric: true });
}

// ─────────────────────────────────────────────────────────
// 사용자별 표
// ─────────────────────────────────────────────────────────

type UserSortKey = "user_name" | "dept" | "login" | "menu" | "material" | "maintenance" | "total" | "lastAt";

interface UserRow {
  key: string;              // user_id 또는 이름
  user_name: string;
  dept: string;
  login: number;
  menu: number;
  material: number;
  maintenance: number;
  material_detail: Record<string, number>;
  total: number;
  lastAt: string;
}

function UserTable({
  events,
  enabledCats,
  onExport,
}: {
  events: Event[];
  enabledCats: Set<Category>;
  onExport: (rows: Record<string, unknown>[]) => void;
}) {
  const [sort, setSort] = useState<SortState<UserSortKey>>({ key: "total", dir: "desc" });

  const rows = useMemo<UserRow[]>(() => {
    const map = new Map<string, UserRow>();
    for (const e of events) {
      const key = e.user_id != null ? `id:${e.user_id}` : `nm:${e.user_name}`;
      let r = map.get(key);
      if (!r) {
        r = {
          key,
          user_name: e.user_name,
          dept: e.dept,
          login: 0, menu: 0, material: 0, maintenance: 0,
          material_detail: {},
          total: 0,
          lastAt: e.at,
        };
        map.set(key, r);
      }
      r[e.category] += 1;
      r.total += 1;
      if (e.category === "material") {
        r.material_detail[e.action] = (r.material_detail[e.action] ?? 0) + 1;
      }
      if (e.at > r.lastAt) r.lastAt = e.at;
      if (!r.dept && e.dept) r.dept = e.dept;
    }
    const list = Array.from(map.values());
    const sign = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => sign * cmp(a[sort.key], b[sort.key]));
    return list;
  }, [events, sort]);

  function exportRows() {
    onExport(
      rows.map((r) => ({
        사용자: r.user_name,
        부서: r.dept,
        로그인: r.login,
        메뉴방문: r.menu,
        자재관리: r.material,
        "  자재신청": r.material_detail["자재신청"] ?? 0,
        "  발주": r.material_detail["발주"] ?? 0,
        "  입고": r.material_detail["입고"] ?? 0,
        "  출고": r.material_detail["출고"] ?? 0,
        "  근무복신청": r.material_detail["근무복신청"] ?? 0,
        유지보수: r.maintenance,
        합계: r.total,
        최근활동: r.lastAt.replace("T", " ").slice(0, 16),
      }))
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500 dark:text-gray-400">총 {rows.length.toLocaleString()}명</div>
        <button
          type="button"
          onClick={exportRows}
          disabled={rows.length === 0}
          className="px-3 py-1.5 text-xs rounded bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-60"
        >
          📥 엑셀 다운로드
        </button>
      </div>
      <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-700 dark:text-gray-200">
            <tr>
              <SortHeader label="사용자" columnKey="user_name" sort={sort} setSort={setSort} />
              <SortHeader label="부서" columnKey="dept" sort={sort} setSort={setSort} />
              {enabledCats.has("login") && <SortHeader label="로그인" columnKey="login" sort={sort} setSort={setSort} align="right" />}
              {enabledCats.has("menu") && <SortHeader label="메뉴방문" columnKey="menu" sort={sort} setSort={setSort} align="right" />}
              {enabledCats.has("material") && <SortHeader label="자재관리" columnKey="material" sort={sort} setSort={setSort} align="right" />}
              {enabledCats.has("maintenance") && <SortHeader label="유지보수" columnKey="maintenance" sort={sort} setSort={setSort} align="right" />}
              <SortHeader label="합계" columnKey="total" sort={sort} setSort={setSort} align="right" />
              <SortHeader label="최근활동" columnKey="lastAt" sort={sort} setSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8 text-gray-400">조건에 맞는 활동이 없습니다.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.key} className="border-t border-gray-100 dark:border-gray-700/50">
                <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{r.user_name}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{r.dept || "-"}</td>
                {enabledCats.has("login") && (
                  <td className="px-3 py-2 text-right tabular-nums text-sky-600 dark:text-sky-300">{r.login || ""}</td>
                )}
                {enabledCats.has("menu") && (
                  <td className="px-3 py-2 text-right tabular-nums text-violet-600 dark:text-violet-300">{r.menu || ""}</td>
                )}
                {enabledCats.has("material") && (
                  <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-300">
                    {r.material || ""}
                    {r.material > 0 && (
                      <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500">
                        (신청{r.material_detail["자재신청"] ?? 0}·발주{r.material_detail["발주"] ?? 0}·입{r.material_detail["입고"] ?? 0}·출{r.material_detail["출고"] ?? 0}·근무복{r.material_detail["근무복신청"] ?? 0})
                      </span>
                    )}
                  </td>
                )}
                {enabledCats.has("maintenance") && (
                  <td className="px-3 py-2 text-right tabular-nums text-rose-600 dark:text-rose-300">{r.maintenance || ""}</td>
                )}
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900 dark:text-gray-100">{r.total}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{r.lastAt.replace("T", " ").slice(0, 16)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 일자별·월별 (bucket 표)
// ─────────────────────────────────────────────────────────

type BucketSortKey = "key" | "login" | "menu" | "material" | "maintenance" | "usersSize" | "total";

interface BucketRow {
  key: string;
  login: number;
  menu: number;
  material: number;
  maintenance: number;
  users: Set<string>;
  total: number;
}

function BucketTable({
  events,
  enabledCats,
  bucketKey,
  bucketLabel,
  from,
  to,
  mode,
  onExport,
}: {
  events: Event[];
  enabledCats: Set<Category>;
  bucketKey: (iso: string) => string;
  bucketLabel: string;
  from: string;
  to: string;
  mode: "day" | "month";
  onExport: (rows: Record<string, unknown>[]) => void;
}) {
  const [sort, setSort] = useState<SortState<BucketSortKey>>({ key: "key", dir: "desc" });

  const rows = useMemo<BucketRow[]>(() => {
    const map = new Map<string, BucketRow>();

    // 버킷 라벨 사전 생성 (빈 날/월도 표시)
    const start = new Date(from);
    const end = new Date(to);
    if (mode === "day") {
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const k = ymd(d);
        map.set(k, { key: k, login: 0, menu: 0, material: 0, maintenance: 0, users: new Set(), total: 0 });
      }
    } else {
      const cur = new Date(start.getFullYear(), start.getMonth(), 1);
      const stop = new Date(end.getFullYear(), end.getMonth(), 1);
      while (cur <= stop) {
        const k = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
        map.set(k, { key: k, login: 0, menu: 0, material: 0, maintenance: 0, users: new Set(), total: 0 });
        cur.setMonth(cur.getMonth() + 1);
      }
    }

    for (const e of events) {
      const k = bucketKey(e.at);
      let r = map.get(k);
      if (!r) {
        r = { key: k, login: 0, menu: 0, material: 0, maintenance: 0, users: new Set(), total: 0 };
        map.set(k, r);
      }
      r[e.category] += 1;
      r.total += 1;
      // 활성사용자수는 실제 행동만 카운트 — 메뉴방문은 볼륨이 커 제외
      if (e.category !== "menu") {
        r.users.add(e.user_id != null ? `id:${e.user_id}` : `nm:${e.user_name}`);
      }
    }
    const list = Array.from(map.values());
    const sign = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => sign * cmp(
      sort.key === "usersSize" ? a.users.size : a[sort.key],
      sort.key === "usersSize" ? b.users.size : b[sort.key],
    ));
    return list;
  }, [events, bucketKey, from, to, mode, sort]);

  function exportRows() {
    const cols: Record<string, unknown>[] = rows.map((r) => {
      const row: Record<string, unknown> = { [bucketLabel]: r.key };
      if (enabledCats.has("login")) row["로그인"] = r.login;
      if (enabledCats.has("menu")) row["메뉴방문"] = r.menu;
      if (enabledCats.has("material")) row["자재관리"] = r.material;
      if (enabledCats.has("maintenance")) row["유지보수"] = r.maintenance;
      row["활동사용자수"] = r.users.size;
      row["합계"] = r.total;
      return row;
    });
    onExport(cols);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500 dark:text-gray-400">총 {rows.length}개 {bucketLabel}</div>
        <button
          type="button"
          onClick={exportRows}
          disabled={rows.length === 0}
          className="px-3 py-1.5 text-xs rounded bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-60"
        >
          📥 엑셀 다운로드
        </button>
      </div>
      <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-700 dark:text-gray-200">
            <tr>
              <SortHeader label={bucketLabel} columnKey="key" sort={sort} setSort={setSort} />
              {enabledCats.has("login") && <SortHeader label="로그인" columnKey="login" sort={sort} setSort={setSort} align="right" />}
              {enabledCats.has("menu") && <SortHeader label="메뉴방문" columnKey="menu" sort={sort} setSort={setSort} align="right" />}
              {enabledCats.has("material") && <SortHeader label="자재관리" columnKey="material" sort={sort} setSort={setSort} align="right" />}
              {enabledCats.has("maintenance") && <SortHeader label="유지보수" columnKey="maintenance" sort={sort} setSort={setSort} align="right" />}
              <SortHeader label="활동사용자수" columnKey="usersSize" sort={sort} setSort={setSort} align="right" />
              <SortHeader label="합계" columnKey="total" sort={sort} setSort={setSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-gray-400">조건에 맞는 활동이 없습니다.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.key} className="border-t border-gray-100 dark:border-gray-700/50">
                <td className="px-3 py-2 text-gray-900 dark:text-gray-100 font-mono">{r.key}</td>
                {enabledCats.has("login") && (
                  <td className="px-3 py-2 text-right tabular-nums text-sky-600 dark:text-sky-300">{r.login || ""}</td>
                )}
                {enabledCats.has("menu") && (
                  <td className="px-3 py-2 text-right tabular-nums text-violet-600 dark:text-violet-300">{r.menu || ""}</td>
                )}
                {enabledCats.has("material") && (
                  <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-300">{r.material || ""}</td>
                )}
                {enabledCats.has("maintenance") && (
                  <td className="px-3 py-2 text-right tabular-nums text-rose-600 dark:text-rose-300">{r.maintenance || ""}</td>
                )}
                <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-200">{r.users.size || ""}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900 dark:text-gray-100">{r.total || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 메뉴별 표 — menu_visits 이벤트만 사용
// 행 클릭 시 해당 메뉴를 방문한 사용자별 방문수 드릴다운
// ─────────────────────────────────────────────────────────

type MenuSortKey = "label" | "href" | "visits" | "usersSize" | "lastAt";

interface MenuVisitor {
  key: string;
  name: string;
  dept: string;
  visits: number;
  lastAt: string;
}
interface MenuRow {
  href: string;
  label: string;
  visits: number;
  users: Set<string>;
  lastAt: string;
  visitors: MenuVisitor[];   // 방문수 내림차순
}

function summarizeTopVisitors(vs: MenuVisitor[], n = 3): string {
  return vs.slice(0, n).map((v) => `${v.name}(${v.visits})`).join(", ");
}

function MenuTable({
  events,
  onExport,
}: {
  events: Event[];
  onExport: (rows: Record<string, unknown>[]) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState<MenuSortKey>>({ key: "visits", dir: "desc" });

  const rows = useMemo<MenuRow[]>(() => {
    const menuMap = new Map<string, {
      href: string;
      label: string;
      visits: number;
      users: Set<string>;
      lastAt: string;
      visitorMap: Map<string, MenuVisitor>;
    }>();
    for (const e of events) {
      if (e.category !== "menu") continue;
      const href = e.href ?? "";
      let m = menuMap.get(href);
      if (!m) {
        m = { href, label: e.action || href, visits: 0, users: new Set(), lastAt: e.at, visitorMap: new Map() };
        menuMap.set(href, m);
      }
      m.visits += 1;
      const userKey = e.user_id != null ? `id:${e.user_id}` : `nm:${e.user_name}`;
      m.users.add(userKey);
      if (e.at > m.lastAt) m.lastAt = e.at;
      if (e.action && e.action !== href) m.label = e.action;
      let v = m.visitorMap.get(userKey);
      if (!v) {
        v = { key: userKey, name: e.user_name, dept: e.dept, visits: 0, lastAt: e.at };
        m.visitorMap.set(userKey, v);
      }
      v.visits += 1;
      if (e.at > v.lastAt) v.lastAt = e.at;
      if (!v.dept && e.dept) v.dept = e.dept;
    }
    const list = Array.from(menuMap.values()).map((m) => ({
      href: m.href,
      label: m.label,
      visits: m.visits,
      users: m.users,
      lastAt: m.lastAt,
      visitors: Array.from(m.visitorMap.values()).sort((a, b) => b.visits - a.visits),
    }));
    const sign = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => sign * cmp(
      sort.key === "usersSize" ? a.users.size : a[sort.key],
      sort.key === "usersSize" ? b.users.size : b[sort.key],
    ));
    return list;
  }, [events, sort]);

  function exportRows() {
    onExport(
      rows.map((r) => ({
        메뉴: r.label,
        경로: r.href,
        방문수: r.visits,
        유니크사용자수: r.users.size,
        상위방문자: summarizeTopVisitors(r.visitors, 5),
        최근방문: r.lastAt.replace("T", " ").slice(0, 16),
      }))
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          총 {rows.length}개 메뉴 · <span className="text-gray-400">행 클릭 시 사용자별 방문수</span>
        </div>
        <button
          type="button"
          onClick={exportRows}
          disabled={rows.length === 0}
          className="px-3 py-1.5 text-xs rounded bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-60"
        >
          📥 엑셀 다운로드
        </button>
      </div>
      <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-700 dark:text-gray-200">
            <tr>
              <th className="w-6 px-2 py-2"></th>
              <SortHeader label="메뉴" columnKey="label" sort={sort} setSort={setSort} />
              <SortHeader label="경로" columnKey="href" sort={sort} setSort={setSort} />
              <SortHeader label="방문수" columnKey="visits" sort={sort} setSort={setSort} align="right" />
              <SortHeader label="유니크 사용자수" columnKey="usersSize" sort={sort} setSort={setSort} align="right" />
              <th className="text-left px-3 py-2 font-semibold">상위 방문자</th>
              <SortHeader label="최근 방문" columnKey="lastAt" sort={sort} setSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-gray-400">
                메뉴방문 기록이 없습니다. 카테고리에서 &quot;메뉴방문&quot;이 활성화되어 있는지 확인하세요.
              </td></tr>
            ) : rows.map((r) => {
              const open = expanded === r.href;
              return (
                <Fragment key={r.href}>
                  <tr
                    className="border-t border-gray-100 dark:border-gray-700/50 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30"
                    onClick={() => setExpanded(open ? null : r.href)}
                  >
                    <td className="px-2 py-2 text-center text-gray-400 select-none">{open ? "▾" : "▸"}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{r.label}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 font-mono">{r.href}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-violet-600 dark:text-violet-300 font-semibold">{r.visits}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-200">{r.users.size}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 truncate max-w-xs">{summarizeTopVisitors(r.visitors)}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{r.lastAt.replace("T", " ").slice(0, 16)}</td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={7} className="bg-gray-50 dark:bg-gray-900/30 px-6 py-3">
                        <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-2">
                          {r.label} — 사용자별 방문 ({r.visitors.length}명)
                        </div>
                        <div className="max-h-64 overflow-y-auto rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                          <table className="w-full text-[11px]">
                            <thead className="bg-gray-100 dark:bg-gray-900/50 text-gray-600 dark:text-gray-300 sticky top-0">
                              <tr>
                                <th className="text-left px-3 py-1.5 font-semibold">사용자</th>
                                <th className="text-left px-3 py-1.5 font-semibold">부서</th>
                                <th className="text-right px-3 py-1.5 font-semibold">방문수</th>
                                <th className="text-left px-3 py-1.5 font-semibold">최근 방문</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.visitors.map((v) => (
                                <tr key={v.key} className="border-t border-gray-100 dark:border-gray-700/50">
                                  <td className="px-3 py-1.5 text-gray-900 dark:text-gray-100">{v.name}</td>
                                  <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">{v.dept || "-"}</td>
                                  <td className="px-3 py-1.5 text-right tabular-nums text-violet-600 dark:text-violet-300 font-semibold">{v.visits}</td>
                                  <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">{v.lastAt.replace("T", " ").slice(0, 16)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
