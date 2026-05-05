"use client";

import { useState, useEffect, useRef, useMemo, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { MaterialRecord } from "@/lib/mock-materials";
import { MaterialRequestRecord } from "@/lib/mock-material-requests";
import { ElevatorRecord } from "@/lib/mock-elevators";
import { api, getErrorMessage } from "@/lib/api-client";
import ElevatorPicker from "@/components/common/ElevatorPicker";

interface SiteOption   { id: number; name: string }
interface VendorOption { id: number; name: string }

interface Row {
  id: string;
  materialId: string;
  materialName: string;
  spec: string;
  qty: number;
  unitPrice: number;
  vat: number;
  elevatorName: string;
  remark: string;
  reqId: number | null;
}

const VAT_RATE = 0.1;

function newRow(seed: Partial<Row> = {}): Row {
  return { id: crypto.randomUUID(), materialId: "", materialName: "", spec: "", qty: 0, unitPrice: 0, vat: 0, elevatorName: "", remark: "", reqId: null, ...seed };
}

function fmtNum(n: number) { return n.toLocaleString(); }
function todayISO() { return new Date().toISOString().slice(0, 10); }

export default function PurchaseOrderEntry() {
  const router = useRouter();
  const { user } = useAuth();

  const [orderDate,   setOrderDate]   = useState(todayISO());
  const [sites,       setSites]       = useState<SiteOption[]>([]);
  const [vendors,     setVendors]     = useState<VendorOption[]>([]);
  const [pendingRequests, setPendingRequests] = useState<MaterialRequestRecord[]>([]);
  const [vendorName,  setVendorName]  = useState("");
  const [managerName, setManagerName] = useState(user?.name ?? "");
  const [siteName,    setSiteName]    = useState("");
  const [topElevatorName, setTopElevatorName] = useState("");
  const [elevators,   setElevators]   = useState<ElevatorRecord[]>([]);
  const [reference,   setReference]   = useState("");
  const [matType,     setMatType]     = useState<"전체" | "DS" | "TK">("전체");

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
  }, []);

  const [orderRefNo,  setOrderRefNo]  = useState("");
  const [files,       setFiles]       = useState<File[]>([]);
  const [popup,       setPopup]       = useState<null | "request">(null);
  const [rows,        setRows]        = useState<Row[]>([newRow(), newRow(), newRow(), newRow(), newRow()]);
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
    if (!siteName) {
      const t = setTimeout(() => setElevators([]), 0);
      return () => clearTimeout(t);
    }
    api.get<ElevatorRecord[]>(`/api/elevators?site=${encodeURIComponent(siteName)}`).then(setElevators).catch(() => setElevators([]));
  }, [siteName]);

  function patchRow(id: string, patch: Partial<Row>) {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const next = { ...r, ...patch };
      if (patch.qty !== undefined || patch.unitPrice !== undefined)
        next.vat = Math.round(next.qty * next.unitPrice * VAT_RATE);
      return next;
    }));
  }

  function addRow() { setRows(prev => [...prev, newRow()]); }
  function removeRow(id: string) {
    setRows(prev => prev.length <= 1 ? [newRow()] : prev.filter(r => r.id !== id));
  }
  function clearAll() {
    setRows([newRow(), newRow(), newRow(), newRow(), newRow()]);
    setVendorName(""); setSiteName(""); setTopElevatorName(""); setReference(""); setOrderRefNo(""); setFiles([]);
  }

  function applyMultipleMaterials(startRowId: string, materials: MaterialRecord[]) {
    setRows(prev => {
      const next = [...prev];
      const startIdx = next.findIndex(r => r.id === startRowId);
      materials.forEach((m, i) => {
        const idx = startIdx + i;
        const unitPrice = m.buyPrice ?? 0;
        const patch = { materialId: m.id, materialName: m.name, spec: m.modelNo ?? "", qty: 1, unitPrice, vat: Math.round(unitPrice * VAT_RATE) };
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
      const unitPrice = m?.buyPrice ?? 0;
      newRows.push(newRow({ materialId: item.materialId, materialName: item.materialName, spec: m?.modelNo ?? "", qty: item.qty, unitPrice, vat: Math.round(item.qty * unitPrice * VAT_RATE), elevatorName: item.elevatorName ?? "", remark: `신청#${req.id}`, reqId: req.id }));
    }
    setRows([...newRows, newRow()]);
    setPopup(null);
  }

  const totals = useMemo(() => {
    let qty = 0, supply = 0, vat = 0;
    for (const r of rows) { qty += r.qty; supply += r.qty * r.unitPrice; vat += r.vat; }
    return { qty, supply, vat, total: supply + vat };
  }, [rows]);

  async function save(goList: boolean) {
    if (!user) return;
    const valid = rows.filter(r => r.materialId && r.qty > 0);
    if (valid.length === 0) { alert("품목을 1개 이상 입력해 주세요."); return; }
    setSaving(true);
    try {
      for (const r of valid) {
        await api.post("/api/purchase-orders", {
          materialId: r.materialId, materialName: r.materialName, qty: r.qty,
          vendorName: vendorName || null, unitPrice: r.unitPrice || null, requestId: r.reqId,
          siteName: siteName || null, elevatorName: r.elevatorName || topElevatorName || null,
          requesterName: managerName || null, note: [orderRefNo ? `[${orderRefNo}]` : "", r.remark || reference || ""].filter(Boolean).join(" ") || null,
          userId: user.id, userName: user.name,
        });
      }
      if (goList) router.push("/purchase-orders");
      else clearAll();
    } catch (e) { alert(getErrorMessage(e)); }
    finally { setSaving(false); }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === "F8") { e.preventDefault(); save(false); }
    else if (e.key === "F7") { e.preventDefault(); save(true); }
  }

  return (
    <div onKeyDown={handleKey} tabIndex={-1} className="flex flex-col h-full bg-[#f5f6fa] dark:bg-gray-900 outline-none">

      <div className="flex items-center justify-between px-5 py-2.5 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h1 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <span className="text-indigo-500">📑</span> 발주서입력
        </h1>
      </div>

      <div className="px-5 py-2 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">양식</span>
        <select className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-200">
          <option>대출기본발주서</option>
          <option>긴급발주서</option>
          <option>수리부품 발주서</option>
        </select>
      </div>

      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-5 py-3">
        <div className="grid grid-cols-4 gap-x-4 gap-y-2">
          <FormField label="일자" required>
            <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} className={inputCls} />
          </FormField>
          <FormField label="거래처" required>
            <VendorInlineSearch value={vendorName} onChange={setVendorName} vendors={vendors} />
          </FormField>
          <FormField label="신청자">
            <input type="text" value={managerName} onChange={e => setManagerName(e.target.value)} className={inputCls} />
          </FormField>
          <FormField label="현장">
            <SiteInlineSearch value={siteName} onChange={setSiteName} sites={sites} />
          </FormField>
          <FormField label="호기">
            {elevators.length > 0 ? (
              <ElevatorPicker value={topElevatorName} elevators={elevators}
                onChange={setTopElevatorName} inline={false} />
            ) : (
              <input type="text" value={topElevatorName} onChange={e => setTopElevatorName(e.target.value)} className={inputCls} />
            )}
          </FormField>
          <FormField label="참조" wide>
            <div className="flex items-center gap-2">
              <input type="text" value={reference} onChange={e => setReference(e.target.value)} className={`${inputCls} flex-1`} />
              <MatTypeToggle value={matType} onChange={setMatType} />
            </div>
          </FormField>
          <FormField label="주문참조번호" wide>
            <input type="text" value={orderRefNo} onChange={e => setOrderRefNo(e.target.value)} className={inputCls} />
          </FormField>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">첨부파일</label>
          <label className="flex items-center justify-center gap-2 w-full border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-lg py-3 text-xs text-gray-400 dark:text-gray-500 hover:border-blue-300 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 cursor-pointer transition-colors">
            <span className="text-base">+</span>
            <span>{files.length === 0 ? "파일을 추가하려면 클릭하거나 드래그하세요" : `${files.length}개 파일`}</span>
            <input type="file" multiple className="hidden" onChange={e => setFiles(Array.from(e.target.files ?? []))} />
          </label>
        </div>
      </div>

      <div className="bg-[#f0f2f5] dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 px-5 py-2 flex items-center gap-2 flex-wrap text-xs shrink-0">
        <button type="button" onClick={() => setPopup("request")}
          className="px-4 py-1.5 rounded-md bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-sm transition-colors flex items-center gap-1.5 text-xs ring-2 ring-blue-600 ring-offset-1 dark:ring-offset-gray-700">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
          자재신청 참조 (불러오기)
        </button>
        <span className="ml-auto text-gray-500 dark:text-gray-400">{rows.filter(r => r.materialId).length} / {rows.length} 행</span>
      </div>

      <div className="flex-1 overflow-auto bg-white dark:bg-gray-800">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#e9ecef] dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              <Th w="32">No</Th>
              <Th w="120">품목코드</Th>
              <Th w="220">품목명</Th>
              <Th w="120">규격</Th>
              <Th w="80">수량</Th>
              <Th w="100">단가</Th>
              <Th w="110">공급가액</Th>
              <Th w="90">부가세</Th>
              <Th w="100">호기</Th>
              <Th w="160">적요</Th>
              <Th w="40"></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-blue-50/30 dark:hover:bg-blue-900/10">
                <Td center className="text-gray-800 dark:text-gray-200 font-medium">{i + 1}</Td>
                <Td>
                  <MatInlineSearch
                    value={r.materialId}
                    matType={matType}
                    onMultiSelect={materials => applyMultipleMaterials(r.id, materials)}
                    onChange={v => patchRow(r.id, { materialId: v })}
                  />
                </Td>
                <Td>
                  <MatInlineSearch value={r.materialName} matType={matType}
                    onMultiSelect={materials => applyMultipleMaterials(r.id, materials)}
                    onChange={v => patchRow(r.id, { materialName: v })} />
                </Td>
                <Td>
                  <MatInlineSearch
                    value={r.spec}
                    matType={matType}
                    onMultiSelect={materials => applyMultipleMaterials(r.id, materials)}
                    onChange={v => patchRow(r.id, { spec: v })}
                  />
                </Td>
                <Td right>
                  <input type="text" inputMode="numeric" value={r.qty === 0 ? "" : String(r.qty)}
                    onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ""); patchRow(r.id, { qty: v === "" ? 0 : Number(v) }); }}
                    className={cellInput + " text-right"} />
                </Td>
                <Td right>
                  <input type="text" inputMode="numeric" value={r.unitPrice === 0 ? "" : String(r.unitPrice)}
                    onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ""); patchRow(r.id, { unitPrice: v === "" ? 0 : Number(v) }); }}
                    className={cellInput + " text-right"} />
                </Td>
                <Td right className="text-gray-700 dark:text-gray-300 tabular-nums">{fmtNum(r.qty * r.unitPrice)}</Td>
                <Td right className="text-gray-600 dark:text-gray-400 tabular-nums">{fmtNum(r.vat)}</Td>
                <Td>
                  {elevators.length > 0 ? (
                    <ElevatorPicker value={r.elevatorName} elevators={elevators}
                      onChange={v => patchRow(r.id, { elevatorName: v })} />
                  ) : (
                    <input type="text" value={r.elevatorName} onChange={e => patchRow(r.id, { elevatorName: e.target.value })} className={cellInput} />
                  )}
                </Td>
                <Td>
                  <input type="text" value={r.remark} onChange={e => patchRow(r.id, { remark: e.target.value })} className={cellInput} />
                </Td>
                <Td center>
                  <button type="button" onClick={() => removeRow(r.id)} className="text-gray-300 hover:text-red-400 leading-none">×</button>
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0">
            <tr className="bg-[#e9ecef] dark:bg-gray-700 font-semibold border-t-2 border-gray-300 dark:border-gray-600">
              <Td colSpan={4} center className="text-gray-600 dark:text-gray-400">합 계</Td>
              <Td right className="tabular-nums dark:text-gray-300">{fmtNum(totals.qty)}</Td>
              <Td></Td>
              <Td right className="tabular-nums dark:text-gray-300">{fmtNum(totals.supply)}</Td>
              <Td right className="tabular-nums dark:text-gray-300">{fmtNum(totals.vat)}</Td>
              <Td colSpan={3} right className="tabular-nums text-blue-700">총액 {fmtNum(totals.total)}</Td>
            </tr>
          </tfoot>
        </table>
        <div className="px-5 py-2">
          <button type="button" onClick={addRow} className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600">+ 행 추가</button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-5 py-3 flex items-center justify-end gap-2">
        <button type="button" onClick={() => router.push("/purchase-orders")} className="text-xs px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">리스트</button>
        <button type="button" onClick={clearAll} className="text-xs px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">다시 작성</button>
        <button type="button" className="text-xs px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">웹자료올리기</button>
        <button type="button" disabled={saving} onClick={() => save(true)} className="text-xs px-4 py-2 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50">
          저장/전표 <kbd className="text-[10px] text-blue-400">F7</kbd>
        </button>
        <button type="button" disabled={saving} onClick={() => save(false)} className="text-xs px-5 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 shadow-sm">
          {saving ? "저장 중..." : <>저장 <kbd className="text-[10px] text-blue-200">F8</kbd></>}
        </button>
      </div>

      {popup === "request" && (
        <RequestPopup requests={pendingRequests} onClose={() => setPopup(null)} onSelect={applyRequest} />
      )}
    </div>
  );
}

// ── 공통 헬퍼 ──────────────────────────────────────────────────
const inputCls = "w-full px-2 py-1 text-xs font-medium text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:font-normal";
const cellInput = "w-full px-1.5 py-1 text-xs font-medium text-gray-900 dark:text-gray-100 border-0 bg-white dark:bg-gray-800 focus:outline-none focus:bg-yellow-50 dark:focus:bg-yellow-900/20 focus:ring-1 focus:ring-blue-300 placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:font-normal";

function FormField({ label, required, wide, children }: { label: string; required?: boolean; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-2 ${wide ? "col-span-2" : ""}`}>
      <label className="text-xs font-medium text-gray-800 dark:text-gray-200 shrink-0 w-20 text-right">
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
function SiteInlineSearch({ value, onChange, sites }: { value: string; onChange: (v: string) => void; sites: { id: number; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const ulRef = useRef<HTMLUListElement>(null);
  const suggestions = value.trim() ? sites.filter(s => s.name.toLowerCase().includes(value.toLowerCase())).slice(0, 10) : [];

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
      <input type="text" lang="ko" value={value} onChange={e => { onChange(e.target.value); setOpen(true); }} onFocus={() => value.trim() && setOpen(true)} onKeyDown={handleKeyDown} className={inputCls} />
      {open && suggestions.length > 0 && (
        <ul ref={ulRef} className="absolute z-50 top-full left-0 mt-0.5 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-52 overflow-y-auto">
          {suggestions.map((s, idx) => (
            <li key={s.id}>
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onChange(s.name); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs text-gray-800 dark:text-gray-200 border-b border-gray-50 dark:border-gray-700 last:border-0 ${focusedIndex === idx ? "bg-blue-100 dark:bg-blue-900/50" : "hover:bg-blue-50 dark:hover:bg-blue-900/20"}`}>
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VendorInlineSearch({ value, onChange, vendors }: { value: string; onChange: (v: string) => void; vendors: { id: number; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const ulRef = useRef<HTMLUListElement>(null);
  const suggestions = value.trim() ? vendors.filter(v => v.name.toLowerCase().includes(value.toLowerCase())).slice(0, 10) : [];

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
      <input type="text" lang="ko" value={value} onChange={e => { onChange(e.target.value); setOpen(true); }} onFocus={() => value.trim() && setOpen(true)} onKeyDown={handleKeyDown} className={inputCls} />
      {open && suggestions.length > 0 && (
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

function MatInlineSearch({ value, matType, onMultiSelect, onChange }: {
  value: string; matType: "전체" | "DS" | "TK";
  onMultiSelect: (materials: MaterialRecord[]) => void; onChange: (v: string) => void;
}) {
  const [results, setResults] = useState<MaterialRecord[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
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
        setResults(data.slice(0, 15));
        setOpen(data.length > 0);
        setFocusedIndex(-1);
      } catch { setResults([]); setOpen(false); }
    }, value.trim() ? 150 : 0);
    return () => clearTimeout(t);
  }, [value, matType]);

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
      else if (focusedIndex >= 0) { onMultiSelect([results[focusedIndex]]); setChecked(new Set()); setOpen(false); }
    }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <input type="text" lang="ko" value={value} onChange={e => { onChange(e.target.value); setChecked(new Set()); }} onFocus={() => results.length > 0 && setOpen(true)} onKeyDown={handleKeyDown} className={cellInput} />
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl">
          <ul ref={ulRef} className="max-h-52 overflow-y-auto">
            {results.map((m, idx) => (
              <li key={m.id}>
                <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => toggle(m.id)}
                  className={`w-full text-left px-3 py-2 border-b border-gray-50 dark:border-gray-700 last:border-0 flex items-center gap-2 ${checked.has(m.id) ? "bg-blue-50 dark:bg-blue-900/30" : focusedIndex === idx ? "bg-blue-100 dark:bg-blue-900/50" : "hover:bg-gray-50 dark:hover:bg-gray-700"}`}>
                  <input type="checkbox" readOnly checked={checked.has(m.id)} className="accent-blue-600 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-800 dark:text-gray-200">{m.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{m.id}</span>
                      {m.modelNo && <span className="text-[10px] text-gray-500 dark:text-gray-400 border-l border-gray-300 dark:border-gray-600 pl-2">{m.modelNo}</span>}
                      {m.alias && <span className="text-[10px] text-gray-400 dark:text-gray-500">{m.alias}</span>}
                      <span className="text-[10px] text-gray-300 dark:text-gray-500 ml-auto">재고 {m.stockQty}</span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[720px] max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-semibold dark:text-gray-100">자재신청 불러오기</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">×</button>
        </div>
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
      </div>
    </div>
  );
}
