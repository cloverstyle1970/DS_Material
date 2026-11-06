"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useViewMode } from "@/context/ViewModeContext";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api-client";
import { MaterialRecord } from "@/lib/mock-materials";
import { visibleUserIds } from "@/lib/crew";
import { insertNotification } from "@/lib/notify";
import { isRepairMaterial, isTkMaterial, TK_TEXT_CLASS } from "@/lib/material-style";
import { PhotoIconBtn } from "@/components/ui/PhotoIconBtn";
import { getMaterialManagers, setMaterialManagerIds, type MaterialManager } from "@/lib/material-managers";
import { isAdmin } from "@/context/AuthContext";

const DEFAULT_ROW_COUNT = 1;

type ClaimMode = "유상견적요청" | "무상신청" | "당직선출고";

const MODES: { key: ClaimMode; label: string; icon: string; desc: string; color: string }[] = [
  { key: "유상견적요청", label: "유상 (견적요청)",   icon: "💰", desc: "견적 담당자가 견적서를 작성합니다.",         color: "bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300" },
  { key: "무상신청",     label: "무상 (자재신청)",    icon: "🆓", desc: "FM(Full Maintenance) 현장 등 무상 자재 신청.", color: "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300" },
  { key: "당직선출고",   label: "당직 (선출고)",      icon: "🌙", desc: "당직 중 즉시 출고 → 사후 견적요청 처리.",     color: "bg-purple-50 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300" },
];

interface SiteOption { id: number; name: string; alias?: string | null; search_keywords?: string | null }

// ─── 본인 청구 이력 ─────────────────────────────────
type HistoryKind = "유상견적요청" | "무상신청" | "당직선출고";
interface HistoryRow {
  source: "quote_request" | "material_request";
  rowId: number;
  no: string | null;            // QR-YYYY-NNNN (유상견적요청만)
  date: string;                 // ISO
  siteName: string | null;
  workTitle: string | null;
  requesterName: string | null;
  itemFirstName: string;
  itemCount: number;
  kind: HistoryKind;
  status: string;
  quoteId: number | null;       // 견적서로 연결된 ID (유상견적요청만)
  approvalStatus: "pending" | "approved" | "rejected" | null;
  rejectReason: string | null;
  photoUrls: string[] | null;
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
  return `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
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
  elevOpen: boolean;
}

function newRow(seed: Partial<ItemRow> = {}): ItemRow {
  return {
    key: crypto.randomUUID(),
    material_id: "", material_name: "", spec: "", unit: "EA",
    qty: 1, elevator_name: "", remark: "",
    searchOpen: false, searchResults: [], searchFocusIndex: -1,
    elevOpen: false,
    ...seed,
  };
}

export default function ClaimEntryClient() {
  const { user } = useAuth();
  const { viewMode } = useViewMode();
  const isMobile = viewMode === "mobile";
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams ? (Number(searchParams.get("editId")) || null) : null;
  const [mode, setMode] = useState<ClaimMode>("유상견적요청");

  // 헤더
  const [siteName, setSiteName] = useState("");
  const [workTitle, setWorkTitle] = useState("");
  const [reason, setReason]       = useState("");

  // 무상신청 사진 슬롯
  interface PhotoSlot { key: string; file: File | null; previewUrl: string | null }
  const [photos, setPhotos] = useState<PhotoSlot[]>([{ key: crypto.randomUUID(), file: null, previewUrl: null }]);
  const [existingPhotoUrls, setExistingPhotoUrls] = useState<string[]>([]);
  function addPhotoSlot() { setPhotos(prev => [...prev, { key: crypto.randomUUID(), file: null, previewUrl: null }]); }
  function removePhotoSlot(key: string) {
    setPhotos(prev => {
      const slot = prev.find(p => p.key === key);
      if (slot?.previewUrl) URL.revokeObjectURL(slot.previewUrl);
      return prev.length === 1 ? [{ key: crypto.randomUUID(), file: null, previewUrl: null }] : prev.filter(p => p.key !== key);
    });
  }
  function setPhotoFile(key: string, file: File | null) {
    setPhotos(prev => prev.map(p => {
      if (p.key !== key) return p;
      if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      return { key, file, previewUrl: file ? URL.createObjectURL(file) : null };
    }));
  }

  // 자재 라인
  const [rows, setRows] = useState<ItemRow[]>(() => Array.from({ length: DEFAULT_ROW_COUNT }, () => newRow()));

  // 청구정보의 기본 자재구분 — 변경 시 자재목록 필터에 기본 적용 (자재목록에서 개별 변경 가능)
  const [claimMatType, setClaimMatType] = useState<"DS" | "TK" | "ALL">("DS");
  // 자재 검색 매터타입 (청구정보 기본값에서 시작, 자재목록에서 변경 가능)
  const [matTypeFilter, setMatTypeFilter] = useState<"DS" | "TK" | "ALL">("DS");

  // 사이트/호기 마스터
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [elevatorOptions, setElevatorOptions] = useState<string[]>([]);

  // 저장 상태
  const [saving, setSaving]     = useState(false);
  const [message, setMessage]   = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 청구 이력
  const [history, setHistory]     = useState<HistoryRow[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histKindFilter, setHistKindFilter] = useState<"전체" | HistoryKind>("전체");
  const todayStr = new Date().toISOString().slice(0, 10);
  const oneMonthAgo = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })();
  const [histFrom, setHistFrom]   = useState(oneMonthAgo);
  const [histTo, setHistTo]       = useState(todayStr);
  const [histPage, setHistPage]   = useState(1);
  const HIST_PAGE_SIZE = 10;

  // 무상신청 승인자 선택 모달
  const [showApproverModal, setShowApproverModal] = useState(false);
  const [approverModalForSave, setApproverModalForSave] = useState(false); // true=저장연동, false=상태변경만
  const [approverList, setApproverList] = useState<{ id: number; name: string; dept: string | null }[]>([]);
  const [approverListLoading, setApproverListLoading] = useState(false);
  const [selectedApproverId, setSelectedApproverId] = useState<number | null>(null);
  const [selectedApproverName, setSelectedApproverName] = useState("");
  const [approverSearch, setApproverSearch] = useState("");

  // 자재담당자 설정 (관리자 전용)
  const [managers, setManagers] = useState<MaterialManager[]>([]);
  const [managerSaving, setManagerSaving] = useState(false);
  const [managerMsg, setManagerMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [allAccounts, setAllAccounts] = useState<{ id: number; name: string; dept: string | null }[]>([]);
  const [managerSearch, setManagerSearch] = useState("");

  useEffect(() => {
    api.get<SiteOption[]>("/api/sites").then(setSites).catch(() => {});
  }, []);

  // 수정 모드: editId가 있으면 기존 자재신청 데이터 로딩
  useEffect(() => {
    if (!editId) return;
    void (async () => {
      const { data, error } = await supabase
        .from("material_requests")
        .select("*")
        .eq("id", editId)
        .single();
      if (error || !data) return;
      const r = data as {
        request_type: string | null; site_name: string | null; note: string | null;
        items: { materialId?: string; materialName?: string; qty?: number; elevatorName?: string | null }[] | null;
        approver_id: number | null; approver_name: string | null;
        photo_urls: string[] | null;
      };
      if (r.request_type === "무상신청")        setMode("무상신청");
      else if (r.request_type === "당직선출고") setMode("당직선출고");
      else if (r.request_type === "유상견적")   setMode("유상견적요청");
      else                                      setMode("당직선출고");
      if (r.site_name) setSiteName(r.site_name);
      const noteVal = r.note ?? "";
      const slashIdx = noteVal.indexOf(" / ");
      if (slashIdx !== -1) {
        setWorkTitle(noteVal.slice(0, slashIdx));
        setReason(noteVal.slice(slashIdx + 3));
      } else {
        setWorkTitle("");
        setReason(noteVal);
      }
      if (r.approver_id)   setSelectedApproverId(r.approver_id);
      if (r.approver_name) setSelectedApproverName(r.approver_name);
      if (Array.isArray(r.photo_urls) && r.photo_urls.length > 0) setExistingPhotoUrls(r.photo_urls);
      const items = Array.isArray(r.items) ? r.items : [];
      if (items.length > 0) {
        setRows(items.map(item => newRow({
          material_id:   item.materialId   ?? "",
          material_name: item.materialName ?? "",
          qty:           item.qty          ?? 1,
          elevator_name: item.elevatorName ?? "",
        })));
      }
    })();
  }, [editId]);

  useEffect(() => {
    if (!user || !isAdmin(user)) return;
    getMaterialManagers().then(setManagers).catch(() => {});
    void supabase.from("accounts").select("id, username, name, dept").order("username")
      .then(({ data }) => {
        const mapped = ((data ?? []) as { id: number; username: string | null; name: string | null; dept: string | null }[])
          .map(a => ({ id: a.id, name: (a.username || a.name || "").trim(), dept: a.dept }))
          .filter(a => !!a.name);
        setAllAccounts(mapped);
      });
  }, [user]);

  async function loadHistory(from = histFrom, to = histTo) {
    if (!user) return;
    setHistLoading(true);
    setHistPage(1);
    const fromISO = from + "T00:00:00.000Z";
    const toISO   = to   + "T23:59:59.999Z";
    const ids = await visibleUserIds(user, "/claim/new");
    let qrQ = supabase.from("quote_requests")
      .select("id, request_no, requested_at, site_name, work_title, requester_name, status, quote_id, quote_request_items(material_name)")
      .gte("requested_at", fromISO).lte("requested_at", toISO)
      .order("requested_at", { ascending: false });
    let mrQ = supabase.from("material_requests")
      .select("id, requested_at, site_name, items, note, requester_name, request_type, status, approval_status, reject_reason, photo_urls")
      .in("request_type", ["무상신청", "당직선출고"])
      .gte("requested_at", fromISO).lte("requested_at", toISO)
      .order("requested_at", { ascending: false });
    if (ids) { qrQ = qrQ.in("requester_id", ids); mrQ = mrQ.in("requester_id", ids); }
    const [qr, mr] = await Promise.all([qrQ, mrQ]);
    const rows: HistoryRow[] = [];
    for (const r of (qr.data ?? []) as Array<{
      id: number; request_no: string; requested_at: string;
      site_name: string | null; work_title: string | null;
      requester_name: string | null;
      status: string; quote_id: number | null;
      quote_request_items: { material_name: string }[] | null;
    }>) {
      const items = r.quote_request_items ?? [];
      rows.push({
        source: "quote_request", rowId: r.id, no: r.request_no,
        date: r.requested_at, siteName: r.site_name, workTitle: r.work_title,
        requesterName: r.requester_name,
        itemFirstName: items[0]?.material_name ?? "-",
        itemCount: items.length,
        kind: "유상견적요청", status: r.status, quoteId: r.quote_id,
        approvalStatus: null, rejectReason: null, photoUrls: null,
      });
    }
    for (const r of (mr.data ?? []) as Array<{
      id: number; requested_at: string; site_name: string | null;
      items: { materialName?: string }[] | null;
      note: string | null; requester_name: string | null; request_type: string; status: string;
      approval_status: string | null; reject_reason: string | null; photo_urls: string[] | null;
    }>) {
      const items = r.items ?? [];
      const kind = r.request_type === "당직선출고" ? "당직선출고" : "무상신청";
      rows.push({
        source: "material_request", rowId: r.id, no: null,
        date: r.requested_at, siteName: r.site_name, workTitle: r.note,
        requesterName: r.requester_name,
        itemFirstName: items[0]?.materialName ?? "-",
        itemCount: items.length,
        kind, status: r.status, quoteId: null,
        approvalStatus: (r.approval_status as "pending" | "approved" | "rejected" | null) ?? null,
        rejectReason: r.reject_reason ?? null,
        photoUrls: Array.isArray(r.photo_urls) ? r.photo_urls : null,
      });
    }
    rows.sort((a, b) => b.date.localeCompare(a.date));
    setHistory(rows);
    setHistLoading(false);
  }

  useEffect(() => { void loadHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  // 현장 변경 시 호기 + 계약구분 확인 → FM 자동 모드 권유
  useEffect(() => {
    if (!siteName.trim()) { setElevatorOptions([]); return; }
    (async () => {
      // 신DB: 현장은 managed_sites(site_name), 호기는 site_elevators(site_id FK)
      // 호기 식별 기준은 installation_place (비어있을 때만 unit_name fallback)
      const { data: ms } = await supabase.from("managed_sites")
        .select("id, contract_type, company_type").eq("site_name", siteName).maybeSingle();
      const elev = (ms as { id?: number } | null)?.id != null
        ? await supabase.from("site_elevators")
            .select("installation_place, unit_name").eq("site_id", (ms as { id: number }).id).order("installation_place")
        : { data: [] as { installation_place: string | null; unit_name: string | null }[] };
      const opts = (elev.data ?? []).map(e => {
        const r = e as { installation_place: string | null; unit_name: string | null };
        return r.installation_place ?? r.unit_name ?? "";
      }).filter(Boolean);
      setElevatorOptions(opts);
      // 단독호기(호기 1개) 현장이면 호기 자동 입력 → 바로 품목 검색 가능
      if (opts.length === 1) {
        setRows(prev => prev.map(r => r.elevator_name.trim() ? r : { ...r, elevator_name: opts[0] }));
      }
      const ms2 = ms as { contract_type: string | null; company_type: string | null } | null;
      const ct = ms2?.contract_type;
      const cmp = ms2?.company_type;
      if (ms !== null) {
        // 수정 모드에서는 mode 자동변경 안 함 (원본 request_type 유지)
        if (!editId) {
          if (ct === "TK-FM" || ct === "대솔FM" || ct === "DS-FM") {
            setMode("무상신청");
          } else {
            setMode("유상견적요청");
          }
        }
        // 회사구분(DS/TK)에 따라 기본 자재구분 토글 자동 설정
        if (cmp === "TK") { setClaimMatType("TK"); setMatTypeFilter("TK"); }
        else if (cmp === "DS") { setClaimMatType("DS"); setMatTypeFilter("DS"); }
      }
    })();
  }, [siteName]);

  function patchRow(key: string, patch: Partial<ItemRow>) {
    setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));
  }
  function addRow() {
    // 단독호기 현장이면 새 행에도 호기 자동 입력
    const autoElev = elevatorOptions.length === 1 ? elevatorOptions[0] : "";
    setRows(prev => [...prev, { ...newRow(), elevator_name: autoElev }]);
  }
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

  // matTypeFilter(DS/TK/전체) 변경 시, 현재 검색 중인 행을 입력값 그대로 재검색
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const matTypeInited = useRef(false);
  useEffect(() => {
    if (!matTypeInited.current) { matTypeInited.current = true; return; }
    rowsRef.current.forEach(r => {
      if (r.searchOpen && r.material_name.trim()) searchMaterial(r.key, r.material_name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matTypeFilter]);

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

  // 승인자 목록 로딩 공통 헬퍼
  async function loadApproverList() {
    setApproverListLoading(true);
    try {
      const { data } = await supabase.from("accounts").select("id, username, name, dept").order("username");
      const mapped = ((data ?? []) as { id: number; username: string | null; name: string | null; dept: string | null }[])
        .map(a => ({ id: a.id, name: (a.username || a.name || "").trim(), dept: a.dept }))
        .filter(a => !!a.name)
        .sort((a, b) => a.name.localeCompare(b.name, "ko"));
      setApproverList(mapped);
    } finally {
      setApproverListLoading(false);
    }
  }

  // 헤더 "승인자 변경" 버튼 — 상태만 변경, 즉시 저장 없음
  function openApproverChangeModal() {
    setApproverSearch(selectedApproverName);
    setApproverModalForSave(false);
    setShowApproverModal(true);
    void loadApproverList();
  }

  // 저장 버튼 클릭: 유상/당직은 바로 저장, 무상 신규는 승인자 선택 모달 오픈
  function handleSaveClick() {
    setMessage(null);
    if (!user) { setMessage({ type: "error", text: "로그인이 필요합니다." }); return; }
    if (!siteName.trim()) { setMessage({ type: "error", text: "현장명을 입력해 주세요." }); return; }
    const validItems = rows.filter(r => r.material_id || r.material_name.trim());
    if (validItems.length === 0) { setMessage({ type: "error", text: "자재를 1개 이상 입력해 주세요." }); return; }

    if (editId) {
      // 수정 모드: 승인자는 헤더 "변경" 버튼으로 별도 관리 → 바로 저장
      if (mode === "무상신청" && !reason.trim()) { setMessage({ type: "error", text: "신청사유 / 고장 증상을 입력해 주세요." }); return; }
      void doSubmit(selectedApproverId ?? undefined, selectedApproverName || undefined);
      return;
    }

    if (mode !== "무상신청") { void doSubmit(); return; }

    // 무상신청 신규: 승인자 모달 오픈 후 저장
    if (!reason.trim()) { setMessage({ type: "error", text: "신청사유 / 고장 증상을 입력해 주세요." }); return; }
    setSelectedApproverId(null);
    setSelectedApproverName("");
    setApproverSearch("");
    setApproverModalForSave(true);
    setShowApproverModal(true);
    void loadApproverList();
  }

  // 실제 저장 (승인자 선택 후 모달 확정, 또는 유상/당직 직접 저장)
  async function doSubmit(approverId?: number, approverName?: string) {
    setMessage(null);
    if (!user) { setMessage({ type: "error", text: "로그인이 필요합니다." }); return; }
    if (!siteName.trim()) { setMessage({ type: "error", text: "현장명을 입력해 주세요." }); return; }
    const validItems = rows.filter(r => r.material_id || r.material_name.trim());
    if (validItems.length === 0) { setMessage({ type: "error", text: "자재를 1개 이상 입력해 주세요." }); return; }

    setSaving(true);
    try {
      // ── 수정 모드 (기존 material_requests 행 업데이트) ──────────────────
      if (editId) {
        const items = validItems.map(r => ({
          materialId:   r.material_id,
          materialName: r.material_name,
          qty:          r.qty,
          elevatorName: r.elevator_name || null,
        }));
        // 새로 추가된 사진 업로드
        let newPhotoUrls: string[] = [];
        const filesToUpload = photos.filter(p => p.file);
        if (mode === "무상신청" && filesToUpload.length > 0) {
          const uploads = await Promise.allSettled(filesToUpload.map(async p => {
            const ext = p.file!.name.split(".").pop() ?? "jpg";
            const path = `${user.id}/${Date.now()}-${p.key}.${ext}`;
            const { error: upErr } = await supabase.storage.from("material-request-photos").upload(path, p.file!, { upsert: false });
            if (upErr) throw upErr;
            const { data: pub } = supabase.storage.from("material-request-photos").getPublicUrl(path);
            return pub.publicUrl;
          }));
          newPhotoUrls = uploads.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled").map(r => r.value);
        }
        const allPhotoUrls = [...existingPhotoUrls, ...newPhotoUrls];
        const patch: Record<string, unknown> = {
          site_name:  siteName,
          items,
          note:       [workTitle, reason].filter(Boolean).join(" / ") || null,
          photo_urls: allPhotoUrls.length > 0 ? allPhotoUrls : null,
        };
        if (mode === "무상신청") {
          patch.approver_id   = approverId   ?? null;
          patch.approver_name = approverName ?? null;
        }
        const { error } = await supabase.from("material_requests").update(patch).eq("id", editId);
        if (error) throw error;
        setMessage({ type: "success", text: "자재신청이 수정되었습니다." });
        await new Promise(res => setTimeout(res, 700));
        router.push("/requests");
        return;
      }
      // 호기 헤더 — 견적요청/자재청구 알림 메시지 공용
      const elevSet = Array.from(new Set(validItems.map(r => r.elevator_name.trim()).filter(Boolean)));
      const headerElev = elevSet.length === 0 ? null : elevSet.join(", ");
      const firstName = validItems[0]?.material_name ?? "";
      const summary = validItems.length <= 1 ? firstName : `${firstName} 외 ${validItems.length - 1}건`;
      async function notifyRecipients(payload: {
        type: string; title: string; message: string; link: string; refType: string; refId: number | null;
      }) {
        const mgrs = await getMaterialManagers();
        const targetIds = mgrs.map(m => m.id);
        await Promise.all(targetIds.map(uid => insertNotification({ userId: uid, ...payload })));
      }

      if (mode === "유상견적요청") {
        const request_no = await generateRequestNo();
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
        // 자재관리 담당(박은숙·황진한)에게 알림 — 본인 포함. 실패는 silent.
        void notifyRecipients({
          type:    "quote_request",
          title:   "새 견적요청이 접수되었습니다",
          message: `[${siteName}${headerElev ? ` · ${headerElev}` : ""}] ${workTitle ? `${workTitle} — ` : ""}${summary}`,
          link:    "/claim/quote-requests",
          refType: "quote_request",
          refId:   hdr.id,
        }).catch(e => console.warn("[notify] 견적요청 알림 실패:", e));
      } else {
        // 무상신청 / 당직선출고 — material_requests 사용

        // 무상신청 사진 업로드 (선택된 파일만)
        let uploadedPhotoUrls: string[] = [];
        if (mode === "무상신청") {
          const filesToUpload = photos.filter(p => p.file);
          if (filesToUpload.length > 0) {
            const uploads = await Promise.allSettled(filesToUpload.map(async p => {
              const ext = p.file!.name.split(".").pop() ?? "jpg";
              const path = `${user.id}/${Date.now()}-${p.key}.${ext}`;
              const { error: upErr } = await supabase.storage
                .from("material-request-photos")
                .upload(path, p.file!, { upsert: false });
              if (upErr) throw upErr;
              const { data: pub } = supabase.storage.from("material-request-photos").getPublicUrl(path);
              return pub.publicUrl;
            }));
            uploadedPhotoUrls = uploads
              .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
              .map(r => r.value);
          }
        }

        const items = validItems.map(r => ({
          materialId:    r.material_id,
          materialName:  r.material_name,
          qty:           r.qty,
          elevatorName:  r.elevator_name || null,
        }));
        const { data: inserted, error } = await supabase.from("material_requests").insert({
          status:          "신청",
          approval_status: mode === "무상신청" ? "pending" : null,
          approver_id:     mode === "무상신청" ? (approverId ?? null) : null,
          approver_name:   mode === "무상신청" ? (approverName ?? null) : null,
          site_name:       siteName,
          items,
          note:            [workTitle, reason].filter(Boolean).join(" / ") || null,
          photo_urls:      uploadedPhotoUrls.length > 0 ? uploadedPhotoUrls : null,
          requester_id:    user.id,
          requester_name:  user.name,
          requester_dept:  user.dept ?? "",
          request_type:    mode,
        }).select("id").single();
        if (error) throw error;
        const requestId = (inserted as { id?: number } | null)?.id ?? null;
        const msg = mode === "당직선출고"
          ? "당직 선출고 신청이 접수되었습니다. 관리자가 즉시 출고 처리합니다."
          : `무상 자재신청이 접수되었습니다. ${approverName ? `${approverName}님께 승인 요청을 보냈습니다.` : "담당자 승인 후 처리됩니다."}`;
        setMessage({ type: "success", text: msg });
        // 당직선출고만 즉시 자재담당자 알림 — 무상신청은 승인자 승인 완료 후 mock-router에서 발송
        if (mode === "당직선출고") {
          void notifyRecipients({
            type:    "material_request",
            title:   "새 당직선출고 신청이 접수되었습니다",
            message: `[${siteName}${headerElev ? ` · ${headerElev}` : ""}] ${workTitle ? `${workTitle} — ` : ""}${summary}`,
            link:    "/requests",
            refType: "material_request",
            refId:   requestId,
          }).catch(e => console.warn("[notify] 당직선출고 알림 실패:", e));
        }
        // 무상신청: 선택된 승인자에게 승인 요청 알림
        if (mode === "무상신청" && approverId) {
          void insertNotification({
            userId:  approverId,
            type:    "approval_request",
            title:   "무상 자재신청 승인 요청",
            message: `[${siteName}] ${summary} — ${user.name}님의 승인을 요청합니다.`,
            link:    "/requests",
            refType: "material_request",
            refId:   requestId,
          }).catch(e => console.warn("[notify] 승인자 알림 실패:", e));
        }
      }
      // 폼 리셋
      setRows(Array.from({ length: DEFAULT_ROW_COUNT }, () => newRow()));
      setSiteName(""); setWorkTitle(""); setReason("");
      photos.forEach(p => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
      setPhotos([{ key: crypto.randomUUID(), file: null, previewUrl: null }]);
      // 이력 즉시 갱신
      void loadHistory();
    } catch (err) {
      const msg = err instanceof Error
        ? err.message
        : (typeof err === "object" && err !== null && "message" in err)
          ? String((err as { message: unknown }).message)
          : String(err);
      setMessage({ type: "error", text: msg });
    } finally {
      setSaving(false);
    }
  }

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;

  const sectionCls = "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5";
  const labelCls   = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1";
  const fieldCls   = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400";
  const inputCls   = "w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100";
  const cellInput  = "w-full px-2 py-1 text-xs text-gray-900 dark:text-gray-100 border-0 bg-transparent focus:outline-none focus:bg-yellow-50 dark:focus:bg-yellow-900/20 focus:ring-1 focus:ring-blue-300";

  // DS / TK / 전체 자재구분 스위치 (청구정보·자재목록 공용)
  const renderMatTypeSwitch = (value: "DS" | "TK" | "ALL", onSelect: (t: "DS" | "TK" | "ALL") => void) => (
    <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 p-0.5 rounded">
      {(["DS", "TK", "ALL"] as const).map(t => (
        <button key={t} type="button" onMouseDown={e => e.preventDefault()} onClick={() => onSelect(t)}
          className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors ${
            value === t
              ? t === "DS" ? "bg-red-500 text-white shadow-sm"
                : t === "TK" ? "bg-blue-600 text-white shadow-sm"
                : "bg-gray-900 text-white shadow-sm"
              : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}>{t === "ALL" ? "전체" : t}</button>
      ))}
    </div>
  );

  return (
    <>
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        {editId ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                ✏️ 자재신청 수정
                <span className="ml-2 text-sm font-normal text-gray-400">#{editId}</span>
                <span className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded-full ${
                  mode === "무상신청"   ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : mode === "당직선출고" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                  : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                }`}>{mode}</span>
              </h1>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">현장·자재·메모를 수정 후 저장하세요.</p>
            </div>
            <button type="button" onClick={() => router.push("/requests")}
              className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 shrink-0">
              취소
            </button>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">🔧 견적 및 자재청구 등록</h1>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">유상/무상/당직 모드 선택 후 자재 청구를 접수합니다.</p>
          </>
        )}
      </div>

<div className="p-6 space-y-4 max-w-5xl">
        {/* 모드 선택 (수정 모드에서는 잠금) */}
        {!editId && (
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
                      : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:border-gray-400"
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
        )}

        {/* 헤더 */}
        <div className={sectionCls}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">📋 청구 정보</h2>
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">기본 자재구분</span>
              {renderMatTypeSwitch(claimMatType, t => { setClaimMatType(t); setMatTypeFilter(t); })}
            </div>
          </div>
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
              <label className={labelCls}>
                {mode === "무상신청"
                  ? <span className="text-red-600 dark:text-red-400 font-bold">신청사유 / 고장 증상 <span className="text-red-500">*</span></span>
                  : <>신청사유 / 고장 증상</>}
              </label>
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} lang="ko"
                className={inputCls + " resize-none" + (mode === "무상신청" && !reason.trim() ? " border-red-300 dark:border-red-600 focus:ring-red-400" : "")} />
              {mode === "무상신청" && !reason.trim() && (
                <p className="text-[11px] text-red-500 mt-0.5">무상신청 시 필수 입력 항목입니다.</p>
              )}
            </div>
          </div>
        </div>

        {/* 무상신청 사진 첨부 */}
        {mode === "무상신청" && (
          <div className={sectionCls}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">📷 사진 첨부 <span className="text-[11px] font-normal text-gray-400">(고장 증상 사진)</span></h2>
              <button type="button" onClick={addPhotoSlot}
                className="px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center gap-1">
                + 사진 추가
              </button>
            </div>
            {/* 수정 모드: 기존 첨부 사진 */}
            {editId && existingPhotoUrls.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">📌 기존 첨부 사진 <span className="font-normal text-gray-400">({existingPhotoUrls.length}장 — × 클릭 시 삭제)</span></p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {existingPhotoUrls.map((url, idx) => (
                    <div key={url} className="relative group">
                      <div className="aspect-square rounded-lg border border-blue-200 dark:border-blue-700 overflow-hidden">
                        <img src={url} alt={`기존 사진 ${idx + 1}`} className="w-full h-full object-cover" />
                      </div>
                      <button type="button"
                        onClick={() => setExistingPhotoUrls(prev => prev.filter(u => u !== url))}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {photos.map((p, idx) => (
                <div key={p.key} className="relative group">
                  <label className="block cursor-pointer">
                    <input type="file" accept="image/*" className="sr-only"
                      onChange={e => setPhotoFile(p.key, e.target.files?.[0] ?? null)} />
                    <div className={`aspect-square rounded-lg border-2 border-dashed flex items-center justify-center overflow-hidden transition-colors ${
                      p.previewUrl
                        ? "border-blue-300 dark:border-blue-600"
                        : "border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 bg-gray-50 dark:bg-gray-700/50"
                    }`}>
                      {p.previewUrl
                        ? <img src={p.previewUrl} alt={`사진 ${idx + 1}`} className="w-full h-full object-cover" />
                        : <div className="text-center text-gray-400 dark:text-gray-500 px-2">
                            <div className="text-2xl mb-1">📷</div>
                            <div className="text-[10px]">클릭하여 선택</div>
                          </div>
                      }
                    </div>
                  </label>
                  <button type="button" onClick={() => removePhotoSlot(p.key)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">
                    ×
                  </button>
                  {p.file && (
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 truncate text-center">{p.file.name}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 자재 라인 */}
        <div className={sectionCls}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">📦 자재 목록</h2>
            <div className="flex items-center gap-2 ml-auto">
              {renderMatTypeSwitch(matTypeFilter, setMatTypeFilter)}
              <button type="button" onClick={addRow}
                className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">+ 행 추가</button>
            </div>
          </div>
          {isMobile ? (
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={r.key} className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 bg-gray-50/50 dark:bg-gray-700/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400">#{i + 1}</span>
                  <button type="button" onClick={() => removeRow(r.key)} className="text-red-500 text-xs">삭제</button>
                </div>
                {/* 호기 먼저 입력 → 품목 검색 활성화 */}
                <div className="relative">
                  <label className={labelCls}>호기 <span className="text-red-500">*</span></label>
                  <input type="text" lang="ko" value={r.elevator_name}
                    onChange={e => patchRow(r.key, { elevator_name: e.target.value })}
                    onFocus={() => patchRow(r.key, { elevOpen: true })}
                    onBlur={() => setTimeout(() => patchRow(r.key, { elevOpen: false }), 150)}
                    placeholder="호기 (예: 1호기)" className={fieldCls} />
                  {r.elevOpen && elevatorOptions.length > 0 && (() => {
                    const q = r.elevator_name.trim().toLowerCase();
                    const filtered = q
                      ? elevatorOptions.filter(e => e.toLowerCase().includes(q))
                      : elevatorOptions;
                    return filtered.length > 0 ? (
                      <ul className="absolute z-50 top-full left-0 mt-0.5 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                        {filtered.map(e => (
                          <li key={e}>
                            <button type="button"
                              onMouseDown={ev => ev.preventDefault()}
                              onClick={() => patchRow(r.key, { elevator_name: e, elevOpen: false })}
                              className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 border-b border-gray-50 dark:border-gray-700 last:border-0 hover:bg-blue-50 dark:hover:bg-blue-900/40">
                              {e}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null;
                  })()}
                </div>
                {/* 품목 검색 — 전체폭 입력 + 전체폭 드롭다운 (호기 입력 후 활성화) */}
                <div className="relative">
                  <label className={labelCls}>품목 <span className="text-red-500">*</span></label>
                  <input type="text" lang="ko" value={r.material_name}
                    disabled={!r.elevator_name.trim()}
                    onChange={e => { patchRow(r.key, { material_name: e.target.value }); searchMaterial(r.key, e.target.value); }}
                    onKeyDown={e => {
                      if (!r.searchOpen || r.searchResults.length === 0) return;
                      if (e.key === "ArrowDown") { e.preventDefault(); patchRow(r.key, { searchFocusIndex: Math.min(r.searchFocusIndex + 1, r.searchResults.length - 1) }); }
                      else if (e.key === "ArrowUp") { e.preventDefault(); patchRow(r.key, { searchFocusIndex: Math.max(r.searchFocusIndex - 1, 0) }); }
                      else if (e.key === "Enter") { e.preventDefault(); if (r.searchResults.length === 1) applyMaterial(r.key, r.searchResults[0]); else if (r.searchFocusIndex >= 0) applyMaterial(r.key, r.searchResults[r.searchFocusIndex]); }
                      else if (e.key === "Escape") patchRow(r.key, { searchOpen: false });
                    }}
                    onBlur={() => setTimeout(() => patchRow(r.key, { searchOpen: false }), 150)}
                    placeholder={r.elevator_name.trim() ? `자재명·코드 (${matTypeFilter === "ALL" ? "전체" : matTypeFilter})` : "호기를 먼저 입력하세요"}
                    className={fieldCls + (r.elevator_name.trim() ? "" : " bg-gray-100 dark:bg-gray-800 cursor-not-allowed")} />
                  {r.searchOpen && r.searchResults.length > 0 && (
                    <div className="absolute z-50 top-full left-0 mt-0.5 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl">
                      <ul className="max-h-60 overflow-y-auto">
                        {r.searchResults.map((m, idx) => {
                          const repair = isRepairMaterial(m.id);
                          const tk = !repair && isTkMaterial(m.id);
                          const nameCls = repair
                            ? "text-green-600 dark:text-green-400"
                            : tk ? TK_TEXT_CLASS : "text-gray-800 dark:text-gray-200";
                          const codeCls = repair
                            ? "text-green-600 dark:text-green-400"
                            : tk ? TK_TEXT_CLASS : "text-slate-400";
                          return (
                          <li key={m.id}>
                            <div role="button" tabIndex={0}
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => applyMaterial(r.key, m)}
                              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") applyMaterial(r.key, m); }}
                              className={`w-full text-left px-3 py-2.5 border-b border-gray-50 dark:border-gray-700 last:border-0 cursor-pointer ${r.searchFocusIndex === idx ? "bg-blue-100 dark:bg-blue-900/50" : "hover:bg-gray-50 dark:hover:bg-gray-700"}`}>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className={`text-sm font-medium ${nameCls} truncate`}>
                                    {repair && <span className="mr-1 text-[9px] px-1 rounded bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300 font-bold align-middle">RE</span>}
                                    {m.name}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className={`text-[10px] font-mono ${codeCls}`}>{m.id}</span>
                                    {m.modelNo && <span className="text-[10px] text-gray-500 truncate">{m.modelNo}</span>}
                                  </div>
                                </div>
                                <PhotoIconBtn urls={[m.referenceImageUrl1, m.referenceImageUrl2, m.opinionImageUrl]} />
                              </div>
                            </div>
                          </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>규격</label>
                    <input type="text" lang="ko" value={r.spec} onChange={e => patchRow(r.key, { spec: e.target.value })} className={fieldCls} />
                  </div>
                  <div>
                    <label className={labelCls}>단위</label>
                    <input type="text" value={r.unit} onChange={e => patchRow(r.key, { unit: e.target.value })} className={fieldCls} />
                  </div>
                  <div>
                    <label className={labelCls}>수량</label>
                    <input type="text" inputMode="numeric" value={r.qty === 0 ? "" : String(r.qty)}
                      onChange={e => { const v = e.target.value.replace(/[^0-9.]/g, ""); patchRow(r.key, { qty: v === "" ? 0 : Number(v) }); }}
                      className={fieldCls + " text-right"} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>비고</label>
                  <input type="text" lang="ko" value={r.remark} onChange={e => patchRow(r.key, { remark: e.target.value })} className={fieldCls} />
                </div>
              </div>
            ))}
          </div>
          ) : (
          <div className="max-h-[17.5rem] min-h-[12rem] overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="border-y border-gray-200 dark:border-gray-600 text-center text-[11px] font-bold text-gray-600 dark:text-gray-300 shadow-sm">
                  <th className="px-2 py-2 w-10 bg-gray-50 dark:bg-gray-700/95">NO</th>
                  <th className="px-2 py-2 w-20 bg-gray-50 dark:bg-gray-700/95">호기</th>
                  <th className="px-2 py-2 bg-gray-50 dark:bg-gray-700/95">품      목</th>
                  <th className="px-2 py-2 bg-gray-50 dark:bg-gray-700/95">규  격</th>
                  <th className="px-2 py-2 w-14 bg-gray-50 dark:bg-gray-700/95">단위</th>
                  <th className="px-2 py-2 w-16 bg-gray-50 dark:bg-gray-700/95">수량</th>
                  <th className="px-2 py-2 bg-gray-50 dark:bg-gray-700/95">비  고</th>
                  <th className="px-2 py-2 w-10 bg-gray-50 dark:bg-gray-700/95"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key} className="border-b border-gray-100 dark:border-gray-700 hover:bg-blue-50/20 dark:hover:bg-blue-900/10">
                    <td className="px-2 py-1.5 text-center text-gray-600 dark:text-gray-400">{i + 1}</td>
                    <td className="px-1 py-0.5 relative">
                      <input type="text" lang="ko" value={r.elevator_name}
                        onChange={e => patchRow(r.key, { elevator_name: e.target.value })}
                        onFocus={() => patchRow(r.key, { elevOpen: true })}
                        onBlur={() => setTimeout(() => patchRow(r.key, { elevOpen: false }), 150)}
                        placeholder={elevatorOptions[0] ?? "호기"}
                        className={cellInput + " text-center"} />
                      {r.elevOpen && elevatorOptions.length > 0 && (() => {
                        const q = r.elevator_name.trim().toLowerCase();
                        const filtered = q
                          ? elevatorOptions.filter(e => e.toLowerCase().includes(q))
                          : elevatorOptions;
                        return filtered.length > 0 ? (
                          <ul className="absolute z-50 top-full left-0 mt-0.5 w-36 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                            {filtered.map(e => (
                              <li key={e}>
                                <button type="button"
                                  onMouseDown={ev => ev.preventDefault()}
                                  onClick={() => patchRow(r.key, { elevator_name: e, elevOpen: false })}
                                  className="w-full text-left px-3 py-1.5 text-xs text-gray-800 dark:text-gray-200 border-b border-gray-50 dark:border-gray-700 last:border-0 hover:bg-blue-50 dark:hover:bg-blue-900/40">
                                  {e}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null;
                      })()}
                    </td>
                    <td className="px-1 py-0.5 relative">
                      <input type="text" lang="ko" value={r.material_name}
                        disabled={!r.elevator_name.trim()}
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
                        placeholder={r.elevator_name.trim() ? `자재명·코드 (${matTypeFilter === "ALL" ? "전체" : matTypeFilter})` : "← 호기 먼저 입력"}
                        className={cellInput + (r.elevator_name.trim() ? "" : " bg-gray-100 dark:bg-gray-800 cursor-not-allowed")} />
                      {r.searchOpen && r.searchResults.length > 0 && (
                        <div className="absolute z-50 top-full left-0 mt-0.5 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl">
                          <ul className="max-h-52 overflow-y-auto">
                            {r.searchResults.map((m, idx) => {
                              const repair = isRepairMaterial(m.id);
                              const tk = !repair && isTkMaterial(m.id);
                              const nameCls = repair
                                ? "text-green-600 dark:text-green-400"
                                : tk ? TK_TEXT_CLASS : "text-gray-800 dark:text-gray-200";
                              const codeCls = repair
                                ? "text-green-600 dark:text-green-400"
                                : tk ? TK_TEXT_CLASS : "text-slate-400";
                              return (
                              <li key={m.id}>
                                <div role="button" tabIndex={0}
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={() => applyMaterial(r.key, m)}
                                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") applyMaterial(r.key, m); }}
                                  className={`w-full text-left px-3 py-2 border-b border-gray-50 dark:border-gray-700 last:border-0 cursor-pointer ${r.searchFocusIndex === idx ? "bg-blue-100 dark:bg-blue-900/50" : "hover:bg-gray-50 dark:hover:bg-gray-700"}`}>
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className={`text-xs font-medium ${nameCls} truncate`}>
                                        {repair && <span className="mr-1 text-[9px] px-1 rounded bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300 font-bold align-middle">RE</span>}
                                        {m.name}
                                      </div>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <span className={`text-[10px] font-mono ${codeCls}`}>{m.id}</span>
                                        {m.modelNo && <span className="text-[10px] text-gray-500 truncate">{m.modelNo}</span>}
                                      </div>
                                    </div>
                                    <PhotoIconBtn urls={[m.referenceImageUrl1, m.referenceImageUrl2, m.opinionImageUrl]} />
                                  </div>
                                </div>
                              </li>
                              );
                            })}
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
          )}
        </div>

        {message && (
          <div className={`text-sm px-4 py-3 rounded ${
            message.type === "success" ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                       : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
          }`}>{message.text}</div>
        )}

        <div className="flex items-center justify-end gap-2 flex-wrap">
          {/* 무상신청 수정 모드: 승인자 표시 + 변경 */}
          {editId && mode === "무상신청" && (
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 mr-auto">
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">승인자</span>
              <span className={`text-xs font-semibold ${selectedApproverName ? "text-emerald-800 dark:text-emerald-200" : "text-gray-400 dark:text-gray-500"}`}>
                {selectedApproverName || "미지정"}
              </span>
              <button type="button" onClick={openApproverChangeModal}
                className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-700 font-semibold whitespace-nowrap">
                변경
              </button>
            </div>
          )}
          {editId && (
            <button type="button" onClick={() => router.push("/requests")}
              className="px-5 py-2 rounded border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
              취소
            </button>
          )}
          <button type="button" onClick={handleSaveClick} disabled={saving}
            className={`px-6 py-2 rounded text-white text-sm font-semibold disabled:opacity-50 ${
              editId
                ? "bg-blue-600 hover:bg-blue-700"
                : mode === "무상신청"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-blue-600 hover:bg-blue-700"
            }`}>
            {saving ? "저장 중..." : editId ? "✓ 수정 완료" : mode === "무상신청" ? "🆓 승인자 선택 후 저장" : `💾 ${MODES.find(m => m.key === mode)?.label} 저장`}
          </button>
        </div>

        {/* ─── 팀 청구이력 (수정 모드에서는 숨김) ─────────────────── */}
        {!editId && <div className={sectionCls}>
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">📜 팀 청구이력</h2>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 w-full -mt-2">
              같은 팀({user?.dept ?? "-"}) 사원들의 청구 내역입니다.
            </p>
          </div>

          {/* 기간 검색 + 구분 필터 */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="flex items-center gap-1">
              <input type="date" value={histFrom} onChange={e => setHistFrom(e.target.value)}
                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              <span className="text-xs text-gray-400">~</span>
              <input type="date" value={histTo} onChange={e => setHistTo(e.target.value)}
                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <button type="button" onClick={() => void loadHistory(histFrom, histTo)} disabled={histLoading}
              className="px-3 py-1 text-xs rounded bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50">
              {histLoading ? "조회 중..." : "조회"}
            </button>
            <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 p-0.5 rounded ml-auto">
              {(["전체", "유상견적요청", "무상신청", "당직선출고"] as const).map(f => (
                <button key={f} type="button"
                  onClick={() => { setHistKindFilter(f); setHistPage(1); }}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors ${
                    histKindFilter === f
                      ? "bg-blue-600 text-white"
                      : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                  }`}>{f}</button>
              ))}
            </div>
          </div>

          {/* 테이블 */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-y border-gray-200 dark:border-gray-600 text-[11px] font-bold text-gray-600 dark:text-gray-300">
                <tr>
                  <th className="px-2 py-2 text-center w-24">접수일자</th>
                  <th className="px-2 py-2 text-center w-24">구분</th>
                  <th className="px-2 py-2 text-center w-20">신청자</th>
                  <th className="px-2 py-2 text-left">현장</th>
                  <th className="px-2 py-2 text-left">자재 요약</th>
                  <th className="px-2 py-2 text-center w-28">상태</th>
                  <th className="px-2 py-2 text-center w-10">사진</th>
                  <th className="px-2 py-2 text-center w-32">번호 / 추적</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const filtered = histKindFilter === "전체" ? history : history.filter(h => h.kind === histKindFilter);
                  const totalPages = Math.max(1, Math.ceil(filtered.length / HIST_PAGE_SIZE));
                  const safePage = Math.min(histPage, totalPages);
                  const paged = filtered.slice((safePage - 1) * HIST_PAGE_SIZE, safePage * HIST_PAGE_SIZE);

                  if (histLoading) {
                    return <tr><td colSpan={8} className="px-2 py-6 text-center text-gray-400">조회 중...</td></tr>;
                  }
                  if (filtered.length === 0) {
                    return <tr><td colSpan={8} className="px-2 py-6 text-center text-gray-400">
                      해당 기간에 청구 이력이 없습니다.
                    </td></tr>;
                  }
                  return (
                    <>
                      {paged.map(h => (
                        <tr key={`${h.source}-${h.rowId}`} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="px-2 py-1.5 text-center text-gray-600 dark:text-gray-300 font-mono tabular-nums whitespace-nowrap">
                            {fmtDT(h.date)}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${HIST_KIND_CLS[h.kind]}`}>
                              {h.kind}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-center text-gray-700 dark:text-gray-200 whitespace-nowrap">
                            {h.requesterName ?? "-"}
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
                            {h.approvalStatus === "rejected" ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300">
                                  반려
                                </span>
                                {h.rejectReason && (
                                  <span className="text-[10px] text-red-500 dark:text-red-400 max-w-[120px] text-center leading-tight break-words">
                                    {h.rejectReason}
                                  </span>
                                )}
                              </div>
                            ) : h.approvalStatus === "pending" ? (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300">
                                승인대기
                              </span>
                            ) : (
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${histStatusCls(h.status)}`}>
                                {h.status}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <PhotoIconBtn urls={h.photoUrls ?? []} />
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
                      ))}
                      {/* 페이지네이션 */}
                      {totalPages > 1 && (() => {
                        const pages: (number | "…")[] = [];
                        for (let i = 1; i <= totalPages; i++) {
                          if (i === 1 || i === totalPages || Math.abs(i - safePage) <= 2) pages.push(i);
                          else if (pages[pages.length - 1] !== "…") pages.push("…");
                        }
                        return (
                          <tr>
                            <td colSpan={8} className="px-2 py-3">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                  총 {filtered.length}건 · {safePage}/{totalPages} 페이지
                                </span>
                                <div className="flex items-center gap-1">
                                  <button type="button" onClick={() => setHistPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                                    className="px-2 py-1 text-[11px] rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30">
                                    ◀
                                  </button>
                                  {pages.map((p, i) => (
                                    p === "…"
                                      ? <span key={`e${i}`} className="px-1 text-[11px] text-gray-400">…</span>
                                      : <button key={p} type="button" onClick={() => setHistPage(p)}
                                          className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
                                            p === safePage
                                              ? "bg-blue-600 text-white border-blue-600"
                                              : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                                          }`}>{p}</button>
                                  ))}
                                  <button type="button" onClick={() => setHistPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                                    className="px-2 py-1 text-[11px] rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30">
                                    ▶
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })()}
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </div>}

        {/* ─── 자재담당자 설정 (관리자 전용) ─────────────────────────── */}
        {isAdmin(user) && (
          <div className={sectionCls + " border-dashed border-amber-300 dark:border-amber-700"}>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-bold text-amber-700 dark:text-amber-400">⚙️ 자재담당자 설정 <span className="text-[10px] font-normal text-gray-400">(관리자 전용)</span></h2>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">견적·자재청구 접수 시 알림을 받을 담당자입니다.</p>
              </div>
            </div>

            {/* 현재 담당자 목록 */}
            <div className="flex flex-wrap gap-2 mb-3">
              {managers.length === 0 && <span className="text-xs text-gray-400">등록된 담당자 없음</span>}
              {managers.map(m => (
                <span key={m.id} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-200 font-medium">
                  {m.name}
                  {m.dept && <span className="text-[10px] text-gray-400">({m.dept})</span>}
                  <button type="button"
                    onClick={async () => {
                      const next = managers.filter(x => x.id !== m.id);
                      setManagerSaving(true);
                      try {
                        await setMaterialManagerIds(next.map(x => x.id));
                        setManagers(next);
                        setManagerMsg({ type: "success", text: `${m.name} 담당자에서 제외했습니다.` });
                      } catch {
                        setManagerMsg({ type: "error", text: "저장 중 오류가 발생했습니다." });
                      } finally {
                        setManagerSaving(false);
                      }
                    }}
                    className="text-amber-400 hover:text-red-500 font-bold leading-none">×</button>
                </span>
              ))}
            </div>

            {/* 담당자 추가 */}
            <div className="flex gap-2 items-center flex-wrap">
              <div className="relative flex-1 min-w-48">
                <input type="text" lang="ko" value={managerSearch}
                  onChange={e => setManagerSearch(e.target.value)}
                  placeholder="이름으로 검색하여 추가"
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-400" />
                {managerSearch.trim() && (() => {
                  const q = managerSearch.trim().toLowerCase();
                  const filtered = allAccounts
                    .filter(a => a.name.toLowerCase().includes(q) && !managers.find(m => m.id === a.id))
                    .slice(0, 8);
                  if (filtered.length === 0) return null;
                  return (
                    <ul className="absolute z-50 top-full left-0 mt-0.5 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                      {filtered.map(a => (
                        <li key={a.id}>
                          <button type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={async () => {
                              const next = [...managers, { id: a.id, name: a.name, dept: a.dept }];
                              setManagerSaving(true);
                              setManagerSearch("");
                              try {
                                await setMaterialManagerIds(next.map(x => x.id));
                                setManagers(next);
                                setManagerMsg({ type: "success", text: `${a.name}을(를) 담당자로 추가했습니다.` });
                              } catch {
                                setManagerMsg({ type: "error", text: "저장 중 오류가 발생했습니다." });
                              } finally {
                                setManagerSaving(false);
                              }
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 border-b border-gray-50 dark:border-gray-700 last:border-0 hover:bg-amber-50 dark:hover:bg-amber-900/30">
                            <span className="font-medium">{a.name}</span>
                            {a.dept && <span className="ml-2 text-[10px] text-gray-400">{a.dept}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
              {managerSaving && <span className="text-xs text-gray-400">저장 중...</span>}
            </div>

            {managerMsg && (
              <p className={`text-xs mt-2 ${managerMsg.type === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {managerMsg.text}
              </p>
            )}
          </div>
        )}
      </div>
    </div>

    {/* ─── 무상신청 승인자 선택 모달 ─────────────────────────────────── */}
    {showApproverModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm flex flex-col max-h-[80vh]">
          {/* 헤더 */}
          <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0">
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">🆓 승인자 선택</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">승인을 요청할 담당자를 검색하거나 직접 입력하세요.</p>
            </div>
            <button type="button" onClick={() => setShowApproverModal(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl font-light leading-none">×</button>
          </div>
          {/* 검색 입력 */}
          <div className="px-4 pt-3 pb-2 shrink-0">
            <input
              type="text" lang="ko" autoFocus
              value={approverSearch}
              onChange={e => {
                const v = e.target.value;
                setApproverSearch(v);
                setSelectedApproverName(v);
                // 기존에 목록에서 선택했던 이름과 달라지면 id 초기화
                setSelectedApproverId(prev =>
                  approverList.find(a => a.name === v)?.id ?? null
                );
              }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const q = approverSearch.trim().toLowerCase();
                  const filtered = q ? approverList.filter(a => (a.name?.toLowerCase().includes(q) ?? false) || (a.dept?.toLowerCase().includes(q) ?? false)) : approverList;
                  if (filtered.length === 1) {
                    setSelectedApproverId(filtered[0].id); setSelectedApproverName(filtered[0].name); setApproverSearch(filtered[0].name);
                  }
                }
              }}
              placeholder="이름 또는 부서로 검색 (직접 입력 가능)"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>
          {/* 목록 */}
          <div className="overflow-y-auto flex-1 px-2 pb-2">
            {approverListLoading ? (
              <div className="text-center text-sm text-gray-400 py-6">불러오는 중...</div>
            ) : (() => {
              const q = approverSearch.trim().toLowerCase();
              const filtered = q
                ? approverList.filter(a => (a.name?.toLowerCase().includes(q) ?? false) || (a.dept?.toLowerCase().includes(q) ?? false))
                : approverList;
              return (
                <ul>
                  {filtered.map(a => (
                    <li key={a.id}>
                      <button type="button"
                        onClick={() => { setSelectedApproverId(a.id); setSelectedApproverName(a.name); setApproverSearch(a.name); }}
                        className={`w-full text-left px-4 py-2.5 rounded-lg text-sm flex items-center gap-3 mb-0.5 transition-colors ${
                          selectedApproverId === a.id
                            ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-semibold"
                            : "text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                        }`}>
                        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          selectedApproverId === a.id
                            ? "border-emerald-500 bg-emerald-500"
                            : "border-gray-300 dark:border-gray-600"
                        }`}>
                          {selectedApproverId === a.id && <span className="text-white text-[10px] font-bold">✓</span>}
                        </span>
                        <span className="font-medium">{a.name}</span>
                        {a.dept && <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{a.dept}</span>}
                      </button>
                    </li>
                  ))}
                  {filtered.length === 0 && approverSearch.trim() && (
                    <li className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      일치하는 사원이 없습니다. 입력한 이름 <span className="font-semibold text-gray-700 dark:text-gray-200">&quot;{approverSearch.trim()}&quot;</span>으로 직접 지정하려면 아래 저장 버튼을 누르세요.
                    </li>
                  )}
                </ul>
              );
            })()}
          </div>
          {/* 푸터 */}
          <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
            {selectedApproverName.trim() && (
              <p className="text-xs mb-2 text-emerald-600 dark:text-emerald-400">
                선택: <span className="font-semibold">{selectedApproverName}</span>
                {!selectedApproverId && <span className="text-gray-400 dark:text-gray-500"> (직접입력 — 알림 미발송)</span>}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowApproverModal(false)}
                className="px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                취소
              </button>
              <button type="button"
                disabled={!selectedApproverName.trim() || saving}
                onClick={() => {
                  setShowApproverModal(false);
                  if (approverModalForSave) void doSubmit(selectedApproverId ?? undefined, selectedApproverName);
                }}
                className="px-5 py-2 rounded bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                {approverModalForSave ? (saving ? "저장 중..." : "승인 요청 후 저장") : "승인자 변경"}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
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
    ? sites.filter(s => s.name.toLowerCase().includes(q) || (s.alias?.toLowerCase().includes(q) ?? false) || (s.search_keywords?.toLowerCase().includes(q) ?? false)).slice(0, 12)
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
