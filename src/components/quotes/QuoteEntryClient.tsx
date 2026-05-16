"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, hasMenuPermission, isAdmin } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api-client";
import { MaterialRecord } from "@/lib/mock-materials";

const MENU_HREF = "/quotes/new";
const DEFAULT_ROW_COUNT = 5;
const DEFAULT_MAT_TYPE: "DS" | "TK" = "DS";

// ============================================================
// 타입
// ============================================================

interface QuoteSettings {
  default_direct_labor: number;
  indirect_labor_rate: number;
  overhead_rate: number;
  profit_rate: number;
}

interface SiteOption {
  id: number;
  name: string;
  alias?: string | null;
}

interface ItemRow {
  key: string;            // local
  material_id: string;
  material_name: string;
  spec: string;
  unit: string;
  qty: number;
  unit_price: number;
  remark: string;
  elevator_name: string;
  opinion_text: string;
  opinion_image_url: string;
  // 자재 검색 UI 상태
  searchOpen: boolean;
  searchResults: MaterialRecord[];
  searchFocusIndex: number;
}

function newRow(seed: Partial<ItemRow> = {}): ItemRow {
  return {
    key: crypto.randomUUID(),
    material_id: "", material_name: "", spec: "", unit: "EA",
    qty: 1, unit_price: 0, remark: "",
    elevator_name: "",
    opinion_text: "", opinion_image_url: "",
    searchOpen: false, searchResults: [], searchFocusIndex: -1,
    ...seed,
  };
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}
function parseNum(s: string): number {
  const v = s.replace(/[^0-9-]/g, "");
  return v === "" || v === "-" ? 0 : Number(v);
}
function parseDecimal(s: string): number {
  const v = s.replace(/[^0-9.]/g, "");
  if (v === "" || v === ".") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// ============================================================

export default function QuoteEntryClient() {
  const { user } = useAuth();
  const router = useRouter();

  const [settings, setSettings] = useState<QuoteSettings | null>(null);

  // 헤더 입력
  const [quoteDate, setQuoteDate]         = useState(todayISO());
  const [siteName, setSiteName]           = useState("");
  const [workTitle, setWorkTitle]         = useState("승강기 노후부품 보완 건");
  const [customerName, setCustomerName]   = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [note, setNote]                   = useState("");

  // 현장/호기 마스터
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [elevatorOptions, setElevatorOptions] = useState<string[]>([]);
  const elevatorDatalistId = "quote-entry-elevator-options";

  // 자재 라인 (기본 5줄)
  const [rows, setRows] = useState<ItemRow[]>(() => Array.from({ length: DEFAULT_ROW_COUNT }, () => newRow()));

  // 자재 검색 시 매터타입 필터 (기본 DS)
  const [matTypeFilter, setMatTypeFilter] = useState<"DS" | "TK" | "ALL">(DEFAULT_MAT_TYPE);

  // 인건비 — 공/식 모드
  const [laborMode, setLaborMode]           = useState<"공" | "식">("공");
  const [laborManhours, setLaborManhours]   = useState<number>(1);     // 공모드=공수, 식모드=통합 공수합
  const [laborUnitPrice, setLaborUnitPrice] = useState<number>(0);     // 1공당 단가

  const [indirectRate, setIndirectRate] = useState<number>(8);
  const [overheadRate, setOverheadRate] = useState<number>(10);
  const [profitRate, setProfitRate]     = useState<number>(8);
  const [truncateAmount, setTruncateAmount] = useState<number>(0);
  const [truncateManual, setTruncateManual] = useState<boolean>(false);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // ============================================================
  // 초기 로드
  // ============================================================

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("quote_settings").select("*").eq("id", 1).single();
      if (data) {
        setSettings(data as QuoteSettings);
        setLaborUnitPrice(data.default_direct_labor ?? 0);
        setIndirectRate(Number(data.indirect_labor_rate ?? 8));
        setOverheadRate(Number(data.overhead_rate ?? 10));
        setProfitRate(Number(data.profit_rate ?? 8));
      }
    })();
    api.get<SiteOption[]>("/api/sites").then(setSites).catch(() => {});
  }, []);

  // 현장 변경 시 호기 목록 로드
  useEffect(() => {
    if (!siteName.trim()) { setElevatorOptions([]); return; }
    (async () => {
      const { data } = await supabase.from("elevators")
        .select("unit_name").eq("site_name", siteName).order("unit_name");
      setElevatorOptions((data ?? []).map(e => (e as { unit_name: string }).unit_name).filter(Boolean));
    })();
  }, [siteName]);

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  const admin = isAdmin(user);
  const canCreate = admin || hasMenuPermission(user, MENU_HREF, "create");

  // ============================================================
  // 자동 계산
  // ============================================================

  const materialSubtotal = rows.reduce((s, r) => s + (r.material_id ? r.qty * r.unit_price : 0), 0);
  // 공모드: direct = unit_price * manhours
  // 식모드: 식수=1 이지만 입력된 공수합 × 단가 로 동일하게 계산
  const directLabor      = Math.round(laborUnitPrice * laborManhours);
  const indirectLabor    = Math.round(directLabor * indirectRate / 100);
  const laborSubtotal    = directLabor + indirectLabor;
  const overhead         = Math.round((materialSubtotal + laborSubtotal) * overheadRate / 100);
  const profit           = Math.round((laborSubtotal + overhead) * profitRate / 100);

  const subBeforeTrunc = materialSubtotal + laborSubtotal + overhead + profit;
  const isMaterialOnly = laborSubtotal === 0 && overhead === 0 && profit === 0;
  useEffect(() => {
    if (truncateManual) return;
    setTruncateAmount(isMaterialOnly ? 0 : subBeforeTrunc % 1000);
  }, [subBeforeTrunc, isMaterialOnly, truncateManual]);

  const totalAmount = subBeforeTrunc - truncateAmount;

  // ============================================================
  // 자재 검색 + 행 갱신
  // ============================================================

  function patchRow(key: string, patch: Partial<ItemRow>) {
    setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));
  }

  function addRow() {
    setRows(prev => [...prev, newRow()]);
  }
  function removeRow(key: string) {
    setRows(prev => prev.length === 1 ? prev : prev.filter(r => r.key !== key));
  }

  async function searchMaterial(key: string, query: string) {
    if (!query.trim()) {
      patchRow(key, { searchResults: [], searchOpen: false, searchFocusIndex: -1 });
      return;
    }
    try {
      const matParam = matTypeFilter === "ALL" ? "" : `&matType=${matTypeFilter}`;
      const data = await api.get<MaterialRecord[]>(`/api/materials?q=${encodeURIComponent(query)}${matParam}`);
      const sliced = data.slice(0, 12);
      patchRow(key, { searchResults: sliced, searchOpen: sliced.length > 0, searchFocusIndex: sliced.length === 1 ? 0 : -1 });
    } catch {
      patchRow(key, { searchResults: [], searchOpen: false, searchFocusIndex: -1 });
    }
  }

  async function applyMaterial(key: string, m: MaterialRecord) {
    let op_text = "";
    let op_image = "";
    try {
      const full = await api.get<MaterialRecord & { opinionText?: string; opinionImageUrl?: string }>(`/api/materials/${encodeURIComponent(m.id)}`);
      op_text  = full.opinionText  ?? "";
      op_image = full.opinionImageUrl ?? "";
    } catch { /* opinion 없으면 빈 값 */ }

    patchRow(key, {
      material_id: m.id,
      material_name: m.name,
      spec: m.modelNo ?? "",
      unit: m.unit ?? "EA",
      unit_price: m.sellPrice ?? 0,
      opinion_text: op_text,
      opinion_image_url: op_image,
      searchResults: [], searchOpen: false, searchFocusIndex: -1,
    });
  }

  // ============================================================
  // 저장
  // ============================================================

  async function generateQuoteNo(): Promise<string> {
    const year = new Date(quoteDate).getFullYear();
    const prefix = `Q-${year}-`;
    const { data } = await supabase
      .from("quotes")
      .select("quote_no")
      .like("quote_no", `${prefix}%`)
      .order("quote_no", { ascending: false })
      .limit(1);
    let nextSeq = 1;
    if (data && data.length > 0) {
      const last = (data[0] as { quote_no: string }).quote_no;
      const match = last.match(/-(\d+)$/);
      if (match) nextSeq = parseInt(match[1], 10) + 1;
    }
    return `${prefix}${String(nextSeq).padStart(4, "0")}`;
  }

  async function save() {
    setMessage(null);
    if (!canCreate || !user) { setMessage({ type: "error", text: "견적서 작성 권한이 없습니다." }); return; }
    const validItems = rows.filter(r => r.material_id || r.material_name.trim());
    if (validItems.length === 0) {
      setMessage({ type: "error", text: "자재 라인을 1개 이상 입력해주세요." });
      return;
    }
    setSaving(true);
    try {
      const quote_no = await generateQuoteNo();
      // 헤더 elevator_name 은 행 elevator 의 유니크 집합으로 자동 도출 (단일이면 그 값, 복수면 콤마 결합)
      const elevSet = Array.from(new Set(validItems.map(r => r.elevator_name.trim()).filter(Boolean)));
      const headerElevator = elevSet.length === 0 ? null : elevSet.join(", ");

      const { data: header, error: e1 } = await supabase.from("quotes").insert({
        quote_no,
        quote_date: quoteDate,
        site_name: siteName || null,
        elevator_name: headerElevator,
        work_title: workTitle || null,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        material_subtotal: materialSubtotal,
        direct_labor: directLabor,
        indirect_labor: indirectLabor,
        overhead,
        profit,
        truncate_amount: truncateAmount,
        total_amount: totalAmount,
        indirect_labor_rate: indirectRate,
        overhead_rate: overheadRate,
        profit_rate: profitRate,
        labor_mode:       laborMode,
        labor_manhours:   laborManhours,
        labor_unit_price: laborUnitPrice,
        note: note || null,
        created_by_id: user.id,
        created_by_name: user.name,
      }).select().single();
      if (e1 || !header) throw e1 || new Error("견적서 생성 실패");

      const { error: e2 } = await supabase.from("quote_items").insert(
        validItems.map((r, i) => ({
          quote_id: header.id,
          material_id: r.material_id || null,
          material_name: r.material_name,
          spec: r.spec || null,
          unit: r.unit || null,
          qty: r.qty,
          unit_price: r.unit_price,
          amount: r.qty * r.unit_price,
          remark: r.remark || null,
          elevator_name: r.elevator_name || null,
          opinion_text: r.opinion_text || null,
          opinion_image_url: r.opinion_image_url || null,
          sort_order: (i + 1) * 10,
        }))
      );
      if (e2) throw e2;

      setMessage({ type: "success", text: `견적서가 등록되었습니다. (${quote_no})` });
      // 폼 리셋
      setRows(Array.from({ length: DEFAULT_ROW_COUNT }, () => newRow()));
      setSiteName(""); setCustomerName(""); setCustomerPhone("");
      setNote("");
      setLaborMode("공");
      setLaborManhours(1);
      setLaborUnitPrice(settings?.default_direct_labor ?? 0);
      setTruncateManual(false);
      setTruncateAmount(0);
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  // ============================================================
  // 렌더
  // ============================================================

  const sectionCls = "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5";
  const labelCls   = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1";
  const inputCls   = "w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100";
  const cellInput  = "w-full px-2 py-1 text-xs text-gray-900 dark:text-gray-100 border-0 bg-transparent focus:outline-none focus:bg-yellow-50 dark:focus:bg-yellow-900/20 focus:ring-1 focus:ring-blue-300";

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">견적서 작성</h1>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">자재비·인건비·일반관리비·이윤 자동 계산</p>
      </div>

      {/* 호기 자동완성용 datalist */}
      <datalist id={elevatorDatalistId}>
        {elevatorOptions.map(e => <option key={e} value={e} />)}
      </datalist>

      <div className="p-6 space-y-4 max-w-6xl">
        {/* 견적 정보 */}
        <div className={sectionCls}>
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">📋 견적 정보</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>견적일자</label>
              <input type="date" value={quoteDate} onChange={e => setQuoteDate(e.target.value)} className={inputCls} />
            </div>
            <div className="lg:col-span-2">
              <label className={labelCls}>현장명 <span className="text-[10px] text-gray-400">(검색 또는 직접입력)</span></label>
              <SiteInlineSearch value={siteName} onChange={setSiteName} sites={sites} inputCls={inputCls} />
              {elevatorOptions.length > 0 && (
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  ※ 이 현장의 호기 {elevatorOptions.length}개 — 자재 행의 [호기] 입력란 클릭 시 자동완성됨
                </div>
              )}
            </div>
            <div className="lg:col-span-3">
              <label className={labelCls}>작업명</label>
              <input type="text" value={workTitle} onChange={e => setWorkTitle(e.target.value)} lang="ko" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>고객명</label>
              <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} lang="ko" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>고객 연락처</label>
              <input type="text" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>

        {/* 자재비 라인 */}
        <div className={sectionCls}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">📦 자재비</h2>
            <div className="flex items-center gap-2 ml-auto">
              <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 p-0.5 rounded">
                {(["DS", "TK", "ALL"] as const).map(t => (
                  <button key={t} type="button" onClick={() => setMatTypeFilter(t)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors ${
                      matTypeFilter === t
                        ? "bg-blue-600 text-white"
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
                  <th className="px-2 py-2 w-24">단    가</th>
                  <th className="px-2 py-2 w-28">금    액</th>
                  <th className="px-2 py-2">비  고</th>
                  <th className="px-2 py-2 w-12">소견</th>
                  <th className="px-2 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const amount = r.qty * r.unit_price;
                  return (
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
                          onChange={e => {
                            patchRow(r.key, { material_name: e.target.value });
                            searchMaterial(r.key, e.target.value);
                          }}
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
                          placeholder={`자재명·코드 검색 (${matTypeFilter === "ALL" ? "전체" : matTypeFilter})`}
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
                                      <span className="text-[10px] ml-auto text-gray-400">{(m.sellPrice ?? 0).toLocaleString()}원</span>
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
                          onChange={e => patchRow(r.key, { qty: parseNum(e.target.value) })}
                          className={cellInput + " text-right tabular-nums"} />
                      </td>
                      <td className="px-1 py-0.5">
                        <input type="text" inputMode="numeric" value={r.unit_price === 0 ? "" : fmtNum(r.unit_price)}
                          onChange={e => patchRow(r.key, { unit_price: parseNum(e.target.value) })}
                          className={cellInput + " text-right tabular-nums"} />
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-300 font-medium">
                        {fmtNum(amount)}
                      </td>
                      <td className="px-1 py-0.5">
                        <input type="text" lang="ko" value={r.remark} onChange={e => patchRow(r.key, { remark: e.target.value })} className={cellInput} />
                      </td>
                      <td className="px-1 py-0.5 text-center">
                        {r.opinion_text || r.opinion_image_url ? (
                          <span title={r.opinion_text} className="text-blue-500">📝</span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-1 py-0.5 text-center">
                        <button type="button" onClick={() => removeRow(r.key)} className="text-red-400 hover:text-red-600 text-xs">×</button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-gray-50 dark:bg-gray-700/40 border-t-2 border-gray-300 dark:border-gray-600 font-bold">
                  <td colSpan={7} className="px-2 py-2 text-right text-gray-700 dark:text-gray-200">자재비 소계</td>
                  <td className="px-2 py-2 text-right tabular-nums text-blue-600 dark:text-blue-400">{fmtNum(materialSubtotal)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 인건비 + 비율 */}
        <div className={sectionCls}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">👷 인건비 / 요율</h2>
            <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 p-0.5 rounded">
              {(["공", "식"] as const).map(m => (
                <button key={m} type="button" onClick={() => {
                  setLaborMode(m);
                  if (m === "식") setLaborManhours(prev => prev || 1);
                }}
                  className={`px-3 py-1 text-[11px] font-bold rounded transition-colors ${
                    laborMode === m
                      ? "bg-blue-600 text-white"
                      : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                  }`}
                  title={m === "공" ? "단위: 공 (1인 1일). 단가 × 공수" : "단위: 식 (여러 작업 통합). 식수=1, 통합 공수합 × 단가"}
                >{m}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className={labelCls}>1공 단가 <span className="text-[10px] text-gray-400">(기본값 자동)</span></label>
              <input type="text" inputMode="numeric" value={laborUnitPrice === 0 ? "" : fmtNum(laborUnitPrice)}
                onChange={e => setLaborUnitPrice(parseNum(e.target.value))}
                className={inputCls + " text-right tabular-nums font-semibold"} />
            </div>
            <div>
              <label className={labelCls}>
                {laborMode === "공" ? "공수" : "통합 공수합"}
                {laborMode === "식" && <span className="text-[10px] text-gray-400 ml-1">(여러 작업 합)</span>}
              </label>
              <input type="text" inputMode="decimal" value={laborManhours === 0 ? "" : String(laborManhours)}
                onChange={e => setLaborManhours(parseDecimal(e.target.value))}
                placeholder="예: 2.5"
                className={inputCls + " text-right tabular-nums font-semibold"} />
              <div className="text-[11px] text-gray-500 mt-1">
                {laborMode === "공"
                  ? `${laborManhours}공 × ${fmtNum(laborUnitPrice)}원 = ${fmtNum(directLabor)}원`
                  : `1식 (${laborManhours}공 통합) × ${fmtNum(laborUnitPrice)}원 = ${fmtNum(directLabor)}원`}
              </div>
            </div>
            <div>
              <label className={labelCls}>간접인건비율 (%)</label>
              <input type="text" inputMode="decimal" value={indirectRate}
                onChange={e => {
                  const v = e.target.value.replace(/[^0-9.]/g, "");
                  setIndirectRate(v === "" ? 0 : Number(v));
                }}
                className={inputCls + " text-right tabular-nums"} />
              <div className="text-[11px] text-gray-500 mt-1">= {fmtNum(indirectLabor)}원</div>
            </div>
            <div>
              <label className={labelCls}>일반관리비율 (%) <span className="text-[10px] text-gray-400">(자재+인건)</span></label>
              <input type="text" inputMode="decimal" value={overheadRate}
                onChange={e => {
                  const v = e.target.value.replace(/[^0-9.]/g, "");
                  setOverheadRate(v === "" ? 0 : Number(v));
                }}
                className={inputCls + " text-right tabular-nums"} />
              <div className="text-[11px] text-gray-500 mt-1">= {fmtNum(overhead)}원</div>
            </div>
            <div>
              <label className={labelCls}>이윤율 (%) <span className="text-[10px] text-gray-400">(인건+일반관리)</span></label>
              <input type="text" inputMode="decimal" value={profitRate}
                onChange={e => {
                  const v = e.target.value.replace(/[^0-9.]/g, "");
                  setProfitRate(v === "" ? 0 : Number(v));
                }}
                className={inputCls + " text-right tabular-nums"} />
              <div className="text-[11px] text-gray-500 mt-1">= {fmtNum(profit)}원</div>
            </div>
          </div>
        </div>

        {/* 합계 + 절사 + 특기사항 */}
        <div className={sectionCls}>
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">💰 합계</h2>
          <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-4">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                <tr>
                  <td className="py-1.5 text-gray-600 dark:text-gray-300">1. 자재비</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-800 dark:text-gray-100">{fmtNum(materialSubtotal)} 원</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-gray-600 dark:text-gray-300">
                    2. 인건비 <span className="text-xs text-gray-400">
                      ({laborMode === "공"
                        ? `${laborManhours}공 + 간접 ${indirectRate}%`
                        : `1식(${laborManhours}공 통합) + 간접 ${indirectRate}%`})
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-gray-800 dark:text-gray-100">{fmtNum(laborSubtotal)} 원</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-gray-600 dark:text-gray-300">3. 일반관리비 ({overheadRate}%)</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-800 dark:text-gray-100">{fmtNum(overhead)} 원</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-gray-600 dark:text-gray-300">4. 이윤 ({profitRate}%)</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-800 dark:text-gray-100">{fmtNum(profit)} 원</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-gray-600 dark:text-gray-300">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>5. 절사금액</span>
                      <input type="text" inputMode="numeric" value={truncateAmount === 0 ? "" : fmtNum(truncateAmount)}
                        onChange={e => { setTruncateAmount(parseNum(e.target.value)); setTruncateManual(true); }}
                        placeholder="0" className="w-32 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-right tabular-nums" />
                      {truncateManual ? (
                        <button type="button" onClick={() => setTruncateManual(false)}
                          className="text-[10px] px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 hover:bg-blue-100 border border-blue-200 dark:border-blue-700">
                          자동(천원절사)
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">{isMaterialOnly ? "자동: 자재만 → 절사 없음" : "자동: 천원 단위 절사"}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-red-600 dark:text-red-400">- {fmtNum(truncateAmount)} 원</td>
                </tr>
                <tr className="border-t-2 border-gray-400 dark:border-gray-500">
                  <td className="py-2.5 font-bold text-base text-gray-900 dark:text-white">공급가액</td>
                  <td className="py-2.5 text-right tabular-nums font-bold text-lg text-blue-600 dark:text-blue-400">{fmtNum(totalAmount)} 원</td>
                </tr>
                <tr>
                  <td colSpan={2} className="text-[11px] text-gray-400 dark:text-gray-500 pt-1">※ 위 금액은 부가세 별도 금액임</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <label className={labelCls}>특기사항</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} lang="ko"
              className={inputCls + " resize-none"} />
          </div>

          {message && (
            <div className={`mt-3 text-xs px-3 py-2 rounded ${
              message.type === "success" ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                         : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
            }`}>{message.text}</div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => router.push("/dashboard")}
              className="px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">취소</button>
            <button type="button" onClick={save} disabled={saving}
              className="px-5 py-2 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving ? "저장 중..." : "견적서 저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 현장명 인라인 자동완성 (직접입력도 가능)
// ============================================================

function SiteInlineSearch({
  value, onChange, sites, inputCls,
}: { value: string; onChange: (v: string) => void; sites: SiteOption[]; inputCls: string }) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const ulRef = useRef<HTMLUListElement>(null);
  const q = value.trim().toLowerCase();
  const suggestions = q
    ? sites.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.alias?.toLowerCase().includes(q) ?? false)
      ).slice(0, 12)
    : [];

  useEffect(() => { setFocusedIndex(-1); }, [value]);

  useEffect(() => {
    if (focusedIndex >= 0 && ulRef.current) {
      const el = ulRef.current.children[focusedIndex] as HTMLElement;
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setFocusedIndex(i => (i < suggestions.length - 1 ? i + 1 : i)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setFocusedIndex(i => (i > 0 ? i - 1 : 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (focusedIndex >= 0) { onChange(suggestions[focusedIndex].name); setOpen(false); }
      else if (suggestions.length === 1) { onChange(suggestions[0].name); setOpen(false); }
    }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <input type="text" lang="ko" value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => value.trim() && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="현장명·별칭 검색 (직접입력 가능)"
        className={inputCls} />
      {open && suggestions.length > 0 && (
        <ul ref={ulRef} className="absolute z-50 top-full left-0 mt-0.5 w-full max-w-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-60 overflow-y-auto">
          {suggestions.map((s, idx) => (
            <li key={s.id}>
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onChange(s.name); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs text-gray-800 dark:text-gray-200 border-b border-gray-50 dark:border-gray-700 last:border-0 ${focusedIndex === idx ? "bg-blue-100 dark:bg-blue-900/50" : "hover:bg-blue-50 dark:hover:bg-blue-900/20"}`}>
                <span className="font-medium">{s.name}</span>
                {s.alias && s.alias !== s.name && (
                  <span className="ml-2 text-[10px] text-gray-400 dark:text-gray-500">({s.alias})</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
