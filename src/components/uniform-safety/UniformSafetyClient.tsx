"use client";

import { useEffect, useState } from "react";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import DraggableModal from "@/components/common/DraggableModal";
import { fmtNum } from "@/lib/format";

// ============================================================
// 타입
// ============================================================

interface MaterialMini {
  id: string;
  name: string;
  unit: string | null;
  model_no: string | null;
}

interface ReqItem {
  id: number;
  material_id: string;
  material_name: string;
  category_label: string | null;
  size: string | null;
  qty: number;
}

interface ReqRow {
  id: number;
  request_type: "근무복" | "안전장구";
  status: "신청" | "처리중" | "수령완료" | "취소";
  user_id: number;
  user_name: string;
  user_dept: string | null;
  note: string | null;
  requested_at: string;
  processed_at: string | null;
  processor_name: string | null;
  received_at: string | null;
  items: ReqItem[];
}

type Tab = "uniform" | "safety";

interface UniformSlot {
  category: "상의" | "하의";
  enabled: boolean;
  sub_code: string;       // 소분류 코드 (품목 선택)
  material_id: string;    // 소분류 안의 자재 선택
  size: string;
  qty: number;
}

interface SafetyLine {
  key: string;            // local React key
  sub_code: string;       // 소분류 코드 (품목 선택)
  material_id: string;    // 소분류 안의 자재 선택
  qty: number;
}

// ============================================================
// 자재 풀: 근무복=D990201부터(D9902%), 안전장구=D990301부터(D9903%)
// ============================================================

// 소분류 코드 추출: D9902XX____ → "XX"
function subCodeOf(id: string): string {
  return id.length >= 7 ? id.substring(5, 7) : "";
}

// ============================================================
// 메인
// ============================================================

export default function UniformSafetyClient() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("uniform");

  // 자재 풀 (탭별 분리)
  const [uniformList, setUniformList] = useState<MaterialMini[]>([]); // 근무복: D9902
  const [safetyList,  setSafetyList]  = useState<MaterialMini[]>([]); // 안전장구: D9903
  // 소분류 라벨 맵: subCode → label (탭별)
  const [uniformSubLabels, setUniformSubLabels] = useState<Map<string, string>>(new Map());
  const [safetySubLabels,  setSafetySubLabels]  = useState<Map<string, string>>(new Map());
  const [matLoading, setMatLoading] = useState(true);

  // 사용자 프로필 사이즈
  const [topSize, setTopSize]       = useState("");
  const [bottomSize, setBottomSize] = useState("");

  // 근무복 슬롯
  const [slots, setSlots] = useState<UniformSlot[]>([
    { category: "상의", enabled: false, sub_code: "", material_id: "", size: "", qty: 1 },
    { category: "하의", enabled: false, sub_code: "", material_id: "", size: "", qty: 1 },
  ]);

  // 안전장구 라인
  const [lines, setLines] = useState<SafetyLine[]>([
    { key: crypto.randomUUID(), sub_code: "", material_id: "", qty: 1 },
  ]);

  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 본인 신청 이력 (조회는 본인만, 수정/삭제는 본인 신청 + 신청 상태일 때 / 관리자는 모두)
  const [myRequests, setMyRequests] = useState<ReqRow[]>([]);
  // 신청 이력 필터
  const [historyTypeFilter, setHistoryTypeFilter] = useState<"all" | "근무복" | "안전장구">("all");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<"all" | "신청" | "처리중" | "수령완료" | "취소">("all");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo,   setHistoryDateTo]   = useState("");
  const [historyMaterialFilter, setHistoryMaterialFilter] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const HISTORY_PAGE_SIZE = 10;
  // 자재별 마지막 수령일 맵 (본인 기준)
  const [lastReceivedMap, setLastReceivedMap] = useState<Map<string, string>>(new Map());
  // 수정/삭제 상태
  const [editing, setEditing] = useState<ReqRow | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // ============================================================
  // 초기 로드
  // ============================================================

  async function reloadRequests() {
    if (!user) return;
    const { data } = await supabase.from("uniform_safety_requests")
      .select("*, items:uniform_safety_request_items(*)")
      .eq("user_id", user.id)
      .order("requested_at", { ascending: false })
      .limit(200);
    const reqs = (data ?? []) as ReqRow[];
    setMyRequests(reqs);
    // 본인 자재별 마지막 수령일 (자재 선택 시 힌트로 사용)
    const map = new Map<string, string>();
    for (const r of reqs) {
      if (r.status !== "수령완료" || !r.received_at) continue;
      for (const it of r.items ?? []) {
        const prev = map.get(it.material_id);
        if (!prev || prev < r.received_at) map.set(it.material_id, r.received_at);
      }
    }
    setLastReceivedMap(map);
  }

  useEffect(() => {
    if (!user) return;
    (async () => {
      setMatLoading(true);
      // 코드체계: 99|02 = 근무복 / 99|03 = 안전용품(개인안전장구) / 99|04 = 소모품
      const [uniRes, safRes, uniSubRes, safSubRes, userRes] = await Promise.all([
        supabase.from("materials").select("id, name, unit, model_no").like("id", "D9902%").order("id"),
        supabase.from("materials").select("id, name, unit, model_no").like("id", "D9903%").order("id"),
        supabase.from("categories").select("code, label").eq("level", "sub").eq("major_code", "99").eq("mid_code", "02"),
        supabase.from("categories").select("code, label").eq("level", "sub").eq("major_code", "99").eq("mid_code", "03"),
        supabase.from("accounts").select("uniform_top_size, uniform_bottom_size").eq("id", user.id).single(),
      ]);
      const unis = (uniRes.data ?? []) as MaterialMini[];
      const safs = (safRes.data ?? []) as MaterialMini[];
      const uMap = new Map<string, string>();
      ((uniSubRes.data ?? []) as {code: string; label: string}[]).forEach(r => uMap.set(r.code, r.label));
      const sMap = new Map<string, string>();
      ((safSubRes.data ?? []) as {code: string; label: string}[]).forEach(r => sMap.set(r.code, r.label));
      console.log(`[uniform-safety] 근무복(D9902) ${unis.length}건/${uMap.size}소분류, 안전장구(D9903) ${safs.length}건/${sMap.size}소분류`);
      setUniformList(unis);
      setSafetyList(safs);
      setUniformSubLabels(uMap);
      setSafetySubLabels(sMap);
      if (userRes.data) {
        setTopSize(userRes.data.uniform_top_size ?? "");
        setBottomSize(userRes.data.uniform_bottom_size ?? "");
        setSlots(prev => prev.map(s =>
          s.category === "상의" ? { ...s, size: userRes.data!.uniform_top_size    ?? "" } :
          s.category === "하의" ? { ...s, size: userRes.data!.uniform_bottom_size ?? "" } : s
        ));
      }
      await reloadRequests();
      setMatLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 필터 변경 시 페이지 초기화
  useEffect(() => {
    setHistoryPage(1);
  }, [historyTypeFilter, historyStatusFilter, historyDateFrom, historyDateTo, historyMaterialFilter]);

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  // 본인 신청 페이지이므로 로그인된 모든 사용자가 신청 가능 (별도 메뉴 권한 불요)
  const canCreate = true;
  const admin = isAdmin(user);

  // ============================================================
  // 자재 그룹: 소분류별로 첫 자재만 대표로 사용 (소분류명만 표시)
  // ============================================================

  // 소분류 단위로 자재를 그룹핑하여 <optgroup>+<option> 으로 렌더하기 위한 데이터.
  // - groupLabel: 소분류 라벨 (categories 의 label, 없으면 'sub-{subCode}' placeholder)
  // - materials: 해당 소분류에 속한 자재 전체. 같은 소분류라도 자재가 여러 개면 모두 노출.
  // - 자재가 없는 소분류는 비어있는 표시(선택 불가)로 한 줄 차지.
  function buildSubGroups(
    list: MaterialMini[],
    subLabels: Map<string, string>,
  ): Array<{ subCode: string; groupLabel: string; materials: MaterialMini[] }> {
    // sub code → 자재 목록
    const bySub = new Map<string, MaterialMini[]>();
    for (const m of list) {
      const s = subCodeOf(m.id);
      const arr = bySub.get(s) ?? [];
      arr.push(m);
      bySub.set(s, arr);
    }
    // 소분류 라벨이 비어있는 환경: 자재가 있는 sub code 만 노출 (라벨은 자재명 첫 항목 사용)
    if (subLabels.size === 0) {
      return Array.from(bySub.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([s, materials]) => ({ subCode: s, groupLabel: materials[0]?.name ?? `sub-${s}`, materials }));
    }
    // categories 라벨이 있는 환경: 라벨 기준 정렬, '99'(기타) 는 제외
    return Array.from(subLabels.entries())
      .filter(([s]) => s !== "99")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([s, label]) => ({ subCode: s, groupLabel: label, materials: bySub.get(s) ?? [] }));
  }

  const uniformGroups = buildSubGroups(uniformList, uniformSubLabels);
  const safetyGroups  = buildSubGroups(safetyList,  safetySubLabels);

  // ============================================================
  // 핸들러
  // ============================================================

  function updateSlot(idx: number, patch: Partial<UniformSlot>) {
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }

  function updateLine(idx: number, patch: Partial<SafetyLine>) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }

  async function submit() {
    setMessage(null);
    if (!canCreate || !user) { setMessage({ type: "error", text: "신청 권한이 없습니다." }); return; }

    let payloadItems: Array<{material_id: string; material_name: string; category_label: string; size: string | null; qty: number; sort_order: number}> = [];

    if (tab === "uniform") {
      const enabled = slots.filter(s => s.enabled);
      if (enabled.length === 0) { setMessage({ type: "error", text: "신청할 항목을 1개 이상 체크하세요." }); return; }
      for (const s of enabled) {
        if (!s.material_id) { setMessage({ type: "error", text: `${s.category}: 자재를 선택하세요.` }); return; }
        if (s.qty < 1) { setMessage({ type: "error", text: `${s.category}: 수량은 1 이상이어야 합니다.` }); return; }
      }
      payloadItems = enabled.map((s, i) => {
        const m = uniformList.find(x => x.id === s.material_id);
        return {
          material_id: s.material_id,
          material_name: m?.name ?? "",
          category_label: s.category,
          size: s.size || null,
          qty: s.qty,
          sort_order: (i + 1) * 10,
        };
      });
    } else {
      const valid = lines.filter(l => l.material_id.trim());
      if (valid.length === 0) { setMessage({ type: "error", text: "신청할 안전장구를 1개 이상 선택하세요." }); return; }
      for (const l of valid) {
        if (l.qty < 1) { setMessage({ type: "error", text: "수량은 1 이상이어야 합니다." }); return; }
      }
      payloadItems = valid.map((l, i) => {
        const m = safetyList.find(x => x.id === l.material_id);
        const subLabel = safetySubLabels.get(subCodeOf(l.material_id));
        return {
          material_id: l.material_id,
          material_name: m?.name ?? "",
          category_label: subLabel ?? "안전장구",
          size: null,
          qty: l.qty,
          sort_order: (i + 1) * 10,
        };
      });
    }

    setSaving(true);
    try {
      const { data: header, error: e1 } = await supabase.from("uniform_safety_requests").insert({
        request_type: tab === "uniform" ? "근무복" : "안전장구",
        user_id: user.id,
        user_name: user.name,
        user_dept: user.dept ?? null,
        note: note.trim() || null,
      }).select().single();
      if (e1 || !header) throw e1 || new Error("신청 생성 실패");

      const { error: e2 } = await supabase.from("uniform_safety_request_items").insert(
        payloadItems.map(p => ({ ...p, request_id: header.id }))
      );
      if (e2) throw e2;

      setMessage({ type: "success", text: "신청이 등록되었습니다." });
      // 폼 리셋
      if (tab === "uniform") {
        setSlots(prev => prev.map(s => ({ ...s, enabled: false, sub_code: "", material_id: "", qty: 1 })));
      } else {
        setLines([{ key: crypto.randomUUID(), sub_code: "", material_id: "", qty: 1 }]);
      }
      setNote("");

      // 이력 다시 로드
      await reloadRequests();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function deleteRequest(row: ReqRow) {
    if (!user) return;
    if (!confirm(`신청 [${row.request_type} / ${row.requested_at.slice(0, 16).replace("T", " ")}]을(를) 삭제하시겠습니까?\n\n· 신청 본문과 항목이 모두 삭제됩니다.\n· 복구할 수 없습니다.`)) return;
    setDeletingId(row.id);
    try {
      const { error } = await supabase.from("uniform_safety_requests").delete().eq("id", row.id);
      if (error) throw error;
      await reloadRequests();
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeletingId(null);
    }
  }

  // ============================================================
  // 렌더
  // ============================================================

  const labelCls   = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1";
  const inputCls   = "w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100";
  const sectionCls = "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5";

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">근무복 · 개인안전장구 신청</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">근무복은 개인정보의 사이즈를 자동 적용하며 수령완료 시 사이즈가 갱신됩니다.</p>
      </div>

      {/* 탭 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 flex gap-1">
        {([["uniform","🦺 근무복"],["safety","🛡️ 개인안전장구"]] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => { setTab(t); setMessage(null); }}
            className={`py-2.5 px-4 text-sm font-semibold border-b-2 transition-colors ${
              tab === t ? "text-blue-600 dark:text-blue-400 border-blue-500"
                       : "text-gray-500 dark:text-gray-400 border-transparent"
            }`}>{label}</button>
        ))}
      </div>

      <div className="p-6 space-y-4 max-w-3xl">
        {/* 근무복 탭 */}
        {tab === "uniform" && (
          <div className={sectionCls}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">근무복 신청 항목</h2>
              <span className="text-[11px] text-gray-500">{matLoading ? "로딩 중..." : `자재 ${uniformList.length}건`}</span>
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
              현재 등록된 사이즈: 상의 <span className="font-bold">{topSize || "-"}</span> · 하의 <span className="font-bold">{bottomSize || "-"}</span>
            </div>
            {!matLoading && uniformList.length === 0 && (
              <div className="mb-3 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
                ⚠ 등록된 근무복 자재가 없습니다 (대분류 99 / 중분류 02). 자재품목 관리에서 먼저 등록해주세요.
              </div>
            )}
            <div className="space-y-3">
              {slots.map((s, i) => {
                const lastRecv = s.material_id ? lastReceivedMap.get(s.material_id) : null;
                // 상의: '하의'·'바지' 포함 라벨 제외 / 하의: '하의'·'바지' 포함 라벨만
                const isBottom = (label: string) => /하의|바지/.test(label);
                const slotGroups = s.category === "상의"
                  ? uniformGroups.filter(g => !isBottom(g.groupLabel))
                  : uniformGroups.filter(g =>  isBottom(g.groupLabel));
                const slotMaterials = s.sub_code
                  ? (slotGroups.find(g => g.subCode === s.sub_code)?.materials ?? [])
                  : [];
                return (
                  <div key={s.category} className={`rounded-lg border p-3 transition-colors ${s.enabled ? "border-blue-300 bg-blue-50/40 dark:bg-blue-900/10" : "border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-700/30"}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <input type="checkbox" id={`slot-${i}`} checked={s.enabled}
                        onChange={e => updateSlot(i, { enabled: e.target.checked })}
                        className="w-4 h-4 rounded accent-blue-600 cursor-pointer" />
                      <label htmlFor={`slot-${i}`} className="text-sm font-bold text-gray-800 dark:text-gray-100 cursor-pointer">{s.category}</label>
                      <span className="text-[11px] text-gray-400">(체크 후 신청 항목 입력)</span>
                      {lastRecv && <span className="ml-auto text-[11px] text-gray-500">최근 수령: {lastRecv.slice(0, 10)}</span>}
                    </div>
                    <div className={`grid grid-cols-1 sm:grid-cols-4 gap-2 mt-2 ${!s.enabled ? "opacity-50 pointer-events-none" : ""}`}>
                      <div>
                        <label className={labelCls}>품목</label>
                        <select value={s.sub_code}
                          onChange={e => updateSlot(i, { sub_code: e.target.value, material_id: "" })}
                          disabled={!s.enabled} className={inputCls}>
                          <option value="">{slotGroups.length === 0 ? "(소분류 없음)" : "선택"}</option>
                          {slotGroups.map(g => (
                            <option key={g.subCode} value={g.subCode}>{g.groupLabel}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>자재</label>
                        <select value={s.material_id}
                          onChange={e => updateSlot(i, { material_id: e.target.value })}
                          disabled={!s.enabled || !s.sub_code} className={inputCls}>
                          <option value="">
                            {!s.sub_code ? "품목 먼저 선택" : (slotMaterials.length === 0 ? "(자재 미등록)" : "자재 선택")}
                          </option>
                          {slotMaterials.map(m => (
                            <option key={m.id} value={m.id}>
                              {m.name}{m.model_no ? ` / ${m.model_no}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>사이즈</label>
                        <input type="text" value={s.size} onChange={e => updateSlot(i, { size: e.target.value })} disabled={!s.enabled} lang="ko"
                          placeholder="예: 95, L, 270" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>수량</label>
                        <input type="number" min={1} value={s.qty} onChange={e => updateSlot(i, { qty: Math.max(1, parseInt(e.target.value) || 1) })} disabled={!s.enabled} className={inputCls} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 안전장구 탭 */}
        {tab === "safety" && (
          <div className={sectionCls}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">개인안전장구 신청</h2>
                <span className="text-[11px] text-gray-500">{matLoading ? "로딩 중..." : `자재 ${safetyList.length}건`}</span>
              </div>
              <button type="button" onClick={() => setLines(prev => [...prev, { key: crypto.randomUUID(), sub_code: "", material_id: "", qty: 1 }])}
                className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">+ 항목 추가</button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => {
                const lastRecv = l.material_id ? lastReceivedMap.get(l.material_id) : null;
                const lineMaterials = l.sub_code
                  ? (safetyGroups.find(g => g.subCode === l.sub_code)?.materials ?? [])
                  : [];
                return (
                  <div key={l.key} className="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-700/30 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[11px] font-bold text-gray-500">#{i + 1}</div>
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-[11px] text-red-500">삭제</button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <div>
                        <label className={labelCls}>품목 *</label>
                        <select value={l.sub_code}
                          onChange={e => updateLine(i, { sub_code: e.target.value, material_id: "" })}
                          className={inputCls}>
                          <option value="">{safetyGroups.length === 0 ? "(소분류 없음)" : "선택"}</option>
                          {safetyGroups.map(g => (
                            <option key={g.subCode} value={g.subCode}>{g.groupLabel}</option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className={labelCls}>자재 *</label>
                        <select value={l.material_id}
                          onChange={e => updateLine(i, { material_id: e.target.value })}
                          disabled={!l.sub_code} className={inputCls}>
                          <option value="">
                            {!l.sub_code ? "품목 먼저 선택" : (lineMaterials.length === 0 ? "(자재 미등록)" : "자재 선택")}
                          </option>
                          {lineMaterials.map(m => (
                            <option key={m.id} value={m.id}>
                              {m.name}{m.model_no ? ` / ${m.model_no}` : ""}
                            </option>
                          ))}
                        </select>
                        {lastRecv && <div className="text-[11px] text-gray-500 mt-1">최근 수령: {lastRecv.slice(0, 10)}</div>}
                      </div>
                      <div>
                        <label className={labelCls}>수량 *</label>
                        <input type="number" min={1} value={l.qty} onChange={e => updateLine(i, { qty: Math.max(1, parseInt(e.target.value) || 1) })} className={inputCls} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {matLoading && <div className="mt-3 text-xs text-gray-500">자재 정보 로딩 중...</div>}
            {!matLoading && safetyList.length === 0 && (
              <div className="mt-3 text-xs text-amber-600 dark:text-amber-400">⚠ 등록된 안전장구 자재가 없습니다 (대분류 99 / 중분류 03). 자재품목 관리에서 먼저 등록해주세요.</div>
            )}
          </div>
        )}

        {/* 비고 + 제출 */}
        <div className={sectionCls}>
          <label className={labelCls}>비고 (신청 사유 / 기타 참고 사항)</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} lang="ko"
            placeholder="신청 사유나 참고 사항을 자유롭게 입력하세요"
            className={inputCls + " resize-none"} />

          {message && (
            <div className={`mt-3 text-xs px-3 py-2 rounded ${
              message.type === "success" ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                         : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
            }`}>{message.text}</div>
          )}

          <div className="mt-4 flex justify-end">
            <button type="button" onClick={submit} disabled={saving}
              className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving ? "신청 중..." : "신청하기"}
            </button>
          </div>
        </div>

        {/* 내 신청 이력 (본인 신청만 조회 / 신청 상태일 때 본인은 수정·삭제 가능, 관리자는 모두) */}
        <div className={sectionCls}>
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">내 신청 이력</h2>
          {/* 필터: 기간 / 구분 / 상태 / 품목 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-1">시작일</label>
              <input type="date" value={historyDateFrom} onChange={e => setHistoryDateFrom(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-1">종료일</label>
              <input type="date" value={historyDateTo} onChange={e => setHistoryDateTo(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-1">구분</label>
              <select value={historyTypeFilter} onChange={e => setHistoryTypeFilter(e.target.value as typeof historyTypeFilter)}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                <option value="all">전체</option>
                <option value="근무복">근무복</option>
                <option value="안전장구">안전장구</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-1">상태</label>
              <select value={historyStatusFilter} onChange={e => setHistoryStatusFilter(e.target.value as typeof historyStatusFilter)}
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                <option value="all">전체</option>
                <option value="신청">신청</option>
                <option value="처리중">처리중</option>
                <option value="수령완료">수령완료</option>
                <option value="취소">취소</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-1">품목</label>
              {(() => {
                // 신청 이력에서 품목 옵션 생성 (material_id 단위, 라벨은 자재명)
                const map = new Map<string, string>();
                for (const r of myRequests) {
                  for (const it of r.items ?? []) {
                    if (!map.has(it.material_id)) map.set(it.material_id, it.material_name);
                  }
                }
                const opts = Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
                return (
                  <select value={historyMaterialFilter} onChange={e => setHistoryMaterialFilter(e.target.value)}
                    className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                    <option value="">전체</option>
                    {opts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                );
              })()}
            </div>
          </div>
          {(historyDateFrom || historyDateTo || historyMaterialFilter || historyTypeFilter !== "all" || historyStatusFilter !== "all") && (
            <div className="mb-2 flex justify-end">
              <button type="button" onClick={() => {
                setHistoryDateFrom(""); setHistoryDateTo(""); setHistoryMaterialFilter("");
                setHistoryTypeFilter("all"); setHistoryStatusFilter("all");
              }} className="text-[11px] text-blue-600 hover:underline">필터 초기화</button>
            </div>
          )}
          {(() => {
            const list = myRequests
              .filter(r => historyTypeFilter === "all" ? true : r.request_type === historyTypeFilter)
              .filter(r => historyStatusFilter === "all" ? true : r.status === historyStatusFilter)
              .filter(r => {
                const d = r.requested_at.slice(0, 10);
                if (historyDateFrom && d < historyDateFrom) return false;
                if (historyDateTo   && d > historyDateTo)   return false;
                return true;
              })
              .filter(r => {
                if (!historyMaterialFilter) return true;
                return (r.items ?? []).some(it => it.material_id === historyMaterialFilter);
              });
            if (list.length === 0) {
              return <div className="text-center py-6 text-xs text-gray-400">조건에 맞는 신청이 없습니다.</div>;
            }
            const totalPages = Math.max(1, Math.ceil(list.length / HISTORY_PAGE_SIZE));
            const safePage = Math.min(historyPage, totalPages);
            const start = (safePage - 1) * HISTORY_PAGE_SIZE;
            const pageList = list.slice(start, start + HISTORY_PAGE_SIZE);
            return (
              <>
                <div className="mb-2 text-[11px] text-gray-500">
                  총 {list.length}건 · {safePage}/{totalPages} 페이지 ({start + 1}~{Math.min(start + HISTORY_PAGE_SIZE, list.length)})
                </div>
                <div className="space-y-2">
                  {pageList.map(r => {
                    // 본인 + 처리 시작 전(신청) 이거나, 관리자
                    const canModify = r.status === "신청" || admin;
                    return (
                    <div key={r.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-xs">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          r.request_type === "근무복" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                                                      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        }`}>{r.request_type}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          r.status === "수령완료" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                          : r.status === "처리중"  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                          : r.status === "취소"    ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300"
                          :                          "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                        }`}>{r.status}</span>
                        <span className="text-gray-400 ml-auto font-mono">{r.requested_at.slice(0, 16).replace("T", " ")}</span>
                      </div>
                      <div className="text-gray-700 dark:text-gray-300">
                        {(r.items ?? []).map(it => (
                          <span key={it.id} className="mr-3">
                            {it.category_label && <span className="text-gray-400">[{it.category_label}]</span>} {it.material_name}
                            {it.size && <span className="text-gray-500"> ({it.size})</span>} ×{fmtNum(it.qty)}
                          </span>
                        ))}
                      </div>
                      {r.note && <div className="mt-1 text-gray-500">📝 {r.note}</div>}
                      {r.received_at && <div className="mt-1 text-green-600 dark:text-green-400 text-[11px]">✓ 수령완료: {r.received_at.slice(0, 16).replace("T", " ")}</div>}
                      {canModify && (
                        <div className="mt-2 flex gap-2 justify-end">
                          <button type="button" onClick={() => setEditing(r)}
                            className="px-3 py-1 rounded text-[11px] font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200">
                            ✏️ 수정
                          </button>
                          <button type="button" disabled={deletingId === r.id}
                            onClick={() => deleteRequest(r)}
                            className="px-3 py-1 rounded text-[11px] font-semibold bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 hover:bg-red-100 disabled:opacity-50">
                            {deletingId === r.id ? "삭제 중..." : "🗑️ 삭제"}
                          </button>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
                {totalPages > 1 && (
                  <Pagination page={safePage} totalPages={totalPages} onChange={setHistoryPage} />
                )}
              </>
            );
          })()}
        </div>
      </div>

      {editing && (
        <EditModal
          request={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reloadRequests(); }}
        />
      )}
    </div>
  );
}

// ============================================================
// 수정 모달 — 항목 수량·사이즈, 비고 편집 / 항목 삭제 가능 (최소 1개 유지)
// ============================================================

interface EditableItem {
  id: number;
  material_id: string;
  material_name: string;
  category_label: string | null;
  size: string;
  qty: number;
  _deleted: boolean;
}

function EditModal({ request, onClose, onSaved }: {
  request: ReqRow;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [items, setItems] = useState<EditableItem[]>(
    (request.items ?? []).map(it => ({
      id: it.id,
      material_id: it.material_id,
      material_name: it.material_name,
      category_label: it.category_label,
      size: it.size ?? "",
      qty: it.qty,
      _deleted: false,
    }))
  );
  const [note, setNote] = useState(request.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isUniform = request.request_type === "근무복";
  const remainingCount = items.filter(it => !it._deleted).length;

  function toggleDelete(id: number) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, _deleted: !it._deleted } : it));
  }
  function patch(id: number, p: Partial<EditableItem>) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...p } : it));
  }

  async function save() {
    setError("");
    if (remainingCount === 0) { setError("최소 1개 이상의 항목이 필요합니다. 전체 삭제는 카드의 [삭제] 버튼을 사용하세요."); return; }
    const alive = items.filter(it => !it._deleted);
    for (const it of alive) {
      if (it.qty < 1) { setError(`${it.material_name}: 수량은 1 이상이어야 합니다.`); return; }
    }
    setSaving(true);
    try {
      // 1) 비고 업데이트
      const { error: e1 } = await supabase.from("uniform_safety_requests").update({ note: note.trim() || null }).eq("id", request.id);
      if (e1) throw e1;
      // 2) 삭제 표시된 항목 제거
      const toDelete = items.filter(it => it._deleted).map(it => it.id);
      if (toDelete.length > 0) {
        const { error: e2 } = await supabase.from("uniform_safety_request_items").delete().in("id", toDelete);
        if (e2) throw e2;
      }
      // 3) 남은 항목들 qty/size 업데이트 (변경 여부 무관하게 모두 update — 단순함 우선)
      for (const it of alive) {
        const { error: e3 } = await supabase.from("uniform_safety_request_items").update({
          qty: it.qty,
          size: isUniform ? (it.size || null) : null,
        }).eq("id", it.id);
        if (e3) throw e3;
      }
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-full max-w-2xl max-h-[90vh]"
      header={
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <div className="text-base font-bold text-gray-900 dark:text-white">신청 수정 [{request.request_type}]</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {request.user_name}{request.user_dept ? ` (${request.user_dept})` : ""} · {request.requested_at.slice(0, 16).replace("T", " ")}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
      }
    >
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="text-[11px] font-bold text-gray-600 dark:text-gray-300">신청 항목 ({remainingCount}개)</div>
          {items.map(it => (
            <div key={it.id} className={"rounded-lg border p-3 " + (it._deleted
              ? "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10 opacity-60"
              : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30")}>
              <div className="flex items-center gap-2 mb-2">
                {it.category_label && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200">{it.category_label}</span>}
                <span className="text-xs font-bold text-gray-800 dark:text-gray-100">{it.material_name}</span>
                <span className="font-mono text-[10px] text-gray-400">{it.material_id}</span>
                <button type="button" onClick={() => toggleDelete(it.id)}
                  className={"ml-auto text-[11px] " + (it._deleted ? "text-blue-600 hover:underline" : "text-red-500 hover:underline")}>
                  {it._deleted ? "↩ 되돌리기" : "🗑 항목 삭제"}
                </button>
              </div>
              {!it._deleted && (
                <div className="grid grid-cols-2 gap-2">
                  {isUniform && (
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1">사이즈</label>
                      <input type="text" value={it.size} onChange={e => patch(it.id, { size: e.target.value })}
                        placeholder="예: 95, L, 270"
                        className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 text-xs" />
                    </div>
                  )}
                  <div className={isUniform ? "" : "col-span-2"}>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1">수량</label>
                    <input type="number" min={1} value={it.qty}
                      onChange={e => patch(it.id, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                      className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 text-xs" />
                  </div>
                </div>
              )}
            </div>
          ))}

          <div>
            <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-300 mb-1">비고</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} lang="ko"
              placeholder="신청 사유나 참고 사항"
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 text-sm resize-none" />
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 text-xs px-3 py-2 rounded">{error}</div>
          )}
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

// ============================================================
// 페이지네이션 — 처음/이전/페이지번호(최대 5개)/다음/마지막
// ============================================================

function Pagination({ page, totalPages, onChange }: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pages: number[] = [];
  for (let i = start; i <= end; i++) pages.push(i);

  const btnCls = "px-2 py-1 rounded text-[11px] font-semibold border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="mt-3 flex items-center justify-center gap-1">
      <button type="button" disabled={page === 1} onClick={() => onChange(1)} className={btnCls}>«</button>
      <button type="button" disabled={page === 1} onClick={() => onChange(page - 1)} className={btnCls}>‹</button>
      {pages.map(p => (
        <button key={p} type="button" onClick={() => onChange(p)}
          className={p === page
            ? "px-2.5 py-1 rounded text-[11px] font-bold bg-blue-600 text-white"
            : btnCls}>
          {p}
        </button>
      ))}
      <button type="button" disabled={page === totalPages} onClick={() => onChange(page + 1)} className={btnCls}>›</button>
      <button type="button" disabled={page === totalPages} onClick={() => onChange(totalPages)} className={btnCls}>»</button>
    </div>
  );
}
