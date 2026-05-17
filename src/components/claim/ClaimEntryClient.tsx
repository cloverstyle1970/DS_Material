"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api-client";
import { MaterialRecord } from "@/lib/mock-materials";
import { visibleUserIds } from "@/lib/crew";

const DEFAULT_ROW_COUNT = 5;

type ClaimMode = "유상견적요청" | "무상신청" | "당직선출고";

const MODES: { key: ClaimMode; label: string; icon: string; desc: string; color: string }[] = [
  { key: "유상견적요청", label: "유상 (견적요청)",   icon: "💰", desc: "견적 담당자가 견적서를 작성합니다.",         color: "bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300" },
  { key: "무상신청",     label: "무상 (자재신청)",    icon: "🆓", desc: "FM(Full Maintenance) 현장 등 무상 자재 신청.", color: "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300" },
  { key: "당직선출고",   label: "당직 (선출고)",      icon: "🌙", desc: "당직 중 즉시 출고 → 사후 견적요청 처리.",     color: "bg-purple-50 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300" },
];

interface SiteOption { id: number; name: string; alias?: string | null }

// ─── 본인 청구 이력 ─────────────────────────────────
type HistoryKind = "유상견적요청" | "무상신청" | "당직선출고";
interface HistoryRow {
  source: "quote_request" | "material_request";
  rowId: number;
  no: string | null;            // QR-YYYY-NNNN (유상견적요청만)
  date: string;                 // ISO
  siteName: string | null;
  workTitle: string | null;
  itemFirstName: string;
  itemCount: number;
  kind: HistoryKind;
  status: string;
  quoteId: number | null;       // 견적서로 연결된 ID (유상견적요청만)
}

const HIST_KIND_CLS: Record<HistoryKind, string> = {
  "유상견적요청": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "무상신청":     "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "당직선출고":   "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

function histStatusCls(status: string): string {
  if (status === "취소") return "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300";
  if (status === "완료" || status === "견적발행") return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
  if (status === "처리중" || status === "견적작성중") return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300";
  return "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200";
}

function fmtDT(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface ItemRow {
  key: string;
  material_id: string;
  material_name: string;
  spec: string;
  unit: string;
  qty: number;
  elevator_name: string;
  remark: string;
  searchOpen: boolean;
  searchResults: MaterialRecord[];
  searchFocusIndex: number;
}

function newRow(seed: Partial<ItemRow> = {}): ItemRow {
  return {
    key: crypto.randomUUID(),
    material_id: "", material_name: "", spec: "", unit: "EA",
    qty: 1, elevator_name: "", remark: "",
    searchOpen: false, searchResults: [], searchFocusIndex: -1,
    ...seed,
  };
}

export default function ClaimEntryClient() {
  const { user } = useAuth();
  const [mode, setMode] = useState<ClaimMode>("유상견적요청");

  // 헤더
  const [siteName, setSiteName] = useState("");
  const [workTitle, setWorkTitle] = useState("");
  const [reason, setReason]       = useState("");

  // 자재 라인
  const [rows, setRows] = useState<ItemRow[]>(() => Array.from({ length: DEFAULT_ROW_COUNT }, () => newRow()));

  // 자재 검색 매터타입 (기본 DS)
  const [matTypeFilter, setMatTypeFilter] = useState<"DS" | "TK" | "ALL">("DS");

  // 사이트/호기 마스터
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [elevatorOptions, setElevatorOptions] = useState<string[]>([]);
  const elevatorDatalistId = "claim-entry-elevator-options";

  // 저장 상태
  const [saving, setSaving]     = useState(false);
  const [message, setMessage]   = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 청구 이력 (본인)
  const [history, setHistory]   = useState<HistoryRow[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histKindFilter, setHistKindFilter] = useState<"전체" | HistoryKind>("전체");

  useEffect(() => {
    api.get<SiteOption[]>("/api/sites").then(setSites).catch(() => {});
  }, []);

  async function loadHistory() {
    if (!user) return;
    setHistLoading(true);
    const ids = await visibleUserIds(user);
    let qrQ = supabase.from("quote_requests")
      .select("id, request_no, requested_at, site_name, work_title, status, quote_id, quote_request_items(material_name)")
      .order("requested_at", { ascending: false })
      .limit(20);
    let mrQ = supabase.from("material_requests")
      .select("id, requested_at, site_name, items, note, request_type, status")
      .in("request_type", ["무상신청", "당직선출고"])  // 유상견적 자동생성분은 quote_requests 측에서 보임
      .order("requested_at", { ascending: false })
      .limit(20);
    if (ids) { qrQ = qrQ.in("requester_id", ids); mrQ = mrQ.in("requester_id", ids); }
    const [qr, mr] = await Promise.all([qrQ, mrQ]);
    const rows: HistoryRow[] = [];
    for (const r of (qr.data ?? []) as Array<{
      id: number; request_no: string; requested_at: string;
      site_name: string | null; work_title: string | null;
      status: string; quote_id: number | null;
      quote_request_items: { material_name: string }[] | null;
    }>) {
      const items = r.quote_request_items ?? [];
      rows.push({
        source: "quote_request", rowId: r.id, no: r.request_no,
        date: r.requested_at, siteName: r.site_name, workTitle: r.work_title,
        itemFirstName: items[0]?.material_name ?? "-",
        itemCount: items.length,
        kind: "유상견적요청", status: r.status, quoteId: r.quote_id,
      });
    }
    for (const r of (mr.data ?? []) as Array<{
      id: number; requested_at: string; site_name: string | null;
      items: { materialName?: string }[] | null;
      note: string | null; request_type: string; status: string;
    }>) {
      const items = r.items ?? [];
      const kind = r.request_type === "당직선출고" ? "당직선출고" : "무상신청";
      rows.push({
        source: "material_request", rowId: r.id, no: null,
        date: r.requested_at, siteName: r.site_name, workTitle: r.note,
        itemFirstName: items[0]?.materialName ?? "-",
        itemCount: items.length,
        kind, status: r.status, quoteId: null,
      });
    }
    rows.sort((a, b) => b.date.localeCompare(a.date));
    setHistory(rows.slice(0, 20));
    setHistLoading(false);
  }

  useEffect(() => { void loadHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  // 현장 변경 시 호기 + 계약구분 확인 → FM 자동 모드 권유
  useEffect(() => {
    if (!siteName.trim()) { setElevatorOptions([]); return; }
    (async () => {
      const [elev, site] = await Promise.all([
        supabase.from("elevators").select("unit_name").eq("site_name", siteName).order("unit_name"),
        supabase.from("sites").select("contract_type").eq("name", siteName).maybeSingle(),
      ]);
      setElevatorOptions((elev.data ?? []).map(e => (e as { unit_name: string }).unit_name).filter(Boolean));
      const ct = (site.data as { contract_type: string | null } | null)?.contract_type;
      if (ct && (ct === "TK-FM" || ct === "대솔FM" || ct === "DS-FM")) {
        setMode("무상신청");
      }
    })();
  }, [siteName]);

  function patchRow(key: string, patch: Partial<ItemRow>) {
    setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));
  }
  function addRow() { setRows(prev => [...prev, newRow()]); }
  function removeRow(key: string) { setRows(prev => prev.length === 1 ? prev : prev.filter(r => r.key !== key)); }

  async function searchMaterial(key: string, q: string) {
    if (!q.trim()) { patchRow(key, { searchResults: [], searchOpen: false, searchFocusIndex: -1 }); return; }
    try {
      const matParam = matTypeFilter === "ALL" ? "" : `&matType=${matTypeFilter}`;
      const data = await api.get<MaterialRecord[]>(`/api/materials?q=${encodeURIComponent(q)}${matParam}`);
      const sliced = data.slice(0, 12);
      patchRow(key, { searchResults: sliced, searchOpen: sliced.length > 0, searchFocusIndex: sliced.length === 1 ? 0 : -1 });
    } catch {
      patchRow(key, { searchResults: [], searchOpen: false, searchFocusIndex: -1 });
    }
  }
  function applyMaterial(key: string, m: MaterialRecord) {
    patchRow(key, {
      material_id: m.id, material_name: m.name, spec: m.modelNo ?? "",
      unit: m.unit ?? "EA",
      searchResults: [], searchOpen: false, searchFocusIndex: -1,
    });
  }

  async function generateRequestNo(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `QR-${year}-`;
    const { data } = await supabase.from("quote_requests")
      .select("request_no").like("request_no", `${prefix}%`)
      .order("request_no", { ascending: false }).limit(1);
    let nextSeq = 1;
    if (data && data.length > 0) {
      const last = (data[0] as { request_no: string }).request_no;
      const m = last.match(/-(\d+)$/);
      if (m) nextSeq = parseInt(m[1], 10) + 1;
    }
    return `${prefix}${String(nextSeq).padStart(4, "0")}`;
  }

  async function submit() {
    setMessage(null);
    if (!user) { setMessage({ type: "error", text: "로그인이 필요합니다." }); return; }
    if (!siteName.trim()) { setMessage({ type: "error", text: "현장명을 입력해 주세요." }); return; }
    const validItems = rows.filter(r => r.material_id || r.material_name.trim());
    if (validItems.length === 0) { setMessage({ type: "error", text: "자재를 1개 이상 입력해 주세요." }); return; }

    setSaving(true);
    try {
      if (mode === "유상견적요청") {
        const request_no = await generateRequestNo();
        const elevSet = Array.from(new Set(validItems.map(r => r.elevator_name.trim()).filter(Boolean)));
        const headerElev = elevSet.length === 0 ? null : elevSet.join(", ");
        const { data: hdr, error: e1 } = await supabase.from("quote_requests").insert({
          request_no,
          site_name:      siteName,
          elevator_name:  headerElev,
          work_title:     workTitle || null,
          reason:         reason || null,
          requester_id:   user.id,
          requester_name: user.name,
          requester_dept: user.dept ?? null,
        }).select().single();
        if (e1 || !hdr) throw e1 || new Error("견적요청 생성 실패");
        const { error: e2 } = await supabase.from("quote_request_items").insert(
          validItems.map((r, i) => ({
            quote_request_id: hdr.id,
            material_id:   r.material_id || null,
            material_name: r.material_name,
            spec:          r.spec || null,
            unit:          r.unit || null,
            qty:           r.qty,
            elevator_name: r.elevator_name || null,
            remark:        r.remark || null,
            sort_order:    (i + 1) * 10,
          }))
        );
        if (e2) throw e2;
        setMessage({ type: "success", text: `견적요청이 접수되었습니다. (${request_no})` });
      } else {
        // 무상신청 / 당직선출고 — material_requests 사용
        const items = validItems.map(r => ({
          materialId:    r.material_id,
          materialName:  r.material_name,
          qty:           r.qty,
          elevatorName:  r.elevator_name || null,
        }));
        const { error } = await supabase.from("material_requests").insert({
          status:         "신청",
          site_name:      siteName,
          items,
          note:           [workTitle, reason].filter(Boolean).join(" / ") || null,
          requester_id:   user.id,
          requester_name: user.name,
          requester_dept: user.dept ?? "",
          request_type:   mode,    // '무상신청' | '당직선출고'
        });
        if (error) throw error;
        const msg = mode === "당직선출고"
          ? "당직 선출고 신청이 접수되었습니다. 관리자가 즉시 출고 처리합니다."
          : "무상 자재신청이 접수되었습니다.";
        setMessage({ type: "success", text: msg });
      }
      // 폼 리셋
      setRows(Array.from({ length: DEFAULT_ROW_COUNT }, () => newRow()));
      setSiteName(""); setWorkTitle(""); setReason("");
      // 이력 즉시 갱신
      void loadHistory();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;

  const sectionCls = "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5";
  const labelCls   = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1";
  const inputCls   = "w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100";
  const cellInput  = "w-full px-2 py-1 text-xs text-gray-900 dark:text-gray-100 border-0 bg-transparent focus:outline-none focus:bg-yellow-50 dark:focus:bg-yellow-900/20 focus:ring-1 focus:ring-blue-300";

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">🔧 견적 및 자재청구 등록</h1>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">유상/무상/당직 모드 선택 후 자재 청구를 접수합니다.</p>
      </div>

      <datalist id={elevatorDatalistId}>
        {elevatorOptions.map(e => <option key={e} value={e} />)}
      </datalist>

      <div className="p-6 space-y-4 max-w-5xl">
        {/* 모드 선택 */}
        <div className={sectionCls}>
          <label className={labelCls}>청구 구분</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {MODES.map(m => {
              const active = mode === m.key;
              return (
                <button key={m.key} type="button" onClick={() => setMode(m.key)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    active
                      ? m.color + " ring-2 ring-offset-1 ring-blue-400"
                      : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-gray-400"
                  }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{m.icon}</span>
                    <span className="text-sm font-bold">{m.label}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">{m.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 헤더 */}
        <div className={sectionCls}>
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">📋 청구 정보</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>현장명 <span className="text-red-500">*</span></label>
              <SiteInlineSearch value={siteName} onChange={setSiteName} sites={sites} inputCls={inputCls} />
            </div>
            <div>
              <label className={labelCls}>작업명 <span className="text-[10px] text-gray-400">(예: 노후 부품 교체)</span></label>
              <input type="text" value={workTitle} onChange={e => setWorkTitle(e.target.value)} lang="ko" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>신청사유 / 고장 증상</label>
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} lang="ko" className={inputCls + " resize-none"} />
            </div>
          </div>
        </div>

        {/* 자재 라인 */}
        <div className={sectionCls}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">📦 자재 목록</h2>
            <div className="flex items-center gap-2 ml-auto">
              <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 p-0.5 rounded">
                {(["DS", "TK", "ALL"] as const).map(t => (
                  <button key={t} type="button" onClick={() => setMatTypeFilter(t)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors ${
                      matTypeFilter === t
                        ? t === "DS" ? "bg-red-500 text-white shadow-sm"
                          : t === "TK" ? "bg-blue-600 text-white shadow-sm"
                          : "bg-gray-900 text-white shadow-sm"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                    }`}>{t === "ALL" ? "전체" : t}</button>
                ))}
              </div>
              <button type="button" onClick={addRow}
                className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">+ 행 추가</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-y border-gray-200 dark:border-gray-600 text-center text-[11px] font-bold text-gray-600 dark:text-gray-300">
                  <th className="px-2 py-2 w-10">NO</th>
                  <th className="px-2 py-2 w-20">호기</th>
                  <th className="px-2 py-2">품      목</th>
                  <th className="px-2 py-2">규  격</th>
                  <th className="px-2 py-2 w-14">단위</th>
                  <th className="px-2 py-2 w-16">수량</th>
                  <th className="px-2 py-2">비  고</th>
                  <th className="px-2 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key} className="border-b border-gray-100 dark:border-gray-700 hover:bg-blue-50/20 dark:hover:bg-blue-900/10">
                    <td className="px-2 py-1.5 text-center text-gray-600 dark:text-gray-400">{i + 1}</td>
                    <td className="px-1 py-0.5">
                      <input type="text" lang="ko" value={r.elevator_name}
                        list={elevatorDatalistId}
                        onChange={e => patchRow(r.key, { elevator_name: e.target.value })}
                        placeholder={elevatorOptions[0] ?? "호기"}
                        className={cellInput + " text-center"} />
                    </td>
                    <td className="px-1 py-0.5 relative">
                      <input type="text" lang="ko" value={r.material_name}
                        onChange={e => { patchRow(r.key, { material_name: e.target.value }); searchMaterial(r.key, e.target.value); }}
                        onKeyDown={e => {
                          if (!r.searchOpen || r.searchResults.length === 0) return;
                          if (e.key === "ArrowDown") { e.preventDefault(); patchRow(r.key, { searchFocusIndex: Math.min(r.searchFocusIndex + 1, r.searchResults.length - 1) }); }
                          else if (e.key === "ArrowUp") { e.preventDefault(); patchRow(r.key, { searchFocusIndex: Math.max(r.searchFocusIndex - 1, 0) }); }
                          else if (e.key === "Enter") {
                            e.preventDefault();
                            if (r.searchResults.length === 1) applyMaterial(r.key, r.searchResults[0]);
                            else if (r.searchFocusIndex >= 0) applyMaterial(r.key, r.searchResults[r.searchFocusIndex]);
                          }
                          else if (e.key === "Escape") patchRow(r.key, { searchOpen: false });
                        }}
                        onBlur={() => setTimeout(() => patchRow(r.key, { searchOpen: false }), 150)}
                        placeholder={`자재명·코드 (${matTypeFilter === "ALL" ? "전체" : matTypeFilter})`}
                        className={cellInput} />
                      {r.searchOpen && r.searchResults.length > 0 && (
                        <div className="absolute z-50 top-full left-0 mt-0.5 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl">
                          <ul className="max-h-52 overflow-y-auto">
                            {r.searchResults.map((m, idx) => (
                              <li key={m.id}>
                                <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => applyMaterial(r.key, m)}
                                  className={`w-full text-left px-3 py-2 border-b border-gray-50 dark:border-gray-700 last:border-0 ${r.searchFocusIndex === idx ? "bg-blue-100 dark:bg-blue-900/50" : "hover:bg-gray-50 dark:hover:bg-gray-700"}`}>
                                  <div className="text-xs font-medium text-gray-800 dark:text-gray-200">{m.name}</div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] font-mono text-slate-400">{m.id}</span>
                                    {m.modelNo && <span className="text-[10px] text-gray-500">{m.modelNo}</span>}
                                  </div>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </td>
                    <td className="px-1 py-0.5">
                      <input type="text" lang="ko" value={r.spec} onChange={e => patchRow(r.key, { spec: e.target.value })} className={cellInput} />
                    </td>
                    <td className="px-1 py-0.5">
                      <input type="text" value={r.unit} onChange={e => patchRow(r.key, { unit: e.target.value })} className={cellInput + " text-center"} />
                    </td>
                    <td className="px-1 py-0.5">
                      <input type="text" inputMode="numeric" value={r.qty === 0 ? "" : String(r.qty)}
                        onChange={e => {
                          const v = e.target.value.replace(/[^0-9.]/g, "");
                          patchRow(r.key, { qty: v === "" ? 0 : Number(v) });
                        }}
                        className={cellInput + " text-right tabular-nums"} />
                    </td>
                    <td className="px-1 py-0.5">
                      <input type="text" lang="ko" value={r.remark} onChange={e => patchRow(r.key, { remark: e.target.value })} className={cellInput} />
                    </td>
                    <td className="px-1 py-0.5 text-center">
                      <button type="button" onClick={() => removeRow(r.key)} className="text-red-400 hover:text-red-600 text-xs">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {message && (
          <div className={`text-sm px-4 py-3 rounded ${
            message.type === "success" ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                       : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
          }`}>{message.text}</div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={submit} disabled={saving}
            className="px-6 py-2 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {saving ? "저장 중..." : `💾 ${MODES.find(m => m.key === mode)?.label} 저장`}
          </button>
        </div>

        {/* ─── 팀 청구 이력 ───────────────────────────────── */}
        <div className={sectionCls}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">📜 팀 청구 이력 (최근 20건)</h2>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                같은 팀({user?.dept ?? "-"}) 사원들의 청구 내역을 함께 표시합니다. 유상견적요청은 견적요청 목록 페이지에서, 무상·당직 신청은 자재신청 관리 페이지에서 처리 상황을 추적할 수 있습니다.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 p-0.5 rounded">
                {(["전체", "유상견적요청", "무상신청", "당직선출고"] as const).map(f => (
                  <button key={f} type="button" onClick={() => setHistKindFilter(f)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors ${
                      histKindFilter === f
                        ? "bg-blue-600 text-white"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                    }`}>{f}</button>
                ))}
              </div>
              <button type="button" onClick={() => void loadHistory()} disabled={histLoading}
                className="px-2.5 py-1 text-[11px] rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
                {histLoading ? "..." : "🔄"}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-y border-gray-200 dark:border-gray-600 text-[11px] font-bold text-gray-600 dark:text-gray-300">
                <tr>
                  <th className="px-2 py-2 text-center w-36">접수일시</th>
                  <th className="px-2 py-2 text-center w-24">구분</th>
                  <th className="px-2 py-2 text-left">현장</th>
                  <th className="px-2 py-2 text-left">자재 요약</th>
                  <th className="px-2 py-2 text-center w-28">상태</th>
                  <th className="px-2 py-2 text-center w-32">번호 / 추적</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const filtered = histKindFilter === "전체" ? history : history.filter(h => h.kind === histKindFilter);
                  if (histLoading && history.length === 0) {
                    return <tr><td colSpan={6} className="px-2 py-6 text-center text-gray-400">로딩 중...</td></tr>;
                  }
                  if (filtered.length === 0) {
                    return <tr><td colSpan={6} className="px-2 py-6 text-center text-gray-400">
                      {history.length === 0 ? "아직 청구 이력이 없습니다." : "선택한 구분에 해당하는 이력이 없습니다."}
                    </td></tr>;
                  }
                  return filtered.map(h => (
                    <tr key={`${h.source}-${h.rowId}`} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-2 py-1.5 text-center text-gray-600 dark:text-gray-300 font-mono tabular-nums whitespace-nowrap">
                        {fmtDT(h.date)}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${HIST_KIND_CLS[h.kind]}`}>
                          {h.kind}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-700 dark:text-gray-200 truncate max-w-[180px]">
                        {h.siteName ?? "-"}
                        {h.workTitle && <span className="ml-1 text-gray-400 dark:text-gray-500 text-[10px]">· {h.workTitle}</span>}
                      </td>
                      <td className="px-2 py-1.5 text-gray-700 dark:text-gray-200">
                        <span className="font-medium">{h.itemFirstName}</span>
                        {h.itemCount > 1 && (
                          <span className="ml-1 text-gray-400 dark:text-gray-500 text-[10px]">외 {h.itemCount - 1}건</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${histStatusCls(h.status)}`}>
                          {h.status}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-center text-[10px]">
                        {h.source === "quote_request" ? (
                          h.quoteId ? (
                            <a href={`/quotes/detail?id=${h.quoteId}`}
                              className="font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline">
                              📄 견적서
                            </a>
                          ) : (
                            <span className="font-mono text-gray-500 dark:text-gray-400">{h.no}</span>
                          )
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">자재신청#{h.rowId}</span>
                        )}
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 현장명 인라인 자동완성
// ============================================================

function SiteInlineSearch({
  value, onChange, sites, inputCls,
}: { value: string; onChange: (v: string) => void; sites: SiteOption[]; inputCls: string }) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const q = value.trim().toLowerCase();
  const suggestions = q
    ? sites.filter(s => s.name.toLowerCase().includes(q) || (s.alias?.toLowerCase().includes(q) ?? false)).slice(0, 12)
    : [];

  useEffect(() => { setFocusedIndex(-1); }, [value]);
  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <input type="text" lang="ko" value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => value.trim() && setOpen(true)}
        onKeyDown={e => {
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setFocusedIndex(i => Math.min(i + 1, suggestions.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setFocusedIndex(i => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") {
            e.preventDefault();
            if (focusedIndex >= 0) { onChange(suggestions[focusedIndex].name); setOpen(false); }
            else if (suggestions.length === 1) { onChange(suggestions[0].name); setOpen(false); }
          }
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="현장명·별칭 검색 (직접입력 가능)"
        className={inputCls} />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 top-full left-0 mt-0.5 w-full max-w-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-60 overflow-y-auto">
          {suggestions.map((s, idx) => (
            <li key={s.id}>
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onChange(s.name); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs text-gray-800 dark:text-gray-200 border-b border-gray-50 dark:border-gray-700 last:border-0 ${focusedIndex === idx ? "bg-blue-100 dark:bg-blue-900/50" : "hover:bg-blue-50 dark:hover:bg-blue-900/20"}`}>
                <span className="font-medium">{s.name}</span>
                {s.alias && s.alias !== s.name && <span className="ml-2 text-[10px] text-gray-400">({s.alias})</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
