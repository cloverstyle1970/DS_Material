"use client";

import { useState, useMemo, useEffect, useRef, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { MaterialRecord } from "@/lib/mock-materials";
import { ElevatorRecord } from "@/lib/mock-elevators";
import { TransactionRecord } from "@/lib/mock-transactions";
import { api, getErrorMessage } from "@/lib/api-client";
import SerialEntryModal from "./SerialEntryModal";

interface SiteOption { id: number; name: string }

interface Row {
  id: string;
  materialId: string;
  materialName: string;
  spec: string;
  qty: number;
  elevatorName: string;
  requiresReturn: boolean;
  remark: string;
  inboundRef: number | null;
  serialNos: string[];
}

function newRow(seed: Partial<Row> = {}): Row {
  return { id: crypto.randomUUID(), materialId: "", materialName: "", spec: "", qty: 0, elevatorName: "", requiresReturn: false, remark: "", inboundRef: null, serialNos: [], ...seed };
}

function todayISO() { return new Date().toISOString().slice(0, 10); }
function fmtNum(n: number) { return n.toLocaleString(); }

export default function OutboundEntry() {
  const router   = useRouter();
  const { user } = useAuth();

  const [outboundDate, setOutboundDate] = useState(todayISO());
  const [siteName,     setSiteName]     = useState("");
  const [elevators,    setElevators]    = useState<ElevatorRecord[]>([]);
  const [sites,        setSites]        = useState<SiteOption[]>([]);
  const [reference,    setReference]    = useState("");
  const [matType,      setMatType]      = useState<"전체" | "DS" | "TK">("전체");

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      setMatType(user.name === "황진한" ? "DS" : user.name === "박은숙" ? "TK" : "전체");
    }, 0);
    return () => clearTimeout(t);
  }, [user]);

  useEffect(() => {
    api.get<SiteOption[]>("/api/sites").then(setSites).catch(() => {});
  }, []);

  const [rows,  setRows]  = useState<Row[]>([newRow(), newRow(), newRow(), newRow(), newRow()]);
  const [saving, setSaving] = useState(false);
  const [popup,  setPopup]  = useState<null | "inbound">(null);
  const [serialEditRowId, setSerialEditRowId] = useState<string | null>(null);

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
      if (patch.serialNos !== undefined && patch.serialNos.length > next.qty) {
        next.qty = patch.serialNos.length;
      }
      if (patch.qty !== undefined && patch.qty < next.serialNos.length) {
        next.qty = next.serialNos.length;
      }
      return next;
    }));
  }
  function addRow() { setRows(prev => [...prev, newRow()]); }
  function removeRow(id: string) {
    setRows(prev => prev.length <= 1 ? [newRow()] : prev.filter(r => r.id !== id));
  }
  function clearAll() {
    setRows([newRow(), newRow(), newRow(), newRow(), newRow()]);
    setSiteName(""); setReference("");
  }

  function applyMultipleMaterials(startRowId: string, materials: MaterialRecord[]) {
    setRows(prev => {
      const next = [...prev];
      const startIdx = next.findIndex(r => r.id === startRowId);
      materials.forEach((m, i) => {
        const idx = startIdx + i;
        const patch = {
          materialId: m.id, materialName: m.name, spec: m.modelNo ?? "",
          qty: 1,
          serialNos: [] as string[],
        };
        if (idx < next.length) next[idx] = { ...next[idx], ...patch };
        else next.push(newRow(patch));
      });
      return next;
    });
  }

  function applyInbound(t: TransactionRecord) {
    const row = newRow({
      materialId: t.materialId, materialName: t.materialName,
      qty: t.qty, inboundRef: t.id, remark: `입고#${t.id} 참조`,
    });
    if (t.siteName && !siteName) setSiteName(t.siteName);
    setRows(prev => {
      const firstEmpty = prev.findIndex(r => !r.materialId);
      if (firstEmpty >= 0) { const next = [...prev]; next[firstEmpty] = row; return next; }
      return [...prev, row];
    });
    setPopup(null);
  }

  const totals = useMemo(() => {
    const valid = rows.filter(r => r.materialId);
    return { rows: valid.length, qty: valid.reduce((s, r) => s + r.qty, 0) };
  }, [rows]);

  async function save(goList: boolean) {
    if (!user) return;
    const valid = rows.filter(r => r.materialId && r.qty > 0);
    if (valid.length === 0) { alert("품목을 1개 이상 입력해 주세요."); return; }
    const overflow = valid.find(r => r.serialNos.length > r.qty);
    if (overflow) {
      alert(`${overflow.materialName}: S/N 갯수(${overflow.serialNos.length})가 수량(${overflow.qty})보다 많습니다.`);
      return;
    }
    setSaving(true);
    try {
      for (const r of valid) {
        await api.post("/api/transactions", {
          type: "출고", materialId: r.materialId, materialName: r.materialName,
          qty: r.qty, siteName: siteName || null,
          elevatorName: r.elevatorName || null,
          serialNos: r.serialNos.length > 0 ? r.serialNos : null,
          requiresReturn: r.requiresReturn,
          note: r.remark || reference || null, userId: user.id, userName: user.name,
        });
      }
      if (goList) router.push("/outbound");
      else clearAll();
    } catch (e) {
      alert(getErrorMessage(e));
    } finally { setSaving(false); }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === "F8") { e.preventDefault(); save(false); }
    else if (e.key === "F7") { e.preventDefault(); save(true); }
  }

  return (
    <div onKeyDown={handleKey} tabIndex={-1} className="flex flex-col h-full bg-[#f5f6fa] dark:bg-gray-900 outline-none">

      <div className="flex items-center justify-between px-5 py-2.5 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h1 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <span className="text-orange-400">▲</span> 불출등록입력
        </h1>
      </div>

      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-5 py-3 shrink-0">
        <div className="grid grid-cols-4 gap-x-4 gap-y-2">
          <FormField label="일자" required>
            <input type="date" value={outboundDate} onChange={e => setOutboundDate(e.target.value)} className={inputCls} />
          </FormField>
          <FormField label="현장" required>
            <SiteInlineSearch value={siteName} onChange={setSiteName} sites={sites} />
          </FormField>
          <FormField label="담당자">
            <input type="text" value={user?.name ?? ""} readOnly className={inputCls + " bg-gray-50 text-gray-600"} />
          </FormField>
          <FormField label="부서">
            <input type="text" value={user?.dept ?? ""} readOnly className={inputCls + " bg-gray-50 text-gray-600"} />
          </FormField>
          <FormField label="참조" wide>
            <div className="flex items-center gap-2">
              <input type="text" value={reference} onChange={e => setReference(e.target.value)} className={`${inputCls} flex-1`} />
              <MatTypeToggle value={matType} onChange={setMatType} />
            </div>
          </FormField>
        </div>
      </div>

      <div className="bg-[#f0f2f5] dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 px-5 py-1.5 flex items-center gap-1 flex-wrap text-xs shrink-0">
        <ToolBtn onClick={() => setPopup("inbound")}>입고내역 참조</ToolBtn>
        <span className="ml-auto text-gray-500 dark:text-gray-400">{totals.rows}품목 / 총 {fmtNum(totals.qty)}개</span>
      </div>

      <div className="flex-1 overflow-auto bg-white dark:bg-gray-800">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#e9ecef] dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              <Th w="32">No</Th>
              <Th w="120">품목코드</Th>
              <Th w="220">품목명</Th>
              <Th w="130">규격</Th>
              <Th w="70">수량</Th>
              <Th w="120">호기</Th>
              <Th w="120">S/N</Th>
              <Th w="50">회수</Th>
              <Th>적요</Th>
              <Th w="36"></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-orange-50/20 dark:hover:bg-orange-900/10">
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
                  <MatInlineSearch
                    value={r.materialName} matType={matType}
                    onMultiSelect={materials => applyMultipleMaterials(r.id, materials)}
                    onChange={v => patchRow(r.id, { materialName: v })}
                  />
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
                    title={r.serialNos.length > 0 ? `S/N ${r.serialNos.length}건 선택됨 — 수량은 ${r.serialNos.length} 이상이어야 함` : undefined}
                    className={cellInput + " text-right"} />
                </Td>
                <Td>
                  {elevators.length > 0 ? (
                    <select value={r.elevatorName} onChange={e => patchRow(r.id, { elevatorName: e.target.value })} className={cellInput}>
                      <option value=""></option>
                      {elevators.map(e => <option key={e.id} value={e.unitName ?? ""}>{e.unitName}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={r.elevatorName} onChange={e => patchRow(r.id, { elevatorName: e.target.value })} className={cellInput} />
                  )}
                </Td>
                <Td>
                  {r.materialId ? (
                    <button type="button" onClick={() => setSerialEditRowId(r.id)}
                      title={r.serialNos.length > 0 && r.serialNos.length < r.qty ? `${r.serialNos.length}건 추적 + ${r.qty - r.serialNos.length}건 비추적` : undefined}
                      className={`w-full text-xs px-2 py-1 rounded border font-medium transition-colors ${r.serialNos.length === 0 ? "border-gray-300 text-gray-500 bg-white hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:bg-gray-700 dark:hover:bg-gray-600" : r.serialNos.length === r.qty ? "border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:bg-blue-900/30" : "border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:bg-amber-900/30"}`}>
                      {r.serialNos.length === 0
                        ? "S/N (선택) ▾"
                        : r.serialNos.length === r.qty
                          ? `S/N ${r.serialNos.length}건 ▾`
                          : `S/N ${r.serialNos.length}/${r.qty}건 ▾`}
                    </button>
                  ) : (
                    <span className="text-gray-300 dark:text-gray-600 text-xs px-2">—</span>
                  )}
                </Td>
                <Td center>
                  <input type="checkbox" checked={r.requiresReturn} onChange={e => patchRow(r.id, { requiresReturn: e.target.checked })}
                    className="w-4 h-4 accent-orange-500 cursor-pointer" />
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
              <Td colSpan={5} right className="tabular-nums text-orange-600">총 {totals.rows}품목</Td>
            </tr>
          </tfoot>
        </table>
        <div className="px-5 py-2">
          <button type="button" onClick={addRow} className="text-xs text-gray-500 dark:text-gray-400 hover:text-orange-500">+ 행 추가</button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-5 py-3 flex items-center justify-end gap-2 shrink-0">
        <button type="button" onClick={() => router.push("/outbound")}
          className="text-xs px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">리스트</button>
        <button type="button" onClick={clearAll}
          className="text-xs px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">다시 작성</button>
        <button type="button" disabled={saving} onClick={() => save(true)}
          className="text-xs px-4 py-2 rounded border border-orange-300 text-orange-600 hover:bg-orange-50 disabled:opacity-50">
          저장/전표 <kbd className="text-[10px] text-orange-400">F7</kbd>
        </button>
        <button type="button" disabled={saving} onClick={() => save(false)}
          className="text-xs px-5 py-2 rounded bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-50 shadow-sm">
          {saving ? "저장 중..." : <>저장 <kbd className="text-[10px] text-orange-200">F8</kbd></>}
        </button>
      </div>

      {popup === "inbound" && (
        <InboundRefPopup onClose={() => setPopup(null)} onSelect={applyInbound} />
      )}

      {serialEditRowId && (() => {
        const row = rows.find(r => r.id === serialEditRowId);
        if (!row) return null;
        return (
          <SerialEntryModal
            mode="outbound"
            materialId={row.materialId}
            materialName={row.materialName}
            initial={row.serialNos}
            onClose={() => setSerialEditRowId(null)}
            onSave={list => { patchRow(row.id, { serialNos: list }); setSerialEditRowId(null); }}
          />
        );
      })()}
    </div>
  );
}

// ── 공통 헬퍼 ──────────────────────────────────────────────────
const inputCls  = "w-full px-2 py-1 text-xs font-medium text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-200 placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:font-normal";
const cellInput = "w-full px-1.5 py-1 text-xs font-medium text-gray-900 dark:text-gray-100 border-0 bg-white dark:bg-gray-800 focus:outline-none focus:bg-yellow-50 dark:focus:bg-yellow-900/20 focus:ring-1 focus:ring-orange-300 placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:font-normal";

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

function FormField({ label, required, wide, children }: { label: string; required?: boolean; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-2 ${wide ? "col-span-2" : ""}`}>
      <label className="text-xs font-medium text-gray-800 dark:text-gray-200 shrink-0 w-16 text-right">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function ToolBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 hover:border-orange-300 transition-colors text-xs">
      {children}
    </button>
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
    <td colSpan={colSpan}
      className={`px-1 py-0.5 border border-gray-200 dark:border-gray-700 ${right ? "text-right" : center ? "text-center" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}

// ── 인라인 자동완성 ─────────────────────────────────────────────
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
      <input type="text" value={value} onChange={e => { onChange(e.target.value); setChecked(new Set()); }}
        onFocus={() => results.length > 0 && setOpen(true)} onKeyDown={handleKeyDown} className={cellInput} />
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl">
          <ul ref={ulRef} className="max-h-52 overflow-y-auto">
            {results.map((m, idx) => (
              <li key={m.id}>
                <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => toggle(m.id)}
                  className={`w-full text-left px-3 py-2 border-b border-gray-50 dark:border-gray-700 last:border-0 flex items-center gap-2 ${checked.has(m.id) ? "bg-orange-50 dark:bg-orange-900/30" : focusedIndex === idx ? "bg-orange-100 dark:bg-orange-900/50" : "hover:bg-gray-50 dark:hover:bg-gray-700"}`}>
                  <input type="checkbox" readOnly checked={checked.has(m.id)} className="accent-orange-500 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-800 dark:text-gray-200">{m.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{m.id}</span>
                      {m.modelNo && <span className="text-[10px] text-gray-500 dark:text-gray-400 border-l border-gray-300 dark:border-gray-600 pl-2">{m.modelNo}</span>}
                      {m.alias && <span className="text-[10px] text-gray-400 dark:text-gray-500">{m.alias}</span>}
                      <span className={`text-[10px] ml-auto font-semibold ${m.stockQty === 0 ? "text-red-400" : "text-gray-400 dark:text-gray-500"}`}>재고 {m.stockQty}</span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-b-lg">
            <span className="text-xs text-gray-500 dark:text-gray-400">{checked.size > 0 ? `${checked.size}개 선택됨` : "항목을 클릭하여 선택 (스페이스바로 체크)"}</span>
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={applyChecked} disabled={checked.size === 0}
              className="px-3 py-1 text-xs bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed">
              {checked.size > 0 ? `${checked.size}개 추가` : "엔터로 추가"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

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
      <input type="text" value={value} onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => value.trim() && setOpen(true)} onKeyDown={handleKeyDown} className={inputCls} />
      {open && suggestions.length > 0 && (
        <ul ref={ulRef} className="absolute z-50 top-full left-0 mt-0.5 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-52 overflow-y-auto">
          {suggestions.map((s, idx) => (
            <li key={s.id}>
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onChange(s.name); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs text-gray-800 dark:text-gray-200 border-b border-gray-50 dark:border-gray-700 last:border-0 ${focusedIndex === idx ? "bg-orange-100 dark:bg-orange-900/50" : "hover:bg-orange-50 dark:hover:bg-orange-900/20"}`}>
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── 입고내역 참조 팝업 ──────────────────────────────────────────
function InboundRefPopup({ onSelect, onClose }: { onSelect: (t: TransactionRecord) => void; onClose: () => void }) {
  const [records, setRecords] = useState<TransactionRecord[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    api.get<TransactionRecord[]>("/api/transactions?type=입고").then(data => setRecords(data.slice(0, 200))).catch(() => setRecords([]));
  }, []);
  const filtered = records.filter(t =>
    !q || t.materialName.toLowerCase().includes(q.toLowerCase()) ||
    t.materialId.toLowerCase().includes(q.toLowerCase()) ||
    (t.siteName?.toLowerCase().includes(q.toLowerCase()) ?? false)
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[700px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-semibold dark:text-gray-100">입고내역 참조 ({records.length}건)</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">×</button>
        </div>
        <div className="p-3">
          <input type="text" value={q} onChange={e => setQ(e.target.value)} autoFocus
            placeholder="자재명, 코드, 현장 검색"
            className="w-full px-3 py-2 text-sm font-medium text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:outline-none focus:border-orange-400 placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:font-normal" />
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
              <tr>{["입고일","자재명","코드","수량","현재재고","현장"].map(h =>
                <th key={h} className="px-2 py-1.5 text-left border-b border-gray-200 dark:border-gray-600 font-medium text-gray-700 dark:text-gray-300">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} onClick={() => onSelect(t)} className="hover:bg-orange-50 dark:hover:bg-orange-900/10 cursor-pointer border-b border-gray-50 dark:border-gray-700">
                  <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">{t.createdAt.slice(0, 10)}</td>
                  <td className="px-2 py-1.5 font-medium dark:text-gray-200">{t.materialName}</td>
                  <td className="px-2 py-1.5 font-mono text-slate-500 dark:text-slate-400">{t.materialId}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-blue-600">+{t.qty}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold dark:text-gray-300">{t.afterStock}</td>
                  <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">{t.siteName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="text-center py-8 text-xs text-gray-400 dark:text-gray-500">입고 내역 없음</p>}
        </div>
      </div>
    </div>
  );
}
