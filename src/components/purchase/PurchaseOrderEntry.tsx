"use client";

import { useState, useEffect, useRef, useMemo, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { MaterialRecord } from "@/lib/mock-materials";
import { MaterialRequestRecord } from "@/lib/mock-material-requests";
import { ElevatorRecord } from "@/lib/mock-elevators";
import type { PurchaseOrderRecord } from "@/lib/mock-purchase-orders";
import { api, getErrorMessage } from "@/lib/api-client";
import { fmtNum, parseNum } from "@/lib/format";
import { isTkMaterial, TK_TEXT_CLASS, isRepairMaterial } from "@/lib/material-style";
import { PhotoIconBtn } from "@/components/ui/PhotoIconBtn";
import { supabase } from "@/lib/supabase";
import { generateDocNo } from "@/lib/document-no";
import DraggableModal from "@/components/common/DraggableModal";
import ElevatorPicker from "@/components/common/ElevatorPicker";
import PurchaseOrderPrintPaper, { POPrintCompany, POShipInfo, POShipPlace } from "./PurchaseOrderPrintPaper";

interface SiteOption   { id: number; name: string; alias?: string | null; address?: string | null }
interface VendorOption { id: number; name: string }

interface Row {
  id: string;                  // 클라이언트 임시 키
  lineId: number | null;       // 서버 라인 id (편집 시)
  materialId: string;
  materialName: string;
  spec: string;
  qty: number;
  receivedQty: number;         // 편집 시 서버에서 로드된 누적 입고량 (읽기전용 표시)
  unitPrice: number;
  elevatorName: string;
  remark: string;
  reqId: number | null;
  status: "발주" | "부분입고" | "입고완료" | "취소";  // 편집 시 표시용
  imgUrls: string[];
}

function newRow(seed: Partial<Row> = {}): Row {
  return {
    id: crypto.randomUUID(), lineId: null, materialId: "", materialName: "", spec: "",
    qty: 0, receivedQty: 0, unitPrice: 0, elevatorName: "", remark: "", reqId: null,
    status: "발주", imgUrls: [], ...seed,
  };
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

// 발주서 발송지 지정 장소 (고정 목록 — 화물사/택배 안내문)
const FIXED_SHIP_PLACES: POShipPlace[] = [
  { label: "대산화물 (고양식사 지점)",         address: "대산화물 : 고양식사 지점으로 발송 부탁드립니다." },
  { label: "경동화물 (장항 543지점)",          address: "경동화물 : 장항 543지점으로 발송 부탁드립니다." },
  { label: "경동화물 (파주 아동동 353지점)",    address: "경동화물 : 파주 아동동 353지점으로 발송 부탁드립니다." },
  { label: "당사 사무실 (택배)",               address: "당사 사무실로 택배 발송 부탁드립니다." },
  { label: "당사 사무실 지하2층 (입고)",        address: "당사 사무실 지하2층으로 입고 부탁드립니다." },
];

export default function PurchaseOrderEntry({ editId }: { editId?: number } = {}) {
  const router = useRouter();
  const { user } = useAuth();
  const isEdit = editId != null && editId > 0;

  const [orderDate,   setOrderDate]   = useState(todayISO());
  const [sites,       setSites]       = useState<SiteOption[]>([]);
  const [vendors,     setVendors]     = useState<VendorOption[]>([]);
  const [pendingRequests, setPendingRequests] = useState<MaterialRequestRecord[]>([]);
  const [vendorName,  setVendorName]  = useState("");
  const [managerName, setManagerName] = useState("");
  const [siteName,    setSiteName]    = useState("");
  const [elevators,   setElevators]   = useState<ElevatorRecord[]>([]);
  const [reference,   setReference]   = useState("");
  // 발주참조번호 — 사용자가 발주서에 직접 적는 외부 시스템 참조번호 (예: MNG2026MMNNN).
  // note 첫 [태그]에 저장되어 자동채번 order_no 와 별개로 관리됨.
  const [orderRefNo,  setOrderRefNo]  = useState("");
  const [matType,     setMatType]     = useState<"전체" | "DS" | "TK">("전체");
  const [formType,    setFormType]    = useState<"기본" | "긴급" | "수리">("기본");
  const [requesterNames, setRequesterNames] = useState<string[]>([]);
  const [requesterPhones, setRequesterPhones] = useState<Record<string, string>>({});
  const [removedLineIds, setRemovedLineIds] = useState<Set<number>>(new Set());
  const [editLoading, setEditLoading] = useState(isEdit);

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      setMatType(user.name === "황진한" ? "DS" : user.name === "박은숙" ? "TK" : "전체");
    }, 0);
    return () => clearTimeout(t);
  }, [user]);

  useEffect(() => {
    api.get<SiteOption[]>("/api/sites").then(setSites).catch(() => {});
    api.get<VendorOption[]>("/api/vendors?type=매입").then(setVendors).catch(() => {});
    api.get<MaterialRequestRecord[]>("/api/material-requests")
      .then(data => setPendingRequests(data.filter(r => r.status === "신청" || r.status === "처리중")))
      .catch(() => {});
    api.get<{ name: string; status: string | null; phone: string | null }[]>("/api/users")
      .then(data => {
        const active = data.filter(u => u.status === "재직");
        setRequesterNames(active.map(u => u.name).sort());
        const pmap: Record<string, string> = {};
        active.forEach(u => { if (u.phone) pmap[u.name] = u.phone; });
        setRequesterPhones(pmap);
      })
      .catch(() => {});
    (async () => {
      const { data } = await supabase.from("quote_settings")
        .select("company_name, company_biz_no, company_address, company_phone, company_email, company_ceo, company_stamp_url")
        .eq("id", 1).maybeSingle();
      if (data) setCompany(data as POPrintCompany);
    })();
  }, []);

  const [orderNo,     setOrderNo]     = useState<string>("");  // 자동 채번 결과 (수정 진입 시 기존 값, 저장 시 신규 발급)
  const [freeOfCharge, setFreeOfCharge] = useState(false);  // 무상: 체크 시 구매단가 0원
  const [files,       setFiles]       = useState<File[]>([]);
  const [popup,       setPopup]       = useState<null | "request">(null);
  const [rows,        setRows]        = useState<Row[]>(() =>
    isEdit ? [] : [newRow(), newRow(), newRow(), newRow(), newRow()]
  );

  // 모든 유효 라인이 입고완료인 경우 → 전체 조회 전용 모드
  const isFullyReceived = isEdit && !editLoading &&
    rows.some(r => r.lineId != null) &&
    rows.filter(r => r.lineId != null && r.status !== "취소").every(r => r.status === "입고완료");
  const isReadOnly = isFullyReceived;
  const [saving,      setSaving]      = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [company,     setCompany]     = useState<POPrintCompany | null>(null);
  const [shipInfo,    setShipInfo]    = useState<POShipInfo>({ shipTo: "", dueDate: "", receiver: "", contact: "", manager: "", note: "" });

  // 편집 모드: editId는 이제 발주 헤더 id. 헤더+라인 배열을 한 번의 요청으로 로드.
  useEffect(() => {
    if (!isEdit || !editId) return;
    let cancelled = false;
    (async () => {
      try {
        // GET /api/purchase-orders/:orderId 는 헤더+라인을 join 해 PurchaseOrderRecord[] 반환
        const rows = await api.get<PurchaseOrderRecord[]>(`/api/purchase-orders/${editId}`);
        if (rows.length === 0) { alert("발주 내역을 찾을 수 없습니다."); router.push("/purchase-orders"); return; }
        const ids = [...new Set(rows.map(o => o.materialId))];
        const matMap = new Map<string, MaterialRecord>();
        await Promise.all(ids.map(async mid => {
          try {
            const list = await api.get<MaterialRecord[]>(`/api/materials?q=${encodeURIComponent(mid)}`);
            const m = list.find(x => x.id === mid);
            if (m) matMap.set(mid, m);
          } catch {}
        }));
        if (cancelled) return;
        const head = rows[0];
        setVendorName(head.vendorName ?? "");
        setSiteName(head.siteName ?? "");
        setManagerName(head.requesterName ?? "");
        setOrderNo(head.orderNo ?? "");
        setOrderRefNo(head.orderRefNo ?? "");
        setFormType(head.formType);
        setOrderDate(head.orderedAt.slice(0, 10));
        setShipInfo({
          shipTo:   head.shipTo       ?? "",
          dueDate:  head.shipDueDate  ?? "",
          receiver: head.shipReceiver ?? "",
          contact:  head.shipContact  ?? "",
          manager:  head.shipManager  ?? "",
          note:     head.shipNote     ?? "",
        });
        setReference(head.headerNote ?? "");
        const loaded = rows.map(o => {
          const m = matMap.get(o.materialId);
          const imgUrls = [m?.referenceImageUrl1, m?.referenceImageUrl2, m?.opinionImageUrl].filter((u): u is string => !!u);
          return newRow({
            lineId: o.id,
            materialId: o.materialId,
            materialName: o.materialName,
            spec: m?.modelNo ?? "",
            qty: o.qty,
            receivedQty: o.receivedQty,
            unitPrice: o.unitPrice ?? 0,
            elevatorName: o.elevatorName ?? "",
            remark: o.note ?? "",
            reqId: o.requestId,
            status: o.status,
            imgUrls,
          });
        });
        // 신규 행 추가가 가능하도록 마지막에 빈 행 1개 부착
        setRows([...loaded, newRow()]);
      } catch (e) {
        alert(getErrorMessage(e));
      } finally {
        if (!cancelled) setEditLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isEdit, editId, router]);

  useEffect(() => {
    if (!siteName) {
      const t = setTimeout(() => setElevators([]), 0);
      return () => clearTimeout(t);
    }
    api.get<ElevatorRecord[]>(`/api/elevators?site=${encodeURIComponent(siteName)}`).then(setElevators).catch(() => setElevators([]));
  }, [siteName]);

  function patchRow(id: string, patch: Partial<Row>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }

  function addRow() { setRows(prev => [...prev, newRow()]); }
  function removeRow(id: string) {
    const tgt = rows.find(r => r.id === id);
    if (tgt?.lineId) {
      if (tgt.receivedQty > 0) {
        alert("이미 일부/전량 입고된 라인은 삭제할 수 없습니다.\n입고를 먼저 취소한 뒤 시도해 주세요.");
        return;
      }
      if (!confirm("기존 발주 행을 삭제하면 저장 시 영구 삭제됩니다. 진행할까요?")) return;
      setRemovedLineIds(set => {
        const next = new Set(set);
        next.add(tgt.lineId!);
        return next;
      });
    }
    setRows(prev => prev.length <= 1 ? [newRow()] : prev.filter(r => r.id !== id));
  }
  function clearAll() {
    if (isEdit) return;
    setRows([newRow(), newRow(), newRow(), newRow(), newRow()]);
    setVendorName(""); setSiteName(""); setReference(""); setOrderNo(""); setOrderRefNo(""); setFiles([]);
  }

  function applyMultipleMaterials(startRowId: string, materials: MaterialRecord[]) {
    setRows(prev => {
      const next = [...prev];
      const startIdx = next.findIndex(r => r.id === startRowId);
      materials.forEach((m, i) => {
        const idx = startIdx + i;
        const unitPrice = freeOfCharge ? 0 : (m.buyPrice ?? 0);
        const imgUrls = [m.referenceImageUrl1, m.referenceImageUrl2, m.opinionImageUrl].filter((u): u is string => !!u);
        const patch = { materialId: m.id, materialName: m.name, spec: m.modelNo ?? "", qty: 1, unitPrice, imgUrls };
        if (idx < next.length) next[idx] = { ...next[idx], ...patch };
        else next.push(newRow(patch));
      });
      return next;
    });
  }

  async function applyRequest(req: MaterialRequestRecord) {
    if (req.siteName) setSiteName(req.siteName);
    if (req.requesterName) setManagerName(req.requesterName);
    const newRows: Row[] = [];
    for (const item of req.items) {
      const list = await api.get<MaterialRecord[]>(`/api/materials?q=${encodeURIComponent(item.materialId)}`).catch(() => [] as MaterialRecord[]);
      const m = list.find(x => x.id === item.materialId);
      const unitPrice = freeOfCharge ? 0 : (m?.buyPrice ?? 0);
      newRows.push(newRow({ materialId: item.materialId, materialName: item.materialName, spec: m?.modelNo ?? "", qty: item.qty, unitPrice, elevatorName: item.elevatorName ?? "", remark: `신청#${req.id}`, reqId: req.id }));
    }
    setRows([...newRows, newRow()]);
    setPopup(null);
  }

  const totals = useMemo(() => {
    let qty = 0, supply = 0;
    for (const r of rows) { qty += r.qty; supply += r.qty * r.unitPrice; }
    return { qty, supply };
  }, [rows]);

  // 발송지 선택 후보: 지정 장소(고정 5곳) + 등록 현장 → 선택 시 해당 안내문/주소가 입력됨
  const shipPlaces = useMemo<POShipPlace[]>(() => [
    ...FIXED_SHIP_PLACES,
    ...sites.map(s => ({ label: s.name, address: s.address || s.name })),
  ], [sites]);

  async function save(goList: boolean) {
    if (!user) return;
    const valid = rows.filter(r => r.materialId && r.qty > 0);
    if (valid.length === 0 && removedLineIds.size === 0) {
      alert("품목을 1개 이상 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      // 사용자가 오늘 외 날짜 지정 시 그 날짜 자정(UTC), 오늘이면 현재 시각으로 저장
      const orderedAtIso = orderDate === todayISO()
        ? new Date().toISOString()
        : new Date(`${orderDate}T00:00:00Z`).toISOString();

      // 발주번호 — 신규는 채번, 수정은 기존 값 유지
      const effectiveOrderNo = isEdit && orderNo ? orderNo : await generateDocNo("B", orderDate);
      if (!isEdit) setOrderNo(effectiveOrderNo);

      const header = {
        orderNo:       effectiveOrderNo,
        vendorName:    vendorName || null,
        siteName:      siteName || null,
        requesterName: managerName || null,
        orderedAt:     orderedAtIso,
        orderRefNo:    orderRefNo || null,
        formType:      formType,
        note:          reference || null,
        userId:        user.id,
        userName:      user.name,
        shipTo:        shipInfo.shipTo   || null,
        shipDueDate:   shipInfo.dueDate  || null,
        shipReceiver:  shipInfo.receiver || null,
        shipContact:   shipInfo.contact  || null,
        shipManager:   shipInfo.manager  || null,
        shipNote:      shipInfo.note     || null,
      };

      const lines = valid.map((r, i) => ({
        id:           r.lineId,          // null 이면 신규 라인
        lineNo:       i + 1,
        materialId:   r.materialId,
        materialName: r.materialName,
        qty:          r.qty,
        unitPrice:    r.unitPrice || null,
        elevatorName: r.elevatorName || null,
        requestId:    r.reqId,
        note:         r.remark || null,
      }));

      if (isEdit && editId) {
        await api.patch(`/api/purchase-orders/${editId}`, {
          action: "저장",
          header,
          lines,
          removedLineIds: [...removedLineIds],
        });
      } else {
        await api.post("/api/purchase-orders", { header, lines });
      }
      setRemovedLineIds(new Set());
      window.dispatchEvent(new CustomEvent("ds:purchase_orders_changed"));
      if (goList || isEdit) {
        router.push("/purchase-orders");
      } else {
        clearAll();
      }
    } catch (e) { alert(getErrorMessage(e)); }
    finally { setSaving(false); }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === "F8") { e.preventDefault(); save(false); }
    else if (e.key === "F7") { e.preventDefault(); setPreviewOpen(true); }
  }

  return (
    <div onKeyDown={handleKey} tabIndex={-1} className="flex flex-col h-full bg-[#f5f6fa] dark:bg-gray-900 outline-none">

      <div className="flex items-center justify-between px-5 py-2.5 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h1 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <span className="text-indigo-500">📑</span>
          {isEdit ? (isReadOnly ? "발주서 조회" : "발주서 수정") : "발주서입력"}
          {isEdit && editLoading && <span className="text-xs text-gray-400 ml-2">불러오는 중...</span>}
          {isReadOnly && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 font-semibold">입고완료</span>}
        </h1>
      </div>

      <div className="px-5 py-2 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
        <MatTypeToggle value={matType} onChange={setMatType} />
        <span className="text-xs text-gray-500 dark:text-gray-400">양식</span>
        <select value={formType} onChange={e => setFormType(e.target.value as typeof formType)}
          disabled={isReadOnly}
          className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-200 disabled:opacity-60 disabled:cursor-not-allowed">
          <option value="기본">기본발주서</option>
          <option value="긴급">긴급발주서</option>
          <option value="수리">수리부품 발주서</option>
        </select>
        {formType !== "기본" && (
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${formType === "긴급" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>
            [{formType}]
          </span>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-5 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <FormField label="일자" required className="w-44">
            <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} readOnly={isReadOnly}
              className={`${inputCls}${isReadOnly ? " bg-gray-50 dark:bg-gray-900/30 cursor-not-allowed text-gray-500 dark:text-gray-500" : ""}`} />
          </FormField>
          <FormField label="거래처" required className="w-64">
            <VendorInlineSearch value={vendorName} onChange={setVendorName} vendors={vendors} readOnly={isReadOnly} />
          </FormField>
          <FormField label="신청자" className="w-48">
            <RequesterInlineSearch value={managerName} onChange={setManagerName} names={requesterNames} phones={requesterPhones} readOnly={isReadOnly} />
          </FormField>
          <FormField label="무상" className="w-20">
            <input
              type="checkbox"
              checked={freeOfCharge}
              disabled={isReadOnly}
              onChange={e => {
                const on = e.target.checked;
                setFreeOfCharge(on);
                // 무상 체크 시 모든 행의 구매단가를 0원으로
                if (on) setRows(prev => prev.map(r => ({ ...r, unitPrice: 0 })));
              }}
              className={`h-4 w-4 rounded accent-blue-600 ${isReadOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            />
          </FormField>
          <FormField label="현장" className="w-80 flex-1 min-w-[280px]">
            <SiteInlineSearch value={siteName} onChange={setSiteName} sites={sites} readOnly={isReadOnly} />
          </FormField>
          <FormField label="발주참조번호" className="w-56">
            <div className={`flex items-center w-full border border-gray-300 dark:border-gray-600 rounded ${isReadOnly ? "bg-gray-50 dark:bg-gray-900/30" : "bg-white dark:bg-gray-700 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-200"}`}>
              <span className="pl-2 pr-0.5 text-xs font-medium text-gray-500 dark:text-gray-400 select-none whitespace-nowrap">MNG</span>
              <input
                type="text"
                value={orderRefNo.startsWith("MNG") ? orderRefNo.slice(3) : orderRefNo}
                onChange={e => setOrderRefNo("MNG" + e.target.value)}
                readOnly={isReadOnly}
                placeholder="숫자 10자리"
                maxLength={10}
                className={`flex-1 min-w-0 py-1 pr-2 text-xs font-medium bg-transparent focus:outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:font-normal ${isReadOnly ? "text-gray-500 dark:text-gray-500 cursor-not-allowed" : "text-gray-900 dark:text-gray-100"}`}
              />
            </div>
          </FormField>
          <FormField label="참조" className="flex-1 min-w-[280px]">
            <input type="text" value={reference} onChange={e => setReference(e.target.value)} readOnly={isReadOnly}
              className={`${inputCls} w-full${isReadOnly ? " bg-gray-50 dark:bg-gray-900/30 cursor-not-allowed text-gray-500 dark:text-gray-500" : ""}`} />
          </FormField>
        </div>
        {!isReadOnly && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">첨부파일</label>
            <label className="flex items-center justify-center gap-2 w-full border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-lg py-3 text-xs text-gray-400 dark:text-gray-500 hover:border-blue-300 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 cursor-pointer transition-colors">
              <span className="text-base">+</span>
              <span>{files.length === 0 ? "파일을 추가하려면 클릭하거나 드래그하세요" : `${files.length}개 파일`}</span>
              <input type="file" multiple className="hidden" onChange={e => setFiles(Array.from(e.target.files ?? []))} />
            </label>
          </div>
        )}
      </div>

      <div className="bg-[#f0f2f5] dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 px-5 py-2 flex items-center gap-2 flex-wrap text-xs shrink-0">
        {isReadOnly ? (
          <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold">
            🔒 입고완료 — 조회 전용 (수정 불가)
          </span>
        ) : (
          <button type="button" onClick={() => setPopup("request")}
            className="px-4 py-1.5 rounded-md bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-sm transition-colors flex items-center gap-1.5 text-xs ring-2 ring-blue-600 ring-offset-1 dark:ring-offset-gray-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
            자재신청 참조 (불러오기)
          </button>
        )}
        <span className="ml-auto text-gray-500 dark:text-gray-400">{rows.filter(r => r.materialId).length} / {rows.length} 행</span>
      </div>

      <div className="flex-1 overflow-auto bg-white dark:bg-gray-800">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10 bg-[#e9ecef] dark:bg-gray-700">
            <tr className="bg-[#e9ecef] dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              <Th w="32">No</Th>
              <Th w="120">품목코드</Th>
              <Th w="220">품목명</Th>
              <Th w="120">규격</Th>
              <Th w="80">수량</Th>
              <Th w="110">구매단가</Th>
              <Th w="120">공급가액</Th>
              <Th w="100">호기</Th>
              <Th w="160">적요</Th>
              <Th w="40"></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isExisting = r.lineId != null;
              const isReceived = isExisting && r.receivedQty > 0;  // 부분/전량 입고된 라인
              return (
              <tr key={r.id} className={`border-b border-gray-100 dark:border-gray-700 ${isExisting ? "bg-gray-50/40 dark:bg-gray-900/30" : "hover:bg-blue-50/30 dark:hover:bg-blue-900/10"}`}>
                <Td center className="text-gray-800 dark:text-gray-200 font-medium">
                  {i + 1}
                  {isExisting && <span className="ml-1 text-[9px] text-gray-400">#{r.lineId}</span>}
                  {isReceived && (
                    <span className={`ml-1 text-[9px] px-1 rounded font-bold ${r.status === "입고완료" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>
                      {r.status === "입고완료" ? "완료" : `부분 ${r.receivedQty}/${r.qty}`}
                    </span>
                  )}
                </Td>
                <Td>
                  {isExisting ? (
                    <div className={`px-1.5 py-1 text-xs font-mono truncate ${isTkMaterial(r.materialId) ? TK_TEXT_CLASS : "text-gray-600 dark:text-gray-400"}`}>{r.materialId}</div>
                  ) : (
                    <MatInlineSearch
                      value={r.materialId}
                      materialId={r.materialId}
                      matType={matType}
                      onMultiSelect={materials => applyMultipleMaterials(r.id, materials)}
                      onChange={v => patchRow(r.id, { materialId: v, materialName: v, spec: v })}
                    />
                  )}
                </Td>
                <Td>
                  <div className="flex items-center gap-1">
                    {isRepairMaterial(r.materialId) && <span className="shrink-0 text-[9px] px-1 rounded bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300 font-bold">RE</span>}
                    <div className="flex-1 min-w-0">
                      {isExisting ? (
                        <div className={`px-1.5 py-1 text-xs truncate ${isTkMaterial(r.materialId) ? TK_TEXT_CLASS : "text-gray-700 dark:text-gray-300"}`}>{r.materialName}</div>
                      ) : (
                        <MatInlineSearch value={r.materialName} materialId={r.materialId} matType={matType}
                          onMultiSelect={materials => applyMultipleMaterials(r.id, materials)}
                          onChange={v => patchRow(r.id, { materialId: v, materialName: v, spec: v })} />
                      )}
                    </div>
                    {r.imgUrls.length > 0 && <PhotoIconBtn urls={r.imgUrls} />}
                  </div>
                </Td>
                <Td>
                  {isExisting ? (
                    <div className="px-1.5 py-1 text-xs text-gray-600 dark:text-gray-400 truncate">{r.spec}</div>
                  ) : (
                    <MatInlineSearch
                      value={r.spec}
                      materialId={r.materialId}
                      matType={matType}
                      onMultiSelect={materials => applyMultipleMaterials(r.id, materials)}
                      onChange={v => patchRow(r.id, { materialId: v, materialName: v, spec: v })}
                    />
                  )}
                </Td>
                <Td right>
                  <input
                    type="text" inputMode="numeric"
                    readOnly={isReceived || isReadOnly}
                    title={isReceived ? "이미 입고가 시작된 라인은 수량 변경 불가" : undefined}
                    value={r.qty === 0 ? "" : String(r.qty)}
                    onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ""); patchRow(r.id, { qty: v === "" ? 0 : Number(v) }); }}
                    className={cellInput + " text-right" + ((isReceived || isReadOnly) ? " text-gray-400 cursor-not-allowed" : "")}
                  />
                </Td>
                <Td right>
                  <input type="text" inputMode="numeric" readOnly={freeOfCharge || isReadOnly}
                    value={freeOfCharge ? "0" : (r.unitPrice === 0 ? "" : fmtNum(r.unitPrice))}
                    onChange={e => patchRow(r.id, { unitPrice: parseNum(e.target.value) })}
                    className={cellInput + " text-right" + ((freeOfCharge || isReadOnly) ? " text-gray-400 cursor-not-allowed" : "")} />
                </Td>
                <Td right className="text-gray-700 dark:text-gray-300 tabular-nums">{fmtNum(r.qty * r.unitPrice)}</Td>
                <Td>
                  {isReadOnly ? (
                    <div className="px-1.5 py-1 text-xs text-gray-600 dark:text-gray-400">{r.elevatorName}</div>
                  ) : elevators.length > 0 ? (
                    <ElevatorPicker value={r.elevatorName} elevators={elevators}
                      onChange={v => patchRow(r.id, { elevatorName: v })} />
                  ) : (
                    <input type="text" value={r.elevatorName} onChange={e => patchRow(r.id, { elevatorName: e.target.value })} className={cellInput} />
                  )}
                </Td>
                <Td>
                  <input type="text" value={r.remark} readOnly={isReadOnly} onChange={e => patchRow(r.id, { remark: e.target.value })}
                    className={cellInput + (isReadOnly ? " cursor-not-allowed text-gray-500 dark:text-gray-500" : "")} />
                </Td>
                <Td center>
                  {!isReadOnly && (
                    <button type="button" onClick={() => removeRow(r.id)} className="text-gray-300 hover:text-red-400 leading-none">×</button>
                  )}
                </Td>
              </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0">
            <tr className="bg-[#e9ecef] dark:bg-gray-700 font-semibold border-t-2 border-gray-300 dark:border-gray-600">
              <Td colSpan={4} center className="text-gray-600 dark:text-gray-400">합 계</Td>
              <Td right className="tabular-nums dark:text-gray-300">{fmtNum(totals.qty)}</Td>
              <Td></Td>
              <Td right className="tabular-nums text-blue-700">{fmtNum(totals.supply)}</Td>
              <Td colSpan={3}></Td>
            </tr>
          </tfoot>
        </table>
        {!isReadOnly && (
          <div className="px-5 py-2">
            <button type="button" onClick={addRow} className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600">+ 행 추가</button>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-5 py-3 flex items-center justify-end gap-2">
        <button type="button" onClick={() => router.push("/purchase-orders")} className="text-xs px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">{isEdit ? (isReadOnly ? "목록" : "취소") : "리스트"}</button>
        {!isEdit && (
          <>
            <button type="button" onClick={clearAll} className="text-xs px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">다시 작성</button>
            <button type="button" className="text-xs px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">웹자료올리기</button>
          </>
        )}
        <button type="button" onClick={() => setPreviewOpen(true)} className="text-xs px-4 py-2 rounded border border-blue-300 text-blue-700 hover:bg-blue-50">
          🖨 발주서
        </button>
        {!isReadOnly && (
          <button type="button" disabled={saving || editLoading} onClick={() => save(false)} className="text-xs px-5 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 shadow-sm">
            {saving ? "저장 중..." : isEdit ? "변경 저장" : "저장"}
          </button>
        )}
      </div>

      {popup === "request" && (
        <RequestPopup requests={pendingRequests} onClose={() => setPopup(null)} onSelect={applyRequest} />
      )}

      {/* 발주서 미리보기 / 인쇄 오버레이 — body 직접 자식으로 띄워야 인쇄 시 AdminShell의 absolute 컨테이너에 갇히지 않음 */}
      {previewOpen && typeof window !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 bg-gray-100 dark:bg-gray-900 overflow-auto po-preview-overlay">
          <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm px-4 py-2 flex items-center gap-2 print:hidden">
            <span className="text-sm font-bold text-gray-800 dark:text-gray-100">🖨 발주서 미리보기</span>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => window.print()}
                className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white font-semibold hover:bg-blue-700">🖨 인쇄 / PDF로 저장</button>
              <button type="button" onClick={() => setPreviewOpen(false)}
                className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">✕ 닫기</button>
            </div>
          </div>
          <div className="p-6 print:p-0">
            <PurchaseOrderPrintPaper
              orderDate={orderDate}
              vendorName={vendorName}
              managerName={managerName}
              managerPhone={requesterPhones[managerName] ?? ""}
              ordererName={user?.name ?? ""}
              siteName={siteName}
              orderNo={orderNo}
              formType={formType}
              reference={reference}
              items={rows.map(r => ({
                materialId:   r.materialId,
                materialName: r.materialName,
                spec:         r.spec,
                qty:          r.qty,
                unitPrice:    r.unitPrice,
                elevatorName: r.elevatorName,
                remark:       r.remark,
              }))}
              company={company}
              shipInfo={shipInfo}
              onShipInfoChange={patch => setShipInfo(s => ({ ...s, ...patch }))}
              shipPlaces={shipPlaces}
            />
          </div>

          {/* 인쇄 시 미리보기만 출력되도록 격리 — portal로 body 직접 자식이 됐으므로 display 방식으로 깔끔히 격리 가능 */}
          <style jsx global>{`
            @media print {
              html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
              body > *:not(.po-preview-overlay) { display: none !important; }
              .po-preview-overlay {
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

// ── 공통 헬퍼 ──────────────────────────────────────────────────
const inputCls = "w-full px-2 py-1 text-xs font-medium text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:font-normal";
const cellInput = "w-full px-1.5 py-1 text-xs font-medium text-gray-900 dark:text-gray-100 border-0 bg-white dark:bg-gray-800 focus:outline-none focus:bg-yellow-50 dark:focus:bg-yellow-900/20 focus:ring-1 focus:ring-blue-300 placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:font-normal";

function FormField({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
      <label className="text-xs font-medium text-gray-800 dark:text-gray-200 shrink-0 text-right whitespace-nowrap">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function ToolBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 hover:border-blue-300 transition-colors">
      {children}
    </button>
  );
}

function MatTypeToggle({ value, onChange }: { value: "전체" | "DS" | "TK"; onChange: (v: "전체" | "DS" | "TK") => void }) {
  return (
    <div className="flex rounded overflow-hidden border border-gray-300 dark:border-gray-600 shrink-0">
      {(["전체", "DS", "TK"] as const).map(t => (
        <button key={t} type="button" onClick={() => onChange(t)}
          className={`px-2.5 py-1 text-xs font-semibold transition-colors ${value === t ? t === "DS" ? "bg-red-500 text-white" : t === "TK" ? "bg-blue-600 text-white" : "bg-slate-600 text-white" : "bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600"}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

function Th({ children, w }: { children?: React.ReactNode; w?: string }) {
  return (
    <th style={{ width: w ? `${w}px` : undefined }}
      className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 font-medium text-gray-700 dark:text-gray-300 text-center">
      {children}
    </th>
  );
}

function Td({ children, right, center, className = "", colSpan }: { children?: React.ReactNode; right?: boolean; center?: boolean; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={`px-1 py-0.5 border border-gray-200 dark:border-gray-700 ${right ? "text-right" : center ? "text-center" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}

// ── 인라인 자동완성 ─────────────────────────────────────────────
function SiteInlineSearch({ value, onChange, sites, readOnly }: { value: string; onChange: (v: string) => void; sites: SiteOption[]; readOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const ulRef = useRef<HTMLUListElement>(null);
  const q = value.trim().toLowerCase();
  const suggestions = q
    ? sites.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.alias?.toLowerCase().includes(q) ?? false)
      ).slice(0, 10)
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
      <input type="text" lang="ko" value={value} readOnly={readOnly}
        onChange={e => { if (!readOnly) { onChange(e.target.value); setOpen(true); } }}
        onFocus={() => { if (!readOnly) setOpen(true); }}
        onKeyDown={handleKeyDown}
        className={`${inputCls}${readOnly ? " bg-gray-50 dark:bg-gray-900/30 cursor-not-allowed text-gray-500 dark:text-gray-500" : ""}`} />
      {!readOnly && open && suggestions.length > 0 && (
        <ul ref={ulRef} className="absolute z-50 top-full left-0 mt-0.5 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-52 overflow-y-auto">
          {suggestions.map((s, idx) => (
            <li key={s.id}>
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onChange(s.name); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs text-gray-800 dark:text-gray-200 border-b border-gray-50 dark:border-gray-700 last:border-0 ${focusedIndex === idx ? "bg-blue-100 dark:bg-blue-900/50" : "hover:bg-blue-50 dark:hover:bg-blue-900/20"}`}>
                <span>{s.name}</span>
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

function RequesterInlineSearch({ value, onChange, names, phones, readOnly }: {
  value: string; onChange: (v: string) => void; names: string[]; phones?: Record<string, string>; readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const ulRef = useRef<HTMLUListElement>(null);
  const suggestions = value.trim()
    ? names.filter(n => n.toLowerCase().includes(value.toLowerCase())).slice(0, 20)
    : names.slice(0, 50);

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
    if (e.key === "Enter") {
      if (suggestions.length === 1) { e.preventDefault(); onChange(suggestions[0]); setOpen(false); return; }
      if (open && focusedIndex >= 0 && suggestions.length > 0) { e.preventDefault(); onChange(suggestions[focusedIndex]); setOpen(false); return; }
      return;
    }
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setFocusedIndex(i => (i < suggestions.length - 1 ? i + 1 : i)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setFocusedIndex(i => (i > 0 ? i - 1 : 0)); }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <input type="text" lang="ko" value={value} placeholder={readOnly ? "" : "입력 또는 선택"}
        readOnly={readOnly}
        onChange={e => { if (!readOnly) { onChange(e.target.value); setOpen(true); } }}
        onFocus={() => { if (!readOnly) setOpen(true); }}
        onKeyDown={handleKeyDown}
        className={`${inputCls}${readOnly ? " bg-gray-50 dark:bg-gray-900/30 cursor-not-allowed text-gray-500 dark:text-gray-500" : ""}`} />
      {!readOnly && open && suggestions.length > 0 && (
        <ul ref={ulRef} className="absolute z-50 top-full left-0 mt-0.5 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-52 overflow-y-auto">
          {suggestions.map((name, idx) => (
            <li key={name}>
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onChange(name); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs text-gray-800 dark:text-gray-200 border-b border-gray-50 dark:border-gray-700 last:border-0 ${focusedIndex === idx ? "bg-blue-100 dark:bg-blue-900/50" : "hover:bg-blue-50 dark:hover:bg-blue-900/20"}`}>
                <span>{name}</span>
                {phones?.[name] && <span className="ml-2 text-[10px] text-gray-400 dark:text-gray-500">{phones[name]}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VendorInlineSearch({ value, onChange, vendors, readOnly }: { value: string; onChange: (v: string) => void; vendors: { id: number; name: string }[]; readOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const ulRef = useRef<HTMLUListElement>(null);
  // 빈 입력일 때도 매입거래처 전체 목록을 펼쳐 볼 수 있도록 노출 (최대 50)
  const suggestions = value.trim()
    ? vendors.filter(v => v.name.toLowerCase().includes(value.toLowerCase())).slice(0, 20)
    : vendors.slice(0, 50);

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
    if (e.key === "Enter") {
      if (suggestions.length === 1) {
        e.preventDefault();
        onChange(suggestions[0].name);
        setOpen(false);
        return;
      }
      if (open && focusedIndex >= 0 && suggestions.length > 0) {
        e.preventDefault();
        onChange(suggestions[focusedIndex].name);
        setOpen(false);
        return;
      }
      return;
    }
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setFocusedIndex(i => (i < suggestions.length - 1 ? i + 1 : i)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setFocusedIndex(i => (i > 0 ? i - 1 : 0)); }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <input type="text" lang="ko" value={value} readOnly={readOnly}
        onChange={e => { if (!readOnly) { onChange(e.target.value); setOpen(true); } }}
        onFocus={() => { if (!readOnly) setOpen(true); }}
        onKeyDown={handleKeyDown}
        className={`${inputCls}${readOnly ? " bg-gray-50 dark:bg-gray-900/30 cursor-not-allowed text-gray-500 dark:text-gray-500" : ""}`} />
      {!readOnly && open && suggestions.length > 0 && (
        <ul ref={ulRef} className="absolute z-50 top-full left-0 mt-0.5 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-52 overflow-y-auto">
          {suggestions.map((v, idx) => (
            <li key={v.id}>
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onChange(v.name); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs text-gray-800 dark:text-gray-200 border-b border-gray-50 dark:border-gray-700 last:border-0 ${focusedIndex === idx ? "bg-blue-100 dark:bg-blue-900/50" : "hover:bg-blue-50 dark:hover:bg-blue-900/20"}`}>
                {v.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MatInlineSearch({ value, materialId, matType, onMultiSelect, onChange }: {
  value: string; materialId?: string; matType: "전체" | "DS" | "TK";
  onMultiSelect: (materials: MaterialRecord[]) => void; onChange: (v: string) => void;
}) {
  const [results, setResults] = useState<MaterialRecord[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [hasFocus, setHasFocus] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const ulRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (focusedIndex >= 0 && ulRef.current) {
      const el = ulRef.current.children[focusedIndex] as HTMLElement;
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!value.trim()) { setResults([]); setOpen(false); return; }
      const params = new URLSearchParams({ q: value });
      if (matType !== "전체") params.set("matType", matType);
      try {
        const data = await api.get<MaterialRecord[]>(`/api/materials?${params}`);
        const sliced = data.slice(0, 15);
        setResults(sliced);
        if (hasFocus) setOpen(sliced.length > 0);
        setFocusedIndex(sliced.length === 1 ? 0 : -1);
      } catch { setResults([]); setOpen(false); }
    }, value.trim() ? 150 : 0);
    return () => clearTimeout(t);
  }, [value, matType, hasFocus]);

  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setChecked(new Set()); } }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function toggle(id: string) { setChecked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }

  function applyChecked() {
    const sel = results.filter(m => checked.has(m.id));
    if (!sel.length) return;
    onMultiSelect(sel); setChecked(new Set()); setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setFocusedIndex(i => (i < results.length - 1 ? i + 1 : i)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setFocusedIndex(i => (i > 0 ? i - 1 : 0)); }
    else if (e.key === " ") { if (focusedIndex >= 0) { e.preventDefault(); toggle(results[focusedIndex].id); } }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (checked.size > 0) applyChecked();
      else if (results.length === 1) { onMultiSelect([results[0]]); setChecked(new Set()); setOpen(false); }
      else if (focusedIndex >= 0) { onMultiSelect([results[focusedIndex]]); setChecked(new Set()); setOpen(false); }
    }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <input type="text" lang="ko" value={value} onChange={e => { onChange(e.target.value); setChecked(new Set()); }}
        onFocus={() => { setHasFocus(true); if (results.length > 0) setOpen(true); }}
        onBlur={() => setHasFocus(false)}
        onKeyDown={handleKeyDown} className={`${cellInput} ${isTkMaterial(materialId) ? "!text-blue-600 dark:!text-blue-400" : ""}`} />
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl">
          <ul ref={ulRef} className="max-h-52 overflow-y-auto">
            {results.map((m, idx) => {
              const repair = isRepairMaterial(m.id) || m.isRepair;
              const tk = !repair && isTkMaterial(m.id);
              const nameCls = repair
                ? "text-green-600 dark:text-green-400"
                : tk ? TK_TEXT_CLASS : "text-gray-800 dark:text-gray-200";
              const codeCls = repair
                ? "text-green-600 dark:text-green-400"
                : tk ? TK_TEXT_CLASS : "text-slate-400 dark:text-slate-500";
              return (
              <li key={m.id}>
                <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => toggle(m.id)}
                  className={`w-full text-left px-3 py-2 border-b border-gray-50 dark:border-gray-700 last:border-0 flex items-center gap-2 ${checked.has(m.id) ? "bg-blue-50 dark:bg-blue-900/30" : focusedIndex === idx ? "bg-blue-100 dark:bg-blue-900/50" : "hover:bg-gray-50 dark:hover:bg-gray-700"}`}>
                  <input type="checkbox" readOnly checked={checked.has(m.id)} className="accent-blue-600 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className={`text-xs font-medium ${nameCls}`}>
                      {repair && <span className="mr-1 text-[9px] px-1 rounded bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300 font-bold align-middle">RE</span>}
                      {m.name}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[10px] font-mono ${codeCls}`}>{m.id}</span>
                      {m.modelNo && <span className="text-[10px] text-gray-500 dark:text-gray-400 border-l border-gray-300 dark:border-gray-600 pl-2">{m.modelNo}</span>}
                      {m.alias && <span className="text-[10px] text-gray-400 dark:text-gray-500">{m.alias}</span>}
                      <span className="text-[10px] text-gray-300 dark:text-gray-500 ml-auto">재고 {fmtNum(m.stockQty)}</span>
                    </div>
                  </div>
                  <PhotoIconBtn urls={[m.referenceImageUrl1, m.referenceImageUrl2, m.opinionImageUrl]} />
                </button>
              </li>
              );
            })}
          </ul>
          <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-b-lg">
            <span className="text-xs text-gray-500 dark:text-gray-400">{checked.size > 0 ? `${checked.size}개 선택됨` : "항목을 클릭하여 선택 (스페이스바로 체크)"}</span>
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={applyChecked} disabled={checked.size === 0}
              className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
              {checked.size > 0 ? `${checked.size}개 추가` : "엔터로 추가"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RequestPopup({ requests, onSelect, onClose }: { requests: MaterialRequestRecord[]; onSelect: (r: MaterialRequestRecord) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const filtered = requests.filter(r => !q || (r.siteName?.toLowerCase().includes(q.toLowerCase()) ?? false) || r.requesterName.toLowerCase().includes(q.toLowerCase()) || r.items.some(i => i.materialName.toLowerCase().includes(q.toLowerCase())));
  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-[720px] max-h-[75vh]"
      header={
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-semibold dark:text-gray-100">자재신청 불러오기</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">×</button>
        </div>
      }
    >
        <div className="p-3">
          <input type="text" value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="현장명, 신청자, 자재명 검색"
            className="w-full px-3 py-2 text-sm font-medium text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-500 placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:font-normal" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map(r => (
            <button key={r.id} type="button" onClick={() => onSelect(r)} className="w-full text-left px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-semibold">#{r.id}</span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{r.siteName ?? "현장미지정"}</span>
                <span className="text-xs text-gray-700 dark:text-gray-400">— {r.requesterName} ({r.requesterDept})</span>
                <span className="ml-auto text-xs text-gray-600 dark:text-gray-400">{r.requestedAt.slice(0, 10)}</span>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                {r.items.map((i, idx) => <span key={idx}>{idx > 0 && " · "}{i.materialName} × {i.qty}</span>)}
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-center py-8 text-xs text-gray-400 dark:text-gray-500">신청 내역 없음</p>}
        </div>
    </DraggableModal>
  );
}
