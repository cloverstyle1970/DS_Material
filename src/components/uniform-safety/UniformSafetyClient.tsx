"use client";

import { useEffect, useState } from "react";
import { useAuth, hasMenuPermission, isAdmin } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

const MENU_HREF = "/uniform-safety";

// ============================================================
// 타입
// ============================================================

interface MaterialMini {
  id: string;
  name: string;
  unit: string | null;
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
  note: string | null;
  requested_at: string;
  processed_at: string | null;
  processor_name: string | null;
  received_at: string | null;
  items: ReqItem[];
}

type Tab = "uniform" | "safety";

interface UniformSlot {
  category: "상의" | "하의" | "안전화";
  enabled: boolean;
  material_id: string;
  size: string;
  qty: number;
}

interface SafetyLine {
  key: string; // local React key
  material_id: string;
  qty: number;
}

// ============================================================
// 분류 코드 헬퍼
// ============================================================
// 자재 풀: D9903 (D990301부터) — 근무복·안전장구 공통

function subCode(id: string): string {
  // D9903XX____ → XX
  return id.length >= 7 ? id.substring(5, 7) : "";
}

// ============================================================
// 메인
// ============================================================

export default function UniformSafetyClient() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("uniform");

  // 자재 풀
  const [materials, setMaterials] = useState<MaterialMini[]>([]);
  const [matLoading, setMatLoading] = useState(true);

  // 사용자 프로필 사이즈
  const [topSize, setTopSize]       = useState("");
  const [bottomSize, setBottomSize] = useState("");
  const [shoesSize, setShoesSize]   = useState("");

  // 근무복 슬롯
  const [slots, setSlots] = useState<UniformSlot[]>([
    { category: "상의",  enabled: false, material_id: "", size: "", qty: 1 },
    { category: "하의",  enabled: false, material_id: "", size: "", qty: 1 },
    { category: "안전화", enabled: false, material_id: "", size: "", qty: 1 },
  ]);

  // 안전장구 라인
  const [lines, setLines] = useState<SafetyLine[]>([
    { key: crypto.randomUUID(), material_id: "", qty: 1 },
  ]);

  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 본인 이력
  const [myRequests, setMyRequests] = useState<ReqRow[]>([]);
  // 자재별 마지막 수령일 맵
  const [lastReceivedMap, setLastReceivedMap] = useState<Map<string, string>>(new Map());

  // ============================================================
  // 초기 로드
  // ============================================================

  useEffect(() => {
    if (!user) return;
    (async () => {
      setMatLoading(true);
      const [matRes, userRes, reqRes] = await Promise.all([
        supabase.from("materials").select("id, name, unit").like("id", "D9903%").order("id"),
        supabase.from("users").select("uniform_top_size, uniform_bottom_size, safety_shoes_size").eq("id", user.id).single(),
        supabase.from("uniform_safety_requests").select("*, items:uniform_safety_request_items(*)").eq("user_id", user.id).order("requested_at", { ascending: false }).limit(50),
      ]);
      const mats = (matRes.data ?? []) as MaterialMini[];
      console.log(`[uniform-safety] D9903 자재 ${mats.length}건 로드`, matRes.error || "");
      setMaterials(mats);
      if (userRes.data) {
        setTopSize(userRes.data.uniform_top_size ?? "");
        setBottomSize(userRes.data.uniform_bottom_size ?? "");
        setShoesSize(userRes.data.safety_shoes_size ?? "");
        setSlots(prev => prev.map(s =>
          s.category === "상의"   ? { ...s, size: userRes.data!.uniform_top_size    ?? "" } :
          s.category === "하의"   ? { ...s, size: userRes.data!.uniform_bottom_size ?? "" } :
          s.category === "안전화" ? { ...s, size: userRes.data!.safety_shoes_size   ?? "" } : s
        ));
      }
      const reqs = (reqRes.data ?? []) as ReqRow[];
      setMyRequests(reqs);

      // 자재별 마지막 수령일 (status=수령완료 만)
      const map = new Map<string, string>();
      for (const r of reqs) {
        if (r.status !== "수령완료" || !r.received_at) continue;
        for (const it of r.items ?? []) {
          const prev = map.get(it.material_id);
          if (!prev || prev < r.received_at) map.set(it.material_id, r.received_at);
        }
      }
      setLastReceivedMap(map);
      setMatLoading(false);
    })();
  }, [user]);

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  const admin = isAdmin(user);
  const canCreate = admin || hasMenuPermission(user, MENU_HREF, "create");

  // ============================================================
  // 자재 그룹
  // ============================================================

  // 근무복·안전장구 모두 D9903 전체 (sub 01부터)에서 선택
  const uniformList = materials.filter(m => subCode(m.id) >= "01");
  const safetyList  = materials.filter(m => subCode(m.id) >= "01");

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
    if (!canCreate) { setMessage({ type: "error", text: "신청 권한이 없습니다." }); return; }

    let payloadItems: Array<{material_id: string; material_name: string; category_label: string; size: string | null; qty: number; sort_order: number}> = [];

    if (tab === "uniform") {
      const enabled = slots.filter(s => s.enabled);
      if (enabled.length === 0) { setMessage({ type: "error", text: "신청할 항목을 1개 이상 체크하세요." }); return; }
      for (const s of enabled) {
        if (!s.material_id) { setMessage({ type: "error", text: `${s.category}: 자재를 선택하세요.` }); return; }
        if (s.qty < 1) { setMessage({ type: "error", text: `${s.category}: 수량은 1 이상이어야 합니다.` }); return; }
      }
      payloadItems = enabled.map((s, i) => {
        const m = materials.find(x => x.id === s.material_id);
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
        const m = materials.find(x => x.id === l.material_id);
        return {
          material_id: l.material_id,
          material_name: m?.name ?? "",
          category_label: "안전장구",
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
        setSlots(prev => prev.map(s => ({ ...s, enabled: false, material_id: "", qty: 1 })));
      } else {
        setLines([{ key: crypto.randomUUID(), material_id: "", qty: 1 }]);
      }
      setNote("");

      // 이력 다시 로드
      const reqRes = await supabase.from("uniform_safety_requests").select("*, items:uniform_safety_request_items(*)").eq("user_id", user.id).order("requested_at", { ascending: false }).limit(50);
      setMyRequests((reqRes.data ?? []) as ReqRow[]);
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
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
              현재 등록된 사이즈: 상의 <span className="font-bold">{topSize || "-"}</span> · 하의 <span className="font-bold">{bottomSize || "-"}</span> · 안전화 <span className="font-bold">{shoesSize || "-"}</span>
            </div>
            {!matLoading && uniformList.length === 0 && (
              <div className="mb-3 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
                ⚠ 등록된 D9903 분류 자재가 없습니다. 자재품목 관리에서 먼저 등록해주세요. (예: D990301XXXX_)
              </div>
            )}
            <div className="space-y-3">
              {slots.map((s, i) => {
                const list = uniformList;
                const lastRecv = s.material_id ? lastReceivedMap.get(s.material_id) : null;
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
                    <div className={`grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 ${!s.enabled ? "opacity-50 pointer-events-none" : ""}`}>
                      <div>
                        <label className={labelCls}>품목</label>
                        <select value={s.material_id} onChange={e => updateSlot(i, { material_id: e.target.value })} disabled={!s.enabled} className={inputCls}>
                          <option value="">{list.length === 0 ? "(자재 없음)" : "선택"}</option>
                          {list.map(m => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}
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
              <button type="button" onClick={() => setLines(prev => [...prev, { key: crypto.randomUUID(), material_id: "", qty: 1 }])}
                className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">+ 항목 추가</button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => {
                const lastRecv = l.material_id ? lastReceivedMap.get(l.material_id) : null;
                return (
                  <div key={l.key} className="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-700/30 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[11px] font-bold text-gray-500">#{i + 1}</div>
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-[11px] text-red-500">삭제</button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="sm:col-span-2">
                        <label className={labelCls}>품목 *</label>
                        <select value={l.material_id} onChange={e => updateLine(i, { material_id: e.target.value })} className={inputCls}>
                          <option value="">선택</option>
                          {safetyList.map(m => <option key={m.id} value={m.id}>{m.name} <span className="text-gray-400">({m.id})</span></option>)}
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
              <div className="mt-3 text-xs text-amber-600 dark:text-amber-400">⚠ 등록된 자재(D990301 이상)가 없습니다. 먼저 자재품목 관리에서 등록해주세요.</div>
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

        {/* 본인 신청 이력 */}
        <div className={sectionCls}>
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">내 신청 이력</h2>
          {myRequests.length === 0 ? (
            <div className="text-center py-6 text-xs text-gray-400">신청 이력이 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {myRequests.map(r => (
                <div key={r.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-xs">
                  <div className="flex items-center gap-2 mb-1.5">
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
                        {it.size && <span className="text-gray-500"> ({it.size})</span>} ×{it.qty}
                      </span>
                    ))}
                  </div>
                  {r.note && <div className="mt-1 text-gray-500">📝 {r.note}</div>}
                  {r.received_at && <div className="mt-1 text-green-600 dark:text-green-400 text-[11px]">✓ 수령완료: {r.received_at.slice(0, 16).replace("T", " ")}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
