"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { fmtNum } from "@/lib/format";
import UniformSafetyDirectIssueTab, { type MaterialOption } from "./UniformSafetyDirectIssueTab";

const MENU_HREF = "/uniform-safety/admin";

// ============================================================
// 타입
// ============================================================

interface ReqItem {
  id: number;
  material_id: string;
  material_name: string;
  category_label: string | null;
  size: string | null;
  qty: number;
}

type Status = "신청" | "처리중" | "수령완료" | "취소";

interface ReqRow {
  id: number;
  request_type: "근무복" | "안전장구";
  status: Status;
  user_id: number;
  user_name: string;
  user_dept: string | null;
  note: string | null;
  requested_at: string;
  processed_at: string | null;
  processor_id: number | null;
  processor_name: string | null;
  received_at: string | null;
  items: ReqItem[];
}

interface UserMini { id: number; name: string; dept: string | null; }

type Tab = "manage" | "history" | "issue";
type StatusFilter = Status | "all";

// ============================================================

export default function UniformSafetyAdminClient() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("manage");

  const [rows, setRows] = useState<ReqRow[]>([]);
  const [users, setUsers] = useState<UserMini[]>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]); // 직접 불출용 자재 풀 (D9902 + D9903)
  const [subLabels, setSubLabels] = useState<{ uniform: Map<string, string>; safety: Map<string, string> }>(
    { uniform: new Map(), safety: new Map() }
  );
  const [loading, setLoading] = useState(true);

  // 처리 탭 필터
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("신청");
  const [mgFrom,     setMgFrom]     = useState("");
  const [mgTo,       setMgTo]       = useState("");
  const [mgType,     setMgType]     = useState<"all" | "근무복" | "안전장구">("all");
  const [mgUserId,   setMgUserId]   = useState<string>("");   // "" or user.id 문자열
  const [mgMaterial, setMgMaterial] = useState<string>("");   // material_id

  // 이력 탭 필터
  const todayIso = new Date().toISOString().slice(0, 10);
  const monthAgoIso = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [histFrom, setHistFrom] = useState(monthAgoIso);
  const [histTo,   setHistTo]   = useState(todayIso);
  const [histUserId,   setHistUserId]   = useState<string>("");
  const [histMaterial, setHistMaterial] = useState<string>("");
  const [histType, setHistType] = useState<"all" | "근무복" | "안전장구">("all");

  // 처리 진행 중
  const [processingId, setProcessingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, u, mUni, mSaf, cUni, cSaf] = await Promise.all([
      supabase.from("uniform_safety_requests")
        .select("*, items:uniform_safety_request_items(*)")
        .order("requested_at", { ascending: false })
        .limit(500),
      supabase.from("accounts").select("id, name:username, dept").eq("status", "재직").order("username"),
      supabase.from("materials").select("id, name, unit, model_no, stock_qty").like("id", "D9902%").order("id"),
      supabase.from("materials").select("id, name, unit, model_no, stock_qty").like("id", "D9903%").order("id"),
      supabase.from("categories").select("code, label").eq("level", "sub").eq("major_code", "99").eq("mid_code", "02"),
      supabase.from("categories").select("code, label").eq("level", "sub").eq("major_code", "99").eq("mid_code", "03"),
    ]);
    setRows(((r.data ?? []) as ReqRow[]).map(x => ({ ...x, items: x.items ?? [] })));
    setUsers((u.data ?? []) as UserMini[]);
    const matUni = ((mUni.data ?? []) as MaterialOption[]).map(m => ({ ...m, request_type: "근무복" as const }));
    const matSaf = ((mSaf.data ?? []) as MaterialOption[]).map(m => ({ ...m, request_type: "안전장구" as const }));
    setMaterials([...matUni, ...matSaf]);
    const uMap = new Map<string, string>();
    ((cUni.data ?? []) as {code: string; label: string}[]).forEach(r => uMap.set(r.code, r.label));
    const sMap = new Map<string, string>();
    ((cSaf.data ?? []) as {code: string; label: string}[]).forEach(r => sMap.set(r.code, r.label));
    setSubLabels({ uniform: uMap, safety: sMap });
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  const admin = isAdmin(user);
  const canRead   = admin || hasMenuPermission(user, MENU_HREF, "read");
  const canUpdate = admin || hasMenuPermission(user, MENU_HREF, "update");
  if (!canRead) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
      </div>
    );
  }

  // ============================================================
  // 핸들러
  // ============================================================

  async function setStatus(row: ReqRow, next: Status, opts: { reason?: string } = {}) {
    if (!canUpdate || !user) return;
    setProcessingId(row.id);
    try {
      // 신청 → 처리중 / 수령완료 로 첫 전환되는 시점에만 출고 트랜잭션 발생 (중복 방지)
      const needsIssue = row.status === "신청" && (next === "처리중" || next === "수령완료");

      if (needsIssue && row.items.length > 0) {
        // 사전 재고 검증: 같은 자재가 여러 라인에 있으면 합산
        const needMap = new Map<string, number>();
        for (const it of row.items) needMap.set(it.material_id, (needMap.get(it.material_id) ?? 0) + it.qty);
        const ids = Array.from(needMap.keys());
        const { data: stockRows, error: stockErr } = await supabase
          .from("materials")
          .select("id, name, stock_qty")
          .in("id", ids);
        if (stockErr) throw stockErr;
        const stockMap = new Map((stockRows ?? []).map(m => [m.id as string, { name: m.name as string, qty: (m.stock_qty as number) ?? 0 }]));
        const insufficient: string[] = [];
        for (const [mid, need] of needMap.entries()) {
          const info = stockMap.get(mid);
          if (!info || info.qty < need) {
            insufficient.push(`${info?.name ?? mid} (필요 ${need} / 재고 ${info?.qty ?? 0})`);
          }
        }
        if (insufficient.length > 0) {
          throw new Error(`재고 부족으로 출고 불가:\n- ${insufficient.join("\n- ")}`);
        }

        // 출고 트랜잭션 (라인 단위, 같은 신청은 동일 batch_id로 묶음)
        const batchId = crypto.randomUUID();
        const issueSiteName = `[지급] ${row.user_name}`;
        for (const it of row.items) {
          const noteParts = [
            `${row.request_type} 신청 #${row.id}`,
            row.user_dept ? `부서 ${row.user_dept}` : null,
            it.category_label ? `구분 ${it.category_label}` : null,
            it.size ? `사이즈 ${it.size}` : null,
          ].filter(Boolean) as string[];
          const { data, error } = await supabase.rpc("add_transaction", {
            p_type:            "출고",
            p_material_id:     it.material_id,
            p_material_name:   it.material_name,
            p_qty:             it.qty,
            p_site_name:       issueSiteName,
            p_note:            noteParts.join(" / "),
            p_user_id:         user.id,
            p_user_name:       user.name,
            p_elevator_name:   null,
            p_serial_nos:      null,
            p_requires_return: false,
            p_batch_id:        batchId,
          });
          if (error) throw error;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((data as any)?.error) throw new Error((data as any).error);
        }
      }

      const patch: Partial<ReqRow> & { processor_id?: number; processor_name?: string; cancel_reason?: string | null } = { status: next };
      if (next === "처리중") {
        patch.processed_at = new Date().toISOString();
        patch.processor_id = user.id;
        patch.processor_name = user.name;
      }
      if (next === "수령완료") {
        patch.received_at = new Date().toISOString();
        if (!row.processed_at) {
          patch.processed_at = new Date().toISOString();
          patch.processor_id = user.id;
          patch.processor_name = user.name;
        }
      }
      if (next === "취소") {
        if (opts.reason !== undefined) (patch as { cancel_reason?: string | null }).cancel_reason = opts.reason || null;
      }

      const { error: e1 } = await supabase.from("uniform_safety_requests").update(patch).eq("id", row.id);
      if (e1) throw e1;

      // 근무복 + 수령완료: users 사이즈 동기화 (상의/하의)
      if (next === "수령완료" && row.request_type === "근무복") {
        const update: Record<string, string> = {};
        for (const it of row.items) {
          if (!it.size) continue;
          if (it.category_label === "상의") update.uniform_top_size    = it.size;
          if (it.category_label === "하의") update.uniform_bottom_size = it.size;
        }
        if (Object.keys(update).length > 0) {
          const { error: e2 } = await supabase.from("accounts").update(update).eq("id", row.user_id);
          if (e2) throw e2;
        }
      }
      await load();
    } catch (e) {
      alert(`처리 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProcessingId(null);
    }
  }

  // ============================================================
  // 필터링
  // ============================================================

  const filteredManage = rows
    .filter(r => statusFilter === "all" ? true : r.status === statusFilter)
    .filter(r => mgType === "all" ? true : r.request_type === mgType)
    .filter(r => {
      const d = r.requested_at.slice(0, 10);
      return (!mgFrom || d >= mgFrom) && (!mgTo || d <= mgTo);
    })
    .filter(r => mgUserId ? String(r.user_id) === mgUserId : true)
    .filter(r => mgMaterial ? r.items.some(it => it.material_id === mgMaterial) : true);

  const filteredHistory = rows
    .filter(r => r.status === "수령완료")
    .filter(r => histType === "all" ? true : r.request_type === histType)
    .filter(r => {
      const d = (r.received_at ?? r.requested_at).slice(0, 10);
      return (!histFrom || d >= histFrom) && (!histTo || d <= histTo);
    })
    .filter(r => histUserId ? String(r.user_id) === histUserId : true)
    .filter(r => histMaterial ? r.items.some(it => it.material_id === histMaterial) : true);

  // 물품 옵션: rows 의 모든 item 으로부터 distinct material 추출
  const materialOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      for (const it of r.items) {
        if (!map.has(it.material_id)) map.set(it.material_id, it.material_name);
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // 이력 탭: 자재별 집계
  const materialAgg = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; lastDate: string; recipients: Set<string> }>();
    for (const r of filteredHistory) {
      for (const it of r.items) {
        const key = it.material_id;
        const cur = map.get(key) ?? { name: it.material_name, qty: 0, lastDate: "", recipients: new Set<string>() };
        cur.qty += it.qty;
        cur.recipients.add(r.user_name);
        const d = (r.received_at ?? r.requested_at).slice(0, 10);
        if (!cur.lastDate || d > cur.lastDate) cur.lastDate = d;
        map.set(key, cur);
      }
    }
    return Array.from(map.entries()).map(([id, v]) => ({ id, name: v.name, qty: v.qty, lastDate: v.lastDate, recipientCount: v.recipients.size }))
      .sort((a, b) => b.qty - a.qty);
  }, [filteredHistory]);

  const counts = {
    신청:    rows.filter(r => r.status === "신청").length,
    처리중:  rows.filter(r => r.status === "처리중").length,
    수령완료: rows.filter(r => r.status === "수령완료").length,
    취소:    rows.filter(r => r.status === "취소").length,
  };

  // ============================================================
  // 렌더
  // ============================================================

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">근무복 · 안전장구 관리</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">신청 처리 및 불출이력 조회</p>
      </div>

      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 flex gap-1">
        {([
          ["manage",  `📋 신청 처리 (${counts.신청 + counts.처리중})`],
          ["history", `📊 불출이력`],
          ["issue",   `➕ 직접 불출`],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`py-2.5 px-4 text-sm font-semibold border-b-2 transition-colors ${
              tab === t ? "text-blue-600 dark:text-blue-400 border-blue-500"
                       : "text-gray-500 dark:text-gray-400 border-transparent"
            }`}>{label}</button>
        ))}
      </div>

      {/* 처리 탭 */}
      {tab === "manage" && (
        <>
          <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {(["신청","처리중","수령완료","취소","all"] as StatusFilter[]).map(f => (
                <button key={f} type="button" onClick={() => setStatusFilter(f)}
                  className={`px-3 py-1 text-[11px] font-semibold rounded-full border ${
                    statusFilter === f
                      ? "bg-slate-700 text-white border-slate-700"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600"
                  }`}>
                  {f === "all" ? `전체 (${rows.length})` : `${f} (${counts[f as Status]})`}
                </button>
              ))}
              {(mgFrom || mgTo || mgType !== "all" || mgUserId || mgMaterial) && (
                <button type="button" onClick={() => {
                  setMgFrom(""); setMgTo(""); setMgType("all"); setMgUserId(""); setMgMaterial("");
                }} className="ml-auto text-[11px] text-blue-600 hover:underline">필터 초기화</button>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">시작일</label>
                <input type="date" value={mgFrom} onChange={e => setMgFrom(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">종료일</label>
                <input type="date" value={mgTo} onChange={e => setMgTo(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">구분</label>
                <select value={mgType} onChange={e => setMgType(e.target.value as typeof mgType)}
                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 text-xs">
                  <option value="all">전체</option>
                  <option value="근무복">근무복</option>
                  <option value="안전장구">안전장구</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">사용자</label>
                <select value={mgUserId} onChange={e => setMgUserId(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 text-xs">
                  <option value="">전체</option>
                  {users.map(u => <option key={u.id} value={String(u.id)}>{u.name}{u.dept ? ` (${u.dept})` : ""}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">물품</label>
                <select value={mgMaterial} onChange={e => setMgMaterial(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 text-xs">
                  <option value="">전체</option>
                  {materialOptions.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 space-y-2">
            {loading && <div className="text-center py-12 text-xs text-gray-500">로딩 중...</div>}
            {!loading && filteredManage.length === 0 && (
              <div className="text-center py-12 text-xs text-gray-500">조건에 맞는 신청이 없습니다.</div>
            )}
            {!loading && filteredManage.map(r => (
              <RequestCard key={r.id} row={r} processingId={processingId} canUpdate={canUpdate} onChange={setStatus} />
            ))}
          </div>
        </>
      )}

      {/* 이력 탭 */}
      {tab === "history" && (
        <>
          <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 space-y-2">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">시작일</label>
                <input type="date" value={histFrom} onChange={e => setHistFrom(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">종료일</label>
                <input type="date" value={histTo} onChange={e => setHistTo(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 text-xs" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">구분</label>
                <select value={histType} onChange={e => setHistType(e.target.value as typeof histType)}
                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 text-xs">
                  <option value="all">전체</option>
                  <option value="근무복">근무복</option>
                  <option value="안전장구">안전장구</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">사용자</label>
                <select value={histUserId} onChange={e => setHistUserId(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 text-xs">
                  <option value="">전체</option>
                  {users.map(u => <option key={u.id} value={String(u.id)}>{u.name}{u.dept ? ` (${u.dept})` : ""}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">물품</label>
                <select value={histMaterial} onChange={e => setHistMaterial(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 text-xs">
                  <option value="">전체</option>
                  {materialOptions.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>
            {(histUserId || histMaterial || histType !== "all" || histFrom !== monthAgoIso || histTo !== todayIso) && (
              <div className="flex justify-end">
                <button type="button" onClick={() => {
                  setHistFrom(monthAgoIso); setHistTo(todayIso); setHistType("all");
                  setHistUserId(""); setHistMaterial("");
                }} className="text-[11px] text-blue-600 hover:underline">필터 초기화</button>
              </div>
            )}
          </div>

          <div className="px-6 py-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 자재별 집계 */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200">자재별 불출 집계</h3>
                <span className="text-[11px] text-gray-400">{materialAgg.length}종</span>
              </div>
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
                    <tr className="text-center text-[11px] font-bold text-gray-600 dark:text-gray-300">
                      <th className="px-3 py-2.5">자재</th>
                      <th className="px-3 py-2.5">불출수량</th>
                      <th className="px-3 py-2.5">수령자수</th>
                      <th className="px-3 py-2.5">최종일</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {materialAgg.length === 0 ? (
                      <tr><td colSpan={4} className="text-center py-8 text-gray-400">데이터 없음</td></tr>
                    ) : materialAgg.map(m => (
                      <tr key={m.id} className="text-center">
                        <td className="px-3 py-2 text-gray-800 dark:text-gray-200 font-medium">{m.name} <span className="font-mono text-gray-400 ml-1">{m.id}</span></td>
                        <td className="px-3 py-2 text-orange-600 dark:text-orange-400 font-bold">{fmtNum(m.qty)}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{m.recipientCount}</td>
                        <td className="px-3 py-2 text-gray-500 font-mono">{m.lastDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 수령 이력 */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200">수령 이력</h3>
                <span className="text-[11px] text-gray-400">{filteredHistory.length}건</span>
              </div>
              <div className="max-h-[60vh] overflow-y-auto p-3 space-y-2">
                {filteredHistory.length === 0 ? (
                  <div className="text-center py-8 text-xs text-gray-400">조건에 맞는 이력이 없습니다.</div>
                ) : filteredHistory.map(r => (
                  <div key={r.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        r.request_type === "근무복" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                                                   : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      }`}>{r.request_type}</span>
                      <span className="text-gray-700 dark:text-gray-200 font-bold">{r.user_name}</span>
                      {r.user_dept && <span className="text-gray-400">({r.user_dept})</span>}
                      <span className="ml-auto text-gray-400 font-mono">{(r.received_at ?? "").slice(0, 10)}</span>
                    </div>
                    <div className="text-gray-700 dark:text-gray-300">
                      {r.items.map(it => (
                        <span key={it.id} className="mr-3">
                          {it.category_label && <span className="text-gray-400">[{it.category_label}]</span>} {it.material_name}
                          {it.size && <span className="text-gray-500"> ({it.size})</span>} ×{fmtNum(it.qty)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 직접 불출 탭 */}
      {tab === "issue" && (
        <UniformSafetyDirectIssueTab
          users={users}
          materials={materials}
          subLabels={subLabels}
          canUpdate={canUpdate}
          onCompleted={load}
        />
      )}
    </div>
  );
}

// ============================================================
// 신청 카드
// ============================================================

function RequestCard({
  row, processingId, canUpdate, onChange,
}: {
  row: ReqRow;
  processingId: number | null;
  canUpdate: boolean;
  onChange: (row: ReqRow, status: Status, opts?: { reason?: string }) => void;
}) {
  const busy = processingId === row.id;

  function cancel() {
    const reason = prompt("취소 사유를 입력하세요 (선택):", "");
    if (reason === null) return;
    onChange(row, "취소", { reason });
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
          row.request_type === "근무복" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                                       : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
        }`}>{row.request_type}</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
          row.status === "수령완료" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
          : row.status === "처리중"  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
          : row.status === "취소"    ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300"
          :                            "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300"
        }`}>{row.status}</span>
        <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{row.user_name}</span>
        {row.user_dept && <span className="text-xs text-gray-400">({row.user_dept})</span>}
        <span className="ml-auto text-[11px] text-gray-400 font-mono">신청 {row.requested_at.slice(0, 16).replace("T", " ")}</span>
      </div>

      <div className="bg-gray-50 dark:bg-gray-700/30 rounded p-2 text-xs space-y-1">
        {row.items.map(it => (
          <div key={it.id} className="flex items-center gap-2">
            <span className="text-gray-400 w-12 shrink-0">{it.category_label}</span>
            <span className="font-medium text-gray-800 dark:text-gray-200">{it.material_name}</span>
            <span className="font-mono text-gray-400 text-[11px]">{it.material_id}</span>
            {it.size && <span className="text-blue-600 dark:text-blue-400 font-bold">사이즈 {it.size}</span>}
            <span className="ml-auto font-bold text-orange-600 dark:text-orange-400">×{fmtNum(it.qty)}</span>
          </div>
        ))}
      </div>

      {row.note && (
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">📝 {row.note}</div>
      )}

      {(row.processed_at || row.received_at) && (
        <div className="mt-2 text-[11px] text-gray-400">
          {row.processed_at && <>처리 {row.processed_at.slice(0, 16).replace("T", " ")} ({row.processor_name}) </>}
          {row.received_at  && <>· 수령완료 {row.received_at.slice(0, 16).replace("T", " ")}</>}
        </div>
      )}

      {canUpdate && (row.status === "신청" || row.status === "처리중") && (
        <div className="mt-3 flex gap-2 justify-end">
          {row.status === "신청" && (
            <button type="button" disabled={busy} onClick={() => onChange(row, "처리중")}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 disabled:opacity-50">
              📦 출고등록 (처리중)
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => onChange(row, "수령완료")}
            className="px-3 py-1.5 rounded text-xs font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
            ✓ {row.status === "신청" ? "출고+수령완료" : "수령완료"}{row.request_type === "근무복" ? " (사이즈 동기화)" : ""}
          </button>
          <button type="button" disabled={busy} onClick={cancel}
            className="px-3 py-1.5 rounded text-xs font-semibold bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300 hover:bg-red-100 disabled:opacity-50">
            취소
          </button>
        </div>
      )}
    </div>
  );
}
