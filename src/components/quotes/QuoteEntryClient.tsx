"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, hasMenuPermission, isAdmin } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api-client";
import { fmtNum, parseNum } from "@/lib/format";
import { MaterialRecord } from "@/lib/mock-materials";
import { insertNotification } from "@/lib/notify";
import { generateDocNo } from "@/lib/document-no";
import QuotePrintPaper, { QuotePrintCompany } from "@/components/quotes/QuotePrintPaper";

const MENU_HREF = "/quotes/new";
const DEFAULT_ROW_COUNT = 5;
const DEFAULT_MAT_TYPE: "DS" | "TK" = "DS";

// 무상(FM) 현장 — 계약구분이 다음 중 하나면 견적 대신 자재신청 권유
const FM_CONTRACT_TYPES = new Set<string>(["TK-FM", "대솔FM", "DS-FM"]);

// 과거 출고 이력 풍선말에 표시할 건수
const PAST_ISSUANCE_LIMIT = 5;

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

interface SiteContractInfo {
  contract_type:  string | null;
  contract_start: string | null;
  contract_end:   string | null;
  warranty_start: string | null;
  warranty_end:   string | null;
  company_type:   string | null;   // TK / DS
}

interface PastIssuance {
  created_at: string;       // ISO
  qty: number;
  user_name: string | null;
  note: string | null;
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
  // 과거 출고 이력 (site+elevator+material 매치)
  pastIssuances: PastIssuance[];
  pastLoading: boolean;
}

function newRow(seed: Partial<ItemRow> = {}): ItemRow {
  return {
    key: crypto.randomUUID(),
    material_id: "", material_name: "", spec: "", unit: "EA",
    qty: 1, unit_price: 0, remark: "",
    elevator_name: "",
    opinion_text: "", opinion_image_url: "",
    searchOpen: false, searchResults: [], searchFocusIndex: -1,
    pastIssuances: [], pastLoading: false,
    ...seed,
  };
}

// ── 공수 표준(분류 마스터 연계) + 작업 라인 ─────────────────
interface LaborCat {
  id: number;
  level: "major" | "mid";
  label: string;
  parent_id: number | null;
  sort_order: number;
  is_active: boolean;
}
interface WorkloadStandard {
  id: number;
  major_id: number | null;
  mid_id: number | null;
  detail: string | null;     // 소분류/상세 (보조구분·층수)
  man_days: number | null;   // NULL = 별도 견적(미기재)
  note: string | null;
}

interface LaborLine {
  key: string;
  standard_id: number | null;  // 선택된 공수 항목 (NULL = 자유 입력)
  major_id: number | null;     // 연쇄 선택 UI 상태 (대분류)
  mid_id: number | null;       // 연쇄 선택 UI 상태 (중분류)
  work_name: string;           // 작업명 스냅샷 (대·중·상세 조합)
  man_days: number;            // 공수
  remark: string;
  elevator_name: string;
}
function newLaborLine(seed: Partial<LaborLine> = {}): LaborLine {
  return {
    key: crypto.randomUUID(),
    standard_id: null, major_id: null, mid_id: null,
    work_name: "", man_days: 0,
    remark: "", elevator_name: "",
    ...seed,
  };
}

interface RevisionNote {
  key: string;
  revised_date: string;  // YYYY-MM-DD
  content: string;
}
function newRevisionNote(seed: Partial<RevisionNote> = {}): RevisionNote {
  return { key: crypto.randomUUID(), revised_date: todayISO(), content: "", ...seed };
}

function daysBetween(fromIso: string | null, toIso: string | null): number | null {
  if (!fromIso || !toIso) return null;
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function fmtYmd(iso: string | null | undefined): string {
  if (!iso) return "-";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : String(iso);
}

function parseDecimal(s: string): number {
  const v = s.replace(/[^0-9.]/g, "");
  if (v === "" || v === ".") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [o.message, o.details, o.hint, o.code].filter(Boolean);
    if (parts.length > 0) return parts.join(" — ");
    try { return JSON.stringify(e); } catch { return "(unknown error)"; }
  }
  return String(e);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// ============================================================

export default function QuoteEntryClient() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-sm text-gray-500">로딩 중...</div>}>
      <QuoteEntryInner />
    </Suspense>
  );
}

function QuoteEntryInner() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // fromRequest: 우선 쿼리스트링 → 없으면 sessionStorage(탭 시스템으로 진입한 경우)
  const [fromRequestId, setFromRequestId] = useState<string | null>(() => searchParams.get("fromRequest"));
  useEffect(() => {
    const qp = searchParams.get("fromRequest");
    if (qp) { setFromRequestId(qp); return; }
    try {
      const stored = sessionStorage.getItem("ds:quote_from_request");
      if (stored) {
        setFromRequestId(stored);
        sessionStorage.removeItem("ds:quote_from_request");
      }
    } catch {}
  }, [searchParams]);
  // 이미 마운트된 상태에서 견적요청 목록이 다시 견적서 작성을 호출했을 때 갱신
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ id: number | string }>).detail;
      if (detail?.id != null) {
        setFromRequestId(String(detail.id));
        try { sessionStorage.removeItem("ds:quote_from_request"); } catch {}
      }
    }
    window.addEventListener("ds:quote_from_request_changed", handler);
    return () => window.removeEventListener("ds:quote_from_request_changed", handler);
  }, []);
  const editIdStr = searchParams.get("id");
  const editId = editIdStr && Number.isFinite(Number(editIdStr)) ? Number(editIdStr) : null;
  const isEditMode = editId !== null;

  const [settings, setSettings] = useState<QuoteSettings | null>(null);
  const [editLoading, setEditLoading] = useState<boolean>(isEditMode);
  const [editLoadError, setEditLoadError] = useState<string | null>(null);
  const [editLockedReason, setEditLockedReason] = useState<string | null>(null);
  const [editQuoteNo, setEditQuoteNo] = useState<string | null>(null);

  // 헤더 입력
  const [quoteDate, setQuoteDate]         = useState(todayISO());
  const [siteName, setSiteName]           = useState("");
  const [workTitle, setWorkTitle]         = useState("승강기 노후부품 보완 건");
  const [customerName, setCustomerName]   = useState("");
  const [note, setNote]                   = useState("");

  // 현장/호기 마스터
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [elevatorOptions, setElevatorOptions] = useState<string[]>([]);
  const elevatorDatalistId = "quote-entry-elevator-options";
  const [siteInfo, setSiteInfo] = useState<SiteContractInfo | null>(null);

  // 유상/무상
  const [chargeType, setChargeType] = useState<"유상" | "무상">("유상");
  const [chargeAutoApplied, setChargeAutoApplied] = useState(false); // FM 자동전환 사용자 인지 표시

  // 자재 라인 (기본 5줄)
  const [rows, setRows] = useState<ItemRow[]>(() => Array.from({ length: DEFAULT_ROW_COUNT }, () => newRow()));

  // 자재 검색 시 매터타입 필터 (기본 DS)
  const [matTypeFilter, setMatTypeFilter] = useState<"DS" | "TK" | "ALL">(DEFAULT_MAT_TYPE);

  // 인건비 — 공/식 모드
  const [laborMode, setLaborMode]           = useState<"공" | "식">("공");
  const [laborManhours, setLaborManhours]   = useState<number>(1);     // 공모드=공수, 식모드=통합 공수합
  const [laborUnitPrice, setLaborUnitPrice] = useState<number>(0);     // 1공당 단가

  // 교체공사 작업 라인 (표준 공수 연동). 1건 이상이면 공수 = Σ(라인 man_days) 자동.
  const [standards, setStandards]   = useState<WorkloadStandard[]>([]);
  const [laborCats, setLaborCats]   = useState<LaborCat[]>([]);
  const [laborLines, setLaborLines] = useState<LaborLine[]>([]);

  // 부가세 표시 모드 (false=별도 기본, true=포함)
  const [vatIncluded, setVatIncluded] = useState<boolean>(false);
  // 견적서 규격(spec) 표기 여부 (기본 표시)
  const [showSpec, setShowSpec] = useState<boolean>(true);
  // 견적신청자 사원 검색 후보 + 수정모드 작성자명
  const [employees, setEmployees] = useState<{ id: string; name: string; dept: string | null; team: string | null }[]>([]);
  const [editCreatedBy, setEditCreatedBy] = useState<string>("");
  // 견적 수정 내역 + 출력 표시 토글(기본 미출력)
  const [revisionNotes, setRevisionNotes] = useState<RevisionNote[]>([]);
  const [showRevisions, setShowRevisions] = useState<boolean>(false);
  // Nego 확정가 (VAT 별도, 0=미사용 → 입력 시 부가세·합계 이 금액 기준)
  const [negoAmount, setNegoAmount] = useState<number>(0);

  // 인건비/요율 적용 여부 (체크 해제 시 인건비·일반관리비·이윤 모두 0)
  const [laborEnabled, setLaborEnabled] = useState<boolean>(true);
  // 직접인건비만 적용 (체크 시 간접인건비·일반관리비·이윤은 0)
  const [directLaborOnly, setDirectLaborOnly] = useState<boolean>(false);

  const [indirectRate, setIndirectRate] = useState<number>(8);
  const [overheadRate, setOverheadRate] = useState<number>(10);
  const [profitRate, setProfitRate]     = useState<number>(8);
  const [truncateAmount, setTruncateAmount] = useState<number>(0);
  const [truncateManual, setTruncateManual] = useState<boolean>(false);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 견적요청 프리필 (fromRequest=N)
  const [sourceRequestId, setSourceRequestId] = useState<number | null>(null);
  const [sourceRequestNo, setSourceRequestNo] = useState<string | null>(null);

  // 미리보기 (출력물)
  const [previewOpen, setPreviewOpen] = useState(false);
  const [company, setCompany] = useState<QuotePrintCompany | null>(null);

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
        setCompany({
          company_name:    data.company_name    ?? null,
          company_biz_no:  data.company_biz_no  ?? null,
          company_address: data.company_address ?? null,
          company_phone:   data.company_phone   ?? null,
          company_email:   data.company_email   ?? null,
          company_ceo:     data.company_ceo     ?? null,
          company_stamp_url: data.company_stamp_url ?? null,
        });
      }
    })();
    api.get<SiteOption[]>("/api/sites").then(setSites).catch(() => {});
    supabase.from("accounts").select("id, name:username, dept, team").order("username")
      .then(({ data }) => { if (data) setEmployees(data as typeof employees); });
  }, []);

  // fromRequest 프리필
  useEffect(() => {
    if (!fromRequestId) return;
    const qrId = Number(fromRequestId);
    if (!Number.isFinite(qrId)) return;
    (async () => {
      const [hdr, items] = await Promise.all([
        supabase.from("quote_requests").select("*").eq("id", qrId).maybeSingle(),
        supabase.from("quote_request_items").select("*").eq("quote_request_id", qrId).order("sort_order"),
      ]);
      const h = hdr.data as {
        id: number; request_no: string; site_name: string | null;
        work_title: string | null; reason: string | null;
        requester_name: string | null;
      } | null;
      if (!h) return;
      setSourceRequestId(h.id);
      setSourceRequestNo(h.request_no);
      setSiteName(h.site_name ?? "");
      if (h.work_title) setWorkTitle(h.work_title);
      if (h.reason) setNote(h.reason);
      if (h.requester_name) setCustomerName(h.requester_name);
      // items
      const its = (items.data ?? []) as Array<{
        material_id: string | null; material_name: string;
        spec: string | null; unit: string | null;
        qty: number; elevator_name: string | null; remark: string | null;
      }>;
      if (its.length > 0) {
        // 자재 master 가격 보강을 위해 각 자재 1회 조회
        const enriched = await Promise.all(its.map(async it => {
          let unitPrice = 0;
          if (it.material_id) {
            try {
              const full = await api.get<MaterialRecord>(`/api/materials/${encodeURIComponent(it.material_id)}`);
              unitPrice = full.sellPrice ?? 0;
            } catch { /* skip */ }
          }
          return newRow({
            material_id:   it.material_id ?? "",
            material_name: it.material_name,
            spec:          it.spec ?? "",
            unit:          it.unit ?? "EA",
            qty:           it.qty,
            unit_price:    unitPrice,
            elevator_name: it.elevator_name ?? "",
            remark:        it.remark ?? "",
          });
        }));
        setRows(enriched);
      }
      // 견적요청 상태 → '견적작성중'
      await supabase.from("quote_requests").update({ status: "견적작성중" }).eq("id", qrId);
    })();
  }, [fromRequestId]);

  // 공수 표준 + 분류 마스터 로드 (마운트 1회)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [std, cat] = await Promise.all([
        supabase.from("labor_workload_standards")
          .select("id, major_id, mid_id, detail, man_days, note")
          .eq("is_active", true).order("sort_order"),
        supabase.from("labor_categories")
          .select("id, level, label, parent_id, sort_order, is_active")
          .eq("is_active", true).order("sort_order"),
      ]);
      if (cancelled) return;
      if (std.data) setStandards(std.data as WorkloadStandard[]);
      if (cat.data) setLaborCats(cat.data as LaborCat[]);
    })();
    return () => { cancelled = true; };
  }, []);

  // 수정모드 복원: standard_id 만 있는 라인에 대분류/중분류 채움 (표준 로드 후 1회 보정)
  useEffect(() => {
    if (standards.length === 0) return;
    setLaborLines(prev => {
      let changed = false;
      const next = prev.map(l => {
        if (l.standard_id != null && l.major_id == null) {
          const s = standards.find(x => x.id === l.standard_id);
          if (s) { changed = true; return { ...l, major_id: s.major_id, mid_id: s.mid_id }; }
        }
        return l;
      });
      return changed ? next : prev;
    });
  }, [standards]);

  // ============================================================
  // 수정 모드 — 기존 quote 로드
  // ============================================================
  useEffect(() => {
    if (!isEditMode || editId === null) return;
    let cancelled = false;
    (async () => {
      setEditLoading(true);
      setEditLoadError(null);
      setEditLockedReason(null);
      const [hdr, items, lines, revs] = await Promise.all([
        supabase.from("quotes").select("*").eq("id", editId).maybeSingle(),
        supabase.from("quote_items").select("*").eq("quote_id", editId).order("sort_order"),
        supabase.from("quote_labor_lines").select("*").eq("quote_id", editId).order("sort_order"),
        supabase.from("quote_revision_notes").select("*").eq("quote_id", editId).order("sort_order"),
      ]);
      if (cancelled) return;
      if (hdr.error || !hdr.data) {
        setEditLoadError(`견적서 로드 실패: ${hdr.error?.message ?? "데이터 없음"}`);
        setEditLoading(false);
        return;
      }
      const h = hdr.data as {
        id: number; quote_no: string; quote_date: string;
        site_name: string | null; work_title: string | null;
        customer_name: string | null; created_by_name: string | null;
        note: string | null; status: string; charge_type: "유상" | "무상" | null;
        labor_mode: "공" | "식" | null; labor_manhours: number | null; labor_unit_price: number | null;
        vat_included: boolean | null; show_spec: boolean | null; show_revisions: boolean | null; nego_amount: number | null;
        indirect_labor_rate: number | null; overhead_rate: number | null; profit_rate: number | null;
        truncate_amount: number | null;
        direct_labor: number | null; indirect_labor: number | null;
        overhead: number | null; profit: number | null;
      };
      setEditQuoteNo(h.quote_no);
      if (h.status !== "작성중" && h.status !== "발행") {
        setEditLockedReason(`현재 결재상태가 [${h.status}] 입니다. 작성중·발행 상태의 견적서만 수정할 수 있습니다.`);
      }
      // 헤더 프리필
      setQuoteDate(h.quote_date);
      setSiteName(h.site_name ?? "");
      setWorkTitle(h.work_title ?? "");
      setCustomerName(h.customer_name ?? "");
      setEditCreatedBy(h.created_by_name ?? "");
      setNote(h.note ?? "");
      setChargeType(h.charge_type ?? "유상");
      setChargeAutoApplied(false);
      setLaborMode(h.labor_mode ?? "공");
      setLaborManhours(Number(h.labor_manhours ?? 0));
      setLaborUnitPrice(Number(h.labor_unit_price ?? 0));
      setVatIncluded(!!h.vat_included);
      setShowSpec(h.show_spec !== false);
      setShowRevisions(!!h.show_revisions);
      setNegoAmount(Number(h.nego_amount ?? 0));
      const revRows = (revs.data ?? []) as Array<{ revised_date: string; content: string }>;
      setRevisionNotes(revRows.map(r => newRevisionNote({ revised_date: r.revised_date, content: r.content })));
      setIndirectRate(Number(h.indirect_labor_rate ?? 8));
      setOverheadRate(Number(h.overhead_rate ?? 10));
      setProfitRate(Number(h.profit_rate ?? 8));
      // 두 체크박스 독립 추론:
      //  - 직접인건비 적용: direct_labor 가 양수면 ON
      //  - 간접인건비/요율 적용: indirect/overhead/profit 중 하나라도 양수면 ON
      const savedDirect   = Number(h.direct_labor ?? 0);
      const savedIndirect = Number(h.indirect_labor ?? 0);
      const savedOverhead = Number(h.overhead ?? 0);
      const savedProfit   = Number(h.profit ?? 0);
      setDirectLaborOnly(savedDirect > 0);
      setLaborEnabled(savedIndirect > 0 || savedOverhead > 0 || savedProfit > 0);
      // 저장된 절사금액 보존(수동 모드로 처리) — 자동 재계산이 덮어쓰지 않도록
      setTruncateAmount(Number(h.truncate_amount ?? 0));
      setTruncateManual(true);
      // 아이템 프리필
      const its = (items.data ?? []) as Array<{
        material_id: string | null; material_name: string;
        spec: string | null; unit: string | null;
        qty: number; unit_price: number;
        remark: string | null; elevator_name: string | null;
        opinion_text: string | null; opinion_image_url: string | null;
      }>;
      if (its.length > 0) {
        setRows(its.map(it => newRow({
          material_id:       it.material_id ?? "",
          material_name:     it.material_name,
          spec:              it.spec ?? "",
          unit:              it.unit ?? "EA",
          qty:               Number(it.qty),
          unit_price:        Number(it.unit_price),
          remark:            it.remark ?? "",
          elevator_name:     it.elevator_name ?? "",
          opinion_text:      it.opinion_text ?? "",
          opinion_image_url: it.opinion_image_url ?? "",
        })));
      } else {
        // 아이템이 없는 견적은 기본 1행
        setRows([newRow()]);
      }
      // 작업 라인 프리필
      const lns = (lines.data ?? []) as Array<{
        standard_id: number | null; work_name: string;
        man_days: number; remark: string | null; elevator_name: string | null;
      }>;
      setLaborLines(lns.map(l => newLaborLine({
        standard_id:   l.standard_id,
        work_name:     l.work_name,
        man_days:      Number(l.man_days),
        remark:        l.remark ?? "",
        elevator_name: l.elevator_name ?? "",
      })));
      setEditLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isEditMode, editId]);

  // 현장 변경 시 호기 + 계약/하자 정보 로드
  useEffect(() => {
    if (!siteName.trim()) {
      setElevatorOptions([]);
      setSiteInfo(null);
      setChargeAutoApplied(false);
      return;
    }
    (async () => {
      // 신DB: 현장은 managed_sites(site_name), 호기는 site_elevators(site_id FK)
      const { data: ms } = await supabase.from("managed_sites")
        .select("id, contract_type, contract_start, contract_end, warranty_start, warranty_end, company_type")
        .eq("site_name", siteName).maybeSingle();
      // 호기 식별 기준은 installation_place (비어있을 때만 unit_name fallback)
      const elev = (ms as { id?: number } | null)?.id != null
        ? await supabase.from("site_elevators")
            .select("installation_place, unit_name").eq("site_id", (ms as { id: number }).id).order("installation_place")
        : { data: [] as { installation_place: string | null; unit_name: string | null }[] };
      setElevatorOptions((elev.data ?? []).map(e => {
        const r = e as { installation_place: string | null; unit_name: string | null };
        return r.installation_place ?? r.unit_name ?? "";
      }).filter(Boolean));
      const info = (ms ?? null) as SiteContractInfo | null;
      setSiteInfo(info);
      // FM 계약구분이면 charge_type 자동 '무상' 권유 (수정 모드에서는 사용자가 저장한 값을 보존)
      if (!isEditMode && info?.contract_type && FM_CONTRACT_TYPES.has(info.contract_type)) {
        setChargeType("무상");
        setChargeAutoApplied(true);
      } else {
        setChargeAutoApplied(false);
      }
    })();
  }, [siteName]);

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  const admin = isAdmin(user);
  const canCreate = admin || hasMenuPermission(user, MENU_HREF, "create");

  // ============================================================
  // 자동 계산
  // ============================================================

  // 공수 표준/분류 파생 (연쇄 드롭다운용)
  const catById   = new Map(laborCats.map(c => [c.id, c]));
  const majorCats = laborCats.filter(c => c.level === "major");
  const midsOfMajor = (majorId: number | null) => laborCats.filter(c => c.level === "mid" && c.parent_id === majorId);
  const stdsOfMid   = (majorId: number | null, midId: number | null) => standards.filter(s => s.major_id === majorId && s.mid_id === midId);
  const stdLabel = (s: WorkloadStandard) =>
    [catById.get(s.major_id ?? -1)?.label, catById.get(s.mid_id ?? -1)?.label, s.detail].filter(Boolean).join(" · ");

  const materialSubtotal = rows.reduce((s, r) => s + (r.material_id ? r.qty * r.unit_price : 0), 0);
  // 작업 라인이 1건 이상이면 공수는 라인 man_days 합으로 자동 산출 (수동 입력란 대체)
  const hasLaborLines    = laborLines.length > 0;
  const laborLinesManhours = laborLines.reduce((s, l) => s + (l.man_days || 0), 0);
  const effectiveManhours  = hasLaborLines ? laborLinesManhours : laborManhours;
  // 공모드: direct = unit_price * manhours
  // 식모드: 식수=1 이지만 입력된 공수합 × 단가 로 동일하게 계산
  // 두 체크박스는 독립적:
  //  - directLaborOnly  = 직접인건비 적용 여부 (체크 시 직접인건비 계산)
  //  - laborEnabled     = 간접인건비/요율 적용 여부 (체크 시 간접·일관·이윤 계산)
  const directLabor      = directLaborOnly ? Math.round(laborUnitPrice * effectiveManhours) : 0;
  const indirectLabor    = laborEnabled    ? Math.round(directLabor * indirectRate / 100) : 0;
  const laborSubtotal    = directLabor + indirectLabor;
  const overhead         = laborEnabled    ? Math.round((materialSubtotal + laborSubtotal) * overheadRate / 100) : 0;
  const profit           = laborEnabled    ? Math.round((laborSubtotal + overhead) * profitRate / 100) : 0;

  const subBeforeTrunc = materialSubtotal + laborSubtotal + overhead + profit;
  const isMaterialOnly = laborSubtotal === 0 && overhead === 0 && profit === 0;
  useEffect(() => {
    if (truncateManual) return;
    setTruncateAmount(isMaterialOnly ? 0 : subBeforeTrunc % 1000);
  }, [subBeforeTrunc, isMaterialOnly, truncateManual]);

  const totalAmount = subBeforeTrunc - truncateAmount;
  // Nego 확정가가 있으면 부가세·합계는 그 금액 기준
  const negoActive      = negoAmount > 0;
  const effectiveSupply = negoActive ? negoAmount : totalAmount;
  const vatAmount   = Math.round(effectiveSupply * 0.1);
  const grandTotal  = effectiveSupply + vatAmount;

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

  // ── 작업 라인 (공수 표준 연동) ──────────────────────────────
  function patchLine(key: string, patch: Partial<LaborLine>) {
    setLaborLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  }
  function addLaborLine() {
    setLaborLines(prev => [...prev, newLaborLine()]);
  }
  function removeLaborLine(key: string) {
    setLaborLines(prev => prev.filter(l => l.key !== key));
  }
  // 연쇄 선택 핸들러
  function selectLineMajor(key: string, majorId: number | null) {
    patchLine(key, { major_id: majorId, mid_id: null, standard_id: null, work_name: "", man_days: 0 });
  }
  function selectLineMid(key: string, midId: number | null) {
    // 해당 중분류에 표준 항목이 1개뿐이면 자동 선택
    const line = laborLines.find(l => l.key === key);
    const only = midId != null ? standards.filter(s => s.mid_id === midId && s.major_id === line?.major_id) : [];
    if (only.length === 1) {
      const s = only[0];
      patchLine(key, { mid_id: midId, standard_id: s.id, work_name: stdLabel(s), man_days: s.man_days ?? 0 });
    } else {
      patchLine(key, { mid_id: midId, standard_id: null, work_name: "", man_days: 0 });
    }
  }
  function selectLineStandard(key: string, stdId: number | null) {
    const s = stdId != null ? standards.find(x => x.id === stdId) : null;
    if (s) patchLine(key, { standard_id: s.id, work_name: stdLabel(s), man_days: s.man_days ?? 0 });
    else patchLine(key, { standard_id: null, work_name: "", man_days: 0 });
  }

  // ── 견적 수정 내역 ──────────────────────────────────────────
  function patchNote(key: string, patch: Partial<RevisionNote>) {
    setRevisionNotes(prev => prev.map(n => n.key === key ? { ...n, ...patch } : n));
  }
  function addRevisionNote() {
    setRevisionNotes(prev => [...prev, newRevisionNote()]);
  }
  function removeRevisionNote(key: string) {
    setRevisionNotes(prev => prev.filter(n => n.key !== key));
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
      pastIssuances: [], pastLoading: false,
    });
    // 과거 출고 이력 조회 (현장+호기+자재 매치)
    // 행 elevator 가 비어 있으면 호기 자동완성 첫 값 사용
    const row = rows.find(r => r.key === key);
    const elev = (row?.elevator_name || "").trim();
    void loadPastIssuances(key, m.id, elev);
  }

  // 과거 출고 이력 로드 — site+elevator+material 매치
  async function loadPastIssuances(rowKey: string, materialId: string, elevator: string) {
    if (!siteName.trim() || !materialId) return;
    patchRow(rowKey, { pastLoading: true });
    let q = supabase.from("transactions")
      .select("created_at, qty, user_name, site_name, elevator_name, note")
      .eq("type", "출고")
      .eq("material_id", materialId)
      .eq("site_name", siteName)
      .order("created_at", { ascending: false })
      .limit(PAST_ISSUANCE_LIMIT);
    if (elevator) q = q.eq("elevator_name", elevator);
    const { data } = await q;
    patchRow(rowKey, {
      pastLoading: false,
      pastIssuances: (data ?? []) as PastIssuance[],
    });
  }

  // 현장/호기 변경 시 이미 자재가 선택된 행들의 이력 재조회
  useEffect(() => {
    rows.forEach(r => {
      if (!r.material_id) return;
      void loadPastIssuances(r.key, r.material_id, r.elevator_name.trim());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteName]);

  // ============================================================
  // 저장
  // ============================================================


  async function save() {
    setMessage(null);
    if (!canCreate || !user) { setMessage({ type: "error", text: "견적서 작성 권한이 없습니다." }); return; }
    if (isEditMode && editLockedReason) {
      setMessage({ type: "error", text: editLockedReason });
      return;
    }
    const validItems = rows.filter(r => r.material_id || r.material_name.trim());
    if (validItems.length === 0) {
      setMessage({ type: "error", text: "자재 라인을 1개 이상 입력해주세요." });
      return;
    }
    setSaving(true);
    try {
      // 헤더 elevator_name 은 행 elevator 의 유니크 집합으로 자동 도출 (단일이면 그 값, 복수면 콤마 결합)
      const elevSet = Array.from(new Set(validItems.map(r => r.elevator_name.trim()).filter(Boolean)));
      const headerElevator = elevSet.length === 0 ? null : elevSet.join(", ");

      const headerPayload = {
        quote_date: quoteDate,
        site_name: siteName || null,
        elevator_name: headerElevator,
        work_title: workTitle || null,
        customer_name: customerName || null,
        customer_phone: null,
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
        labor_manhours:   effectiveManhours,
        labor_unit_price: laborUnitPrice,
        vat_included:     vatIncluded,
        show_spec:        showSpec,
        show_revisions:   showRevisions,
        nego_amount:      negoAmount,
        charge_type:      chargeType,
        note: note || null,
      };
      // 작업 라인 payload (work_name 비어있지 않은 라인만)
      const validLines = laborLines.filter(l => l.work_name.trim() !== "");
      const laborLinesPayload = (quoteId: number) => validLines.map((l, i) => ({
        quote_id: quoteId,
        standard_id: l.standard_id,
        work_name: l.work_name.trim(),
        man_days: l.man_days || 0,
        unit_price: laborUnitPrice,
        amount: Math.round((l.man_days || 0) * laborUnitPrice),
        remark: l.remark || null,
        elevator_name: l.elevator_name || null,
        sort_order: (i + 1) * 10,
      }));
      // 견적 수정 내역 payload (내용 있는 행만)
      const validNotes = revisionNotes.filter(n => n.content.trim() !== "");
      const revisionNotesPayload = (quoteId: number) => validNotes.map((n, i) => ({
        quote_id: quoteId,
        revised_date: n.revised_date,
        content: n.content.trim(),
        sort_order: (i + 1) * 10,
      }));
      const itemsPayload = (quoteId: number) => validItems.map((r, i) => ({
        quote_id: quoteId,
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
      }));

      if (isEditMode && editId !== null) {
        // ─────────── 수정 모드 ───────────
        // 변경 전 스냅샷 (실패해도 진행)
        try {
          await supabase.rpc("snapshot_quote", {
            p_quote_id:  editId,
            p_summary:   "견적서 수정 (작성중)",
            p_user_id:   user.id,
            p_user_name: user.name,
          });
        } catch (e) { console.warn("[quote-edit] snapshot 실패", e); }

        const { error: e1 } = await supabase.from("quotes")
          .update({ ...headerPayload, updated_at: new Date().toISOString() })
          .eq("id", editId);
        if (e1) throw e1;

        // items 는 전체 DELETE 후 INSERT (1:N 단순 정합성)
        const { error: e2 } = await supabase.from("quote_items").delete().eq("quote_id", editId);
        if (e2) throw e2;
        const { error: e3 } = await supabase.from("quote_items").insert(itemsPayload(editId));
        if (e3) throw e3;

        // 작업 라인도 동일하게 전체 DELETE 후 INSERT
        const { error: e2b } = await supabase.from("quote_labor_lines").delete().eq("quote_id", editId);
        if (e2b) throw e2b;
        if (validLines.length > 0) {
          const { error: e3b } = await supabase.from("quote_labor_lines").insert(laborLinesPayload(editId));
          if (e3b) throw e3b;
        }

        // 수정 내역도 전체 DELETE 후 INSERT
        const { error: e2c } = await supabase.from("quote_revision_notes").delete().eq("quote_id", editId);
        if (e2c) throw e2c;
        if (validNotes.length > 0) {
          const { error: e3c } = await supabase.from("quote_revision_notes").insert(revisionNotesPayload(editId));
          if (e3c) throw e3c;
        }

        setMessage({
          type: "success",
          text: `견적서가 수정되었습니다. (${editQuoteNo ?? `#${editId}`})`,
        });
        setSaving(false);
        // 잠시 메시지 표시 후 상세로 이동
        setTimeout(() => router.push(`/quotes/detail?id=${editId}`), 600);
        return;
      }

      // ─────────── 신규 작성 모드 ───────────
      const quote_no = await generateDocNo("Q", quoteDate);
      const { data: header, error: e1 } = await supabase.from("quotes").insert({
        quote_no,
        ...headerPayload,
        created_by_id: user.id,
        created_by_name: user.name,
      }).select().single();
      if (e1 || !header) throw e1 || new Error("견적서 생성 실패");

      const { error: e2 } = await supabase.from("quote_items").insert(itemsPayload(header.id));
      if (e2) throw e2;

      if (validLines.length > 0) {
        const { error: e2b } = await supabase.from("quote_labor_lines").insert(laborLinesPayload(header.id));
        if (e2b) throw e2b;
      }
      if (validNotes.length > 0) {
        const { error: e2c } = await supabase.from("quote_revision_notes").insert(revisionNotesPayload(header.id));
        if (e2c) throw e2c;
      }

      // 견적요청으로부터 진입한 경우 → quote_request.quote_id 연결 + 상태 갱신 + 신청자 알림
      if (sourceRequestId && header.id) {
        await supabase.from("quote_requests")
          .update({ quote_id: header.id, status: "견적발행" })
          .eq("id", sourceRequestId);
        // 견적요청자에게 발행 알림 (본인이 자기 견적 발행한 경우 제외). 실패 silent.
        void (async () => {
          try {
            const { data: qr } = await supabase.from("quote_requests")
              .select("requester_id, site_name, work_title")
              .eq("id", sourceRequestId).maybeSingle();
            const requesterId = qr?.requester_id as number | null | undefined;
            if (requesterId && requesterId !== user.id) {
              const site = qr?.site_name ?? siteName;
              const work = qr?.work_title ?? null;
              await insertNotification({
                userId:  requesterId,
                type:    "quote_published",
                title:   "요청하신 견적이 발행되었습니다",
                message: `[${site}]${work ? ` ${work}` : ""} — 견적번호 ${quote_no}`,
                link:    `/quotes/detail?id=${header.id}`,
                refType: "quote",
                refId:   header.id,
              });
            }
          } catch (e) { console.warn("[notify] 견적발행 알림 실패:", e); }
        })();
      }

      setMessage({
        type: "success",
        text: sourceRequestNo
          ? `견적서가 등록되었습니다. (${quote_no}) — 견적요청 ${sourceRequestNo} 연결 완료`
          : `견적서가 등록되었습니다. (${quote_no})`,
      });
      // 폼 리셋
      setRows(Array.from({ length: DEFAULT_ROW_COUNT }, () => newRow()));
      setSiteName(""); setCustomerName("");
      setNote("");
      setChargeType("유상");
      setChargeAutoApplied(false);
      setLaborMode("공");
      setLaborManhours(1);
      setLaborLines([]);
      setVatIncluded(false);
      setShowSpec(true);
      setRevisionNotes([]);
      setShowRevisions(false);
      setNegoAmount(0);
      setLaborUnitPrice(settings?.default_direct_labor ?? 0);
      setLaborEnabled(true);
      setTruncateManual(false);
      setTruncateAmount(0);
      setSourceRequestId(null);
      setSourceRequestNo(null);
    } catch (e) {
      console.error("[quote-save] 실패", e);
      setMessage({ type: "error", text: formatError(e) });
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

  if (isEditMode && editLoading) {
    return <div className="p-12 text-center text-sm text-gray-500">견적서 불러오는 중...</div>;
  }
  if (isEditMode && editLoadError) {
    return <div className="p-12 text-center text-sm text-red-500">{editLoadError}</div>;
  }

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            {isEditMode ? "견적서 수정" : "견적서 작성"}
          </h1>
          {isEditMode && editQuoteNo && (
            <span className="text-[11px] px-2.5 py-1 rounded-full font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-mono">
              ✏️ {editQuoteNo}
            </span>
          )}
          {sourceRequestNo && (
            <span className="text-[11px] px-2.5 py-1 rounded-full font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              📋 견적요청 {sourceRequestNo} 에서 가져옴
            </span>
          )}
        </div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">자재비·인건비·일반관리비·이윤 자동 계산</p>
        {isEditMode && editLockedReason && (
          <div className="mt-3 text-xs px-3 py-2 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700">
            🔒 {editLockedReason}
          </div>
        )}
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
            <div>
              <label className={labelCls}>현장명 <span className="text-[10px] text-gray-400">(검색/직접입력)</span></label>
              <SiteInlineSearch value={siteName} onChange={setSiteName} sites={sites} inputCls={inputCls} />
              {elevatorOptions.length > 0 && (
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  ※ 이 현장의 호기 {elevatorOptions.length}개 — 자재 행의 [호기] 입력란 클릭 시 자동완성됨
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>견적신청자 <span className="text-[10px] text-gray-400">(사원 검색/직접입력{sourceRequestId ? " · 요청목록 자동" : ""})</span></label>
              <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} lang="ko" list="quote-requester-opts" className={inputCls} />
              <datalist id="quote-requester-opts">
                {employees.map(emp => (
                  <option key={emp.id} value={emp.name}>{[emp.dept, emp.team].filter(Boolean).join(" / ")}</option>
                ))}
              </datalist>
            </div>
            <div className="lg:col-span-2">
              <label className={labelCls}>작업명</label>
              <input type="text" value={workTitle} onChange={e => setWorkTitle(e.target.value)} lang="ko" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>견적작성자</label>
              <input type="text" readOnly value={isEditMode ? editCreatedBy : (user?.name ?? "")}
                className={inputCls + " bg-gray-100 dark:bg-gray-600 cursor-not-allowed"} />
            </div>
          </div>
        </div>

        {/* 현장 계약·하자기간 카드 */}
        {siteInfo && <SiteContractCard info={siteInfo} siteName={siteName} />}

        {/* 자재비 라인 */}
        <div className={sectionCls}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">📦 자재비</h2>
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-semibold text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={showSpec} onChange={e => setShowSpec(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                규격 표시
              </label>
            </div>
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
                          onChange={e => {
                            const nv = e.target.value;
                            patchRow(r.key, { elevator_name: nv });
                            if (r.material_id) {
                              // 호기가 변경되면 과거 이력 재조회
                              setTimeout(() => loadPastIssuances(r.key, r.material_id, nv.trim()), 200);
                            }
                          }}
                          placeholder={elevatorOptions[0] ?? "호기"}
                          className={cellInput + " text-center"} />
                      </td>
                      <td className="px-1 py-0.5 relative">
                        <div className="flex items-center gap-1">
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
                          {r.material_id && (r.pastIssuances.length > 0 || r.pastLoading) && (
                            <PastIssuanceBubble row={r} />
                          )}
                        </div>
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
                                      <span className="text-[10px] ml-auto text-gray-400">{fmtNum(m.sellPrice ?? 0)}원</span>
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
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={directLaborOnly}
                  onChange={e => setDirectLaborOnly(e.target.checked)}
                  className="w-4 h-4 accent-blue-600" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">직접인건비 적용</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={laborEnabled}
                  onChange={e => setLaborEnabled(e.target.checked)}
                  className="w-4 h-4 accent-blue-600" />
                <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">👷 요율 적용</h2>
              </label>
              {!laborEnabled && (
                <span className="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
                  미적용 — 자재비만 합계 반영
                </span>
              )}
            </div>
            <div className={`flex gap-0.5 bg-gray-100 dark:bg-gray-700 p-0.5 rounded ${!laborEnabled ? "opacity-50 pointer-events-none" : ""}`}>
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
          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 ${!laborEnabled ? "opacity-50 pointer-events-none" : ""}`}>
            <div>
              <label className={labelCls}>1공 단가 <span className="text-[10px] text-gray-400">(기본값 자동)</span></label>
              <input type="text" inputMode="numeric" value={laborUnitPrice === 0 ? "" : fmtNum(laborUnitPrice)}
                onChange={e => setLaborUnitPrice(parseNum(e.target.value))}
                className={inputCls + " text-right tabular-nums font-semibold"} />
            </div>
            <div>
              <label className={labelCls}>
                {laborMode === "공" ? "공수" : "통합 공수합"}
                {hasLaborLines
                  ? <span className="text-[10px] text-blue-500 ml-1">(작업 라인 합 자동)</span>
                  : laborMode === "식" && <span className="text-[10px] text-gray-400 ml-1">(여러 작업 합)</span>}
              </label>
              <input type="text" inputMode="decimal"
                value={hasLaborLines ? String(effectiveManhours) : (laborManhours === 0 ? "" : String(laborManhours))}
                onChange={e => setLaborManhours(parseDecimal(e.target.value))}
                readOnly={hasLaborLines}
                placeholder="예: 2.5"
                className={inputCls + " text-right tabular-nums font-semibold" + (hasLaborLines ? " bg-gray-100 dark:bg-gray-600 cursor-not-allowed" : "")} />
              <div className="text-[11px] text-gray-500 mt-1">
                {laborMode === "공"
                  ? `${effectiveManhours}공 × ${fmtNum(laborUnitPrice)}원 = ${fmtNum(directLabor)}원`
                  : `1식 (${effectiveManhours}공 통합) × ${fmtNum(laborUnitPrice)}원 = ${fmtNum(directLabor)}원`}
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

          {/* 교체공사 작업 라인 (표준 공수 연동) */}
          <div className={`mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 ${!laborEnabled ? "opacity-50 pointer-events-none" : ""}`}>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h3 className="text-xs font-bold text-gray-700 dark:text-gray-200">
                🔧 교체공사 작업 라인 <span className="text-[10px] font-normal text-gray-400">(표준 선택 시 공수 자동 · 합계가 위 공수에 반영)</span>
              </h3>
              <button type="button" onClick={addLaborLine}
                className="text-[11px] font-semibold px-2.5 py-1 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50">
                + 작업 추가
              </button>
            </div>
            {laborLines.length === 0 ? (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 py-2">
                작업 라인을 추가하면 <b>대분류 → 중분류 → 항목</b> 순으로 표준 공수를 선택할 수 있습니다. (미사용 시 위 공수 직접 입력)
              </p>
            ) : (
              <div className="overflow-visible">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="px-1 py-1 text-left font-semibold" style={{ width: 150 }}>대분류</th>
                      <th className="px-1 py-1 text-left font-semibold" style={{ width: 130 }}>중분류</th>
                      <th className="px-1 py-1 text-left font-semibold" style={{ minWidth: 160 }}>항목 (상세 · 공수)</th>
                      <th className="px-1 py-1 text-right font-semibold" style={{ width: 60 }}>공수</th>
                      <th className="px-1 py-1 text-right font-semibold" style={{ width: 100 }}>금액</th>
                      <th className="px-1 py-1 text-left font-semibold" style={{ width: 80 }}>호기</th>
                      <th className="px-1 py-1 text-left font-semibold">비고</th>
                      <th className="px-1 py-1" style={{ width: 28 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {laborLines.map(l => {
                      const mids = midsOfMajor(l.major_id);
                      const items = stdsOfMid(l.major_id, l.mid_id);
                      const lineAmount = Math.round((l.man_days || 0) * laborUnitPrice);
                      const selCls = "w-full px-1 py-1 text-xs text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300 disabled:opacity-50";
                      return (
                        <tr key={l.key} className="border-b border-gray-100 dark:border-gray-700/50">
                          <td className="px-1 py-0.5">
                            <select value={l.major_id ?? ""} onChange={e => selectLineMajor(l.key, e.target.value ? Number(e.target.value) : null)} className={selCls}>
                              <option value="">대분류</option>
                              {majorCats.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                            </select>
                          </td>
                          <td className="px-1 py-0.5">
                            <select value={l.mid_id ?? ""} onChange={e => selectLineMid(l.key, e.target.value ? Number(e.target.value) : null)} disabled={l.major_id == null} className={selCls}>
                              <option value="">{l.major_id == null ? "—" : "중분류"}</option>
                              {mids.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                            </select>
                          </td>
                          <td className="px-1 py-0.5">
                            <select value={l.standard_id ?? ""} onChange={e => selectLineStandard(l.key, e.target.value ? Number(e.target.value) : null)} disabled={l.mid_id == null} className={selCls}>
                              <option value="">{l.mid_id == null ? "—" : "항목 선택"}</option>
                              {items.map(s => (
                                <option key={s.id} value={s.id}>
                                  {(s.detail || "기본")} · {s.man_days == null ? "별도견적" : `${s.man_days}공`}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-1 py-0.5">
                            <input type="text" inputMode="decimal"
                              value={l.man_days === 0 ? "" : String(l.man_days)}
                              onChange={e => patchLine(l.key, { man_days: parseDecimal(e.target.value) })}
                              placeholder="0"
                              className={cellInput + " text-right tabular-nums"} />
                          </td>
                          <td className="px-1 py-0.5 text-right tabular-nums text-gray-700 dark:text-gray-200">{fmtNum(lineAmount)}</td>
                          <td className="px-1 py-0.5">
                            <input type="text" value={l.elevator_name}
                              onChange={e => patchLine(l.key, { elevator_name: e.target.value })}
                              className={cellInput} />
                          </td>
                          <td className="px-1 py-0.5">
                            <input type="text" value={l.remark}
                              onChange={e => patchLine(l.key, { remark: e.target.value })}
                              className={cellInput} />
                          </td>
                          <td className="px-1 py-0.5 text-center">
                            <button type="button" onClick={() => removeLaborLine(l.key)} className="text-red-400 hover:text-red-600">×</button>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="font-bold bg-gray-50 dark:bg-gray-700/40">
                      <td className="px-1 py-1 text-right text-gray-600 dark:text-gray-300" colSpan={3}>합계</td>
                      <td className="px-1 py-1 text-right tabular-nums text-gray-700 dark:text-gray-200">{effectiveManhours}공</td>
                      <td className="px-1 py-1 text-right tabular-nums text-blue-600 dark:text-blue-400">{fmtNum(Math.round(effectiveManhours * laborUnitPrice))}</td>
                      <td colSpan={3}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* 합계 + 절사 + 특기사항 */}
        <div className={sectionCls}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">💰 합계</h2>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">견적 대표 금액:</span>
              <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 p-0.5 rounded">
                {([[false, "부가세 별도"], [true, "부가세 포함"]] as [boolean, string][]).map(([v, l]) => (
                  <button key={l} type="button" onClick={() => setVatIncluded(v)}
                    className={`px-3 py-1 text-[11px] font-bold rounded transition-colors ${
                      vatIncluded === v ? "bg-blue-600 text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                    }`}>{l}</button>
                ))}
              </div>
            </div>
          </div>
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
                      {laborEnabled
                        ? `(${laborMode === "공"
                            ? `${effectiveManhours}공 + 간접 ${indirectRate}%`
                            : `1식(${effectiveManhours}공 통합) + 간접 ${indirectRate}%`})`
                        : "(미적용)"}
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-gray-800 dark:text-gray-100">{fmtNum(laborSubtotal)} 원</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-gray-600 dark:text-gray-300">
                    3. 일반관리비 {laborEnabled ? `(${overheadRate}%)` : <span className="text-xs text-gray-400">(미적용)</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-gray-800 dark:text-gray-100">{fmtNum(overhead)} 원</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-gray-600 dark:text-gray-300">
                    4. 이윤 {laborEnabled ? `(${profitRate}%)` : <span className="text-xs text-gray-400">(미적용)</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-gray-800 dark:text-gray-100">{fmtNum(profit)} 원</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-gray-600 dark:text-gray-300">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>5. 절사금액</span>
                      <input type="text" inputMode="numeric" value={truncateAmount === 0 ? "" : fmtNum(truncateAmount)}
                        onChange={e => { setTruncateAmount(parseNum(e.target.value)); setTruncateManual(true); }}
                        placeholder="0" className="w-32 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-right tabular-nums" />
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
                {negoActive && (
                  <tr className="border-t-2 border-gray-400 dark:border-gray-500">
                    <td className="py-2 font-bold text-base text-red-600 dark:text-red-400">Nego확정가 (VAT별도)</td>
                    <td className="py-2 text-right tabular-nums font-bold text-lg text-red-600 dark:text-red-400">{fmtNum(negoAmount)} 원</td>
                  </tr>
                )}
                <tr className={negoActive ? "" : "border-t-2 border-gray-400 dark:border-gray-500"}>
                  <td className={`py-2 ${!vatIncluded ? "font-bold text-base text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-300"}`}>공급가액</td>
                  <td className={`py-2 text-right tabular-nums ${!vatIncluded ? "font-bold text-lg text-blue-600 dark:text-blue-400" : "text-gray-700 dark:text-gray-200"}`}>{fmtNum(totalAmount)} 원</td>
                </tr>
                <tr>
                  <td className="py-1 text-gray-600 dark:text-gray-300">부가가치세 (10%)</td>
                  <td className="py-1 text-right tabular-nums text-gray-700 dark:text-gray-200">{fmtNum(vatAmount)} 원</td>
                </tr>
                <tr>
                  <td className={`py-2 ${vatIncluded ? "font-bold text-base text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-300"}`}>합계 (부가세 포함)</td>
                  <td className={`py-2 text-right tabular-nums ${vatIncluded ? "font-bold text-lg text-blue-600 dark:text-blue-400" : "text-gray-700 dark:text-gray-200"}`}>{fmtNum(grandTotal)} 원</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <label className={labelCls}>특기사항</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} lang="ko"
              className={inputCls + " resize-none"} />
          </div>

          {/* Nego 확정가 (VAT 별도) */}
          <div className="mt-4">
            <label className={labelCls}>
              <span className="text-red-600 dark:text-red-400">Nego확정가 (VAT별도)</span>
              <span className="text-[10px] text-gray-400 ml-1">(협상 확정 시 입력 — 부가세·합계가 이 금액 기준으로 계산됨. 미입력 시 공급가액 사용)</span>
            </label>
            <div className="flex items-center gap-4 flex-wrap">
              <input type="text" inputMode="numeric" value={negoAmount === 0 ? "" : fmtNum(negoAmount)}
                onChange={e => setNegoAmount(parseNum(e.target.value))}
                placeholder="미입력"
                className={inputCls + " text-right tabular-nums font-bold text-red-600 dark:text-red-400 max-w-xs"} />
              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                네고전 금액 {fmtNum(totalAmount)}원
              </span>
              {negoActive && (
                <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                  네고된 금액 {fmtNum(totalAmount - negoAmount)}원
                </span>
              )}
            </div>
          </div>

          {/* 견적 수정 내역 */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <label className={labelCls + " mb-0"}>✏️ 견적 수정 내역</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-semibold text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={showRevisions} onChange={e => setShowRevisions(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                  출력물에 표시
                </label>
                <button type="button" onClick={addRevisionNote}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50">+ 수정내역 추가</button>
              </div>
            </div>
            {revisionNotes.length === 0 ? (
              <p className="text-[11px] text-gray-400 dark:text-gray-500">수정 내역이 없습니다. [+ 수정내역 추가]로 일자·내용을 기록할 수 있습니다.</p>
            ) : (
              <div className="space-y-1.5">
                {revisionNotes.map(n => (
                  <div key={n.key} className="flex items-center gap-2">
                    <input type="date" value={n.revised_date} onChange={e => patchNote(n.key, { revised_date: e.target.value })}
                      className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 tabular-nums shrink-0" />
                    <input type="text" value={n.content} onChange={e => patchNote(n.key, { content: e.target.value })} lang="ko"
                      placeholder="수정 내용" className="flex-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
                    <button type="button" onClick={() => removeRevisionNote(n.key)} className="text-red-400 hover:text-red-600 px-1 shrink-0">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {message && (
            <div className={`mt-3 text-xs px-3 py-2 rounded ${
              message.type === "success" ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                         : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
            }`}>{message.text}</div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button"
              onClick={() => router.push(isEditMode && editId !== null ? `/quotes/detail?id=${editId}` : "/dashboard")}
              className="px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">
              {isEditMode ? "← 상세로" : "취소"}
            </button>
            <button type="button" onClick={() => setPreviewOpen(true)}
              className="px-4 py-2 rounded border border-blue-300 dark:border-blue-700 text-sm text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 font-semibold">
              👁 미리보기
            </button>
            <button type="button" onClick={save}
              disabled={saving || (isEditMode && !!editLockedReason)}
              className="px-5 py-2 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving
                ? "저장 중..."
                : isEditMode ? "수정 저장" : "견적서 저장"}
            </button>
          </div>
        </div>
      </div>

      {/* 미리보기 오버레이 (출력물) — body 직접 자식으로 띄워야 AdminShell의 absolute 탭 컨테이너에 갇히지 않음 */}
      {previewOpen && typeof window !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 bg-gray-100 dark:bg-gray-900 overflow-auto quote-preview-overlay">
          {/* 상단 툴바 — 인쇄 시 숨김 */}
          <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm px-4 py-2 flex items-center gap-2 print:hidden">
            <span className="text-sm font-bold text-gray-800 dark:text-gray-100">
              👁 견적서 미리보기
              <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                {isEditMode && editQuoteNo ? `(${editQuoteNo})` : "(저장 전)"}
              </span>
            </span>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => window.print()}
                className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white font-semibold hover:bg-blue-700">
                🖨 인쇄
              </button>
              <button type="button" onClick={() => setPreviewOpen(false)}
                className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                ✕ 닫기
              </button>
            </div>
          </div>

          <div className="p-6 print:p-0">
            <QuotePrintPaper
              preview={!isEditMode || !editQuoteNo}
              header={{
                quote_no:           isEditMode && editQuoteNo ? editQuoteNo : "(저장 전 미리보기)",
                quote_date:         quoteDate,
                site_name:          siteName || null,
                elevator_name:      (() => {
                  const elevSet = Array.from(new Set(rows.filter(r => r.material_id || r.material_name.trim()).map(r => r.elevator_name.trim()).filter(Boolean)));
                  return elevSet.length === 0 ? null : elevSet.join(", ");
                })(),
                work_title:         workTitle || null,
                customer_name:      customerName || null,
                customer_phone:     null,
                material_subtotal:  materialSubtotal,
                direct_labor:       directLabor,
                indirect_labor:     indirectLabor,
                indirect_labor_rate: indirectRate,
                overhead,
                overhead_rate:       overheadRate,
                profit,
                profit_rate:         profitRate,
                truncate_amount:     truncateAmount,
                total_amount:        totalAmount,
                note:                note || null,
                labor_mode:          laborMode,
                labor_manhours:      effectiveManhours,
                labor_unit_price:    laborUnitPrice,
                vat_included:        vatIncluded,
                show_spec:           showSpec,
                show_revisions:      showRevisions,
                nego_amount:         negoAmount,
              }}
              revisionNotes={revisionNotes.filter(n => n.content.trim()).map(n => ({ revised_date: n.revised_date, content: n.content.trim() }))}
              laborLines={laborEnabled
                ? laborLines.filter(l => l.work_name.trim()).map(l => ({
                    work_name: l.work_name.trim(),
                    man_days: l.man_days || 0,
                    unit_price: laborUnitPrice,
                    amount: Math.round((l.man_days || 0) * laborUnitPrice),
                  }))
                : []}
              items={rows
                .filter(r => r.material_id || r.material_name.trim())
                .map((r, i) => ({
                  id: i,
                  material_id: r.material_id || null,
                  material_name: r.material_name,
                  spec: r.spec || null,
                  unit: r.unit || null,
                  qty: r.qty,
                  unit_price: r.unit_price,
                  amount: r.qty * r.unit_price,
                  remark: r.remark || null,
                  opinion_text: r.opinion_text || null,
                  opinion_image_url: r.opinion_image_url || null,
                }))
              }
              company={company}
            />
          </div>

          {/* 인쇄 시 미리보기만 출력되도록 격리 — portal로 body 직접 자식이 됐으므로 display 방식으로 깔끔히 격리 */}
          <style jsx global>{`
            @media print {
              html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
              body > *:not(.quote-preview-overlay) { display: none !important; }
              .quote-preview-overlay {
                position: static !important;
                background: white !important;
                overflow: visible !important;
                inset: auto !important;
              }
            }
          `}</style>
        </div>,
        document.body
      )}
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

// ============================================================
// 현장 계약·하자기간 카드
// ============================================================

function SiteContractCard({ info, siteName }: { info: SiteContractInfo; siteName: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const contractDays = daysBetween(today, info.contract_end);
  const warrantyDays = daysBetween(today, info.warranty_end);
  const isFm = info.contract_type ? FM_CONTRACT_TYPES.has(info.contract_type) : false;
  const inWarranty = warrantyDays !== null && warrantyDays >= 0;

  return (
    <div className={`rounded-xl border p-4 ${
      isFm
        ? "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700"
        : "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700"
    }`}>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="text-sm font-bold text-gray-800 dark:text-gray-100">📍 {siteName}</span>
        {info.company_type && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
            {info.company_type}
          </span>
        )}
        {info.contract_type && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
            isFm
              ? "bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-100"
              : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
          }`}>
            {info.contract_type}{isFm && " (Full Maintenance)"}
          </span>
        )}
        {inWarranty && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300">
            🛡️ 하자기간 — D-{warrantyDays}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
        <div className="flex flex-col">
          <span className="text-gray-500 dark:text-gray-400">계약기간</span>
          <span className="font-mono text-gray-700 dark:text-gray-200">
            {fmtYmd(info.contract_start)} ~ {fmtYmd(info.contract_end)}
            {contractDays !== null && (
              <span className={`ml-2 ${contractDays < 0 ? "text-red-500" : "text-gray-400"}`}>
                ({contractDays < 0 ? `만료 ${-contractDays}일 경과` : `D-${contractDays}`})
              </span>
            )}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-gray-500 dark:text-gray-400">하자기간</span>
          <span className="font-mono text-gray-700 dark:text-gray-200">
            {fmtYmd(info.warranty_start)} ~ {fmtYmd(info.warranty_end)}
            {warrantyDays !== null && (
              <span className={`ml-2 ${warrantyDays < 0 ? "text-gray-400" : "text-rose-500 font-bold"}`}>
                ({warrantyDays < 0 ? `만료 ${-warrantyDays}일 경과` : `D-${warrantyDays}`})
              </span>
            )}
          </span>
        </div>
      </div>
      {isFm && (
        <div className="mt-3 text-[11px] text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/40 px-3 py-2 rounded border border-amber-200 dark:border-amber-700">
          ⚠️ FM(Full Maintenance) 현장입니다. 자재는 무상 제공 — 견적서 대신 [자재신청]을 사용해 주세요.
        </div>
      )}
    </div>
  );
}

// ============================================================
// 자재 라인 과거 출고 이력 풍선말
// ============================================================

function PastIssuanceBubble({ row }: { row: ItemRow }) {
  const [open, setOpen] = useState(false);
  if (row.pastLoading) {
    return <span className="text-[9px] text-gray-400 px-1 whitespace-nowrap">…</span>;
  }
  const count = row.pastIssuances.length;
  if (count === 0) return null;
  return (
    <span className="relative inline-block">
      <button type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen(o => !o)}
        title={`이 현장·호기·자재의 과거 출고 ${count}건`}
        className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold hover:bg-blue-200 dark:hover:bg-blue-800/50 cursor-help">
        📜{count}
      </button>
      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 w-72 bg-slate-900 text-white rounded-lg shadow-xl p-2 text-[10px]">
          <div className="font-bold text-[11px] mb-1.5 text-blue-300">
            과거 출고 이력 (최근 {count}건)
          </div>
          <ul className="space-y-1">
            {row.pastIssuances.map((p, i) => (
              <li key={i} className="flex items-center gap-2 border-b border-slate-700 pb-1 last:border-0 last:pb-0">
                <span className="font-mono text-slate-300 w-24 shrink-0">{fmtYmd(p.created_at)}</span>
                <span className="text-amber-300 font-bold tabular-nums w-12 text-right">{fmtNum(p.qty)}</span>
                <span className="text-slate-400 truncate">{p.user_name ?? "-"}</span>
              </li>
            ))}
          </ul>
          <div className="mt-1 pt-1 border-t border-slate-700 text-[9px] text-slate-400">
            마우스 호버 / 클릭으로 표시
          </div>
        </div>
      )}
    </span>
  );
}
