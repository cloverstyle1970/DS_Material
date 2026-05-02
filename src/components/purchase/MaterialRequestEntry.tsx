"use client";

import { useState, useMemo, useEffect, useRef, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { MaterialRecord } from "@/lib/mock-materials";
import { ElevatorRecord } from "@/lib/mock-elevators";
import { api, getErrorMessage } from "@/lib/api-client";

interface SiteOption { id: number; name: string }

interface Row {
  id: string;
  materialId: string;
  materialName: string;
  spec: string;
  qty: number;
  elevatorName: string;
  remark: string;
}

function newRow(seed: Partial<Row> = {}): Row {
  return { id: crypto.randomUUID(), materialId: "", materialName: "", spec: "", qty: 0, elevatorName: "", remark: "", ...seed };
}

function todayISO() { return new Date().toISOString().slice(0, 10); }
function fmtNum(n: number) { return n.toLocaleString(); }

export default function MaterialRequestEntry() {
  const router = useRouter();
  const { user } = useAuth();

  const [reqDate,     setReqDate]     = useState(todayISO());
  const [siteName,    setSiteName]    = useState("");
  const [elevators,   setElevators]   = useState<ElevatorRecord[]>([]);
  const [sites,       setSites]       = useState<SiteOption[]>([]);
  const [reference,   setReference]   = useState("");
  const [matType,     setMatType]     = useState<"전체" | "DS" | "TK">("전체");

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      setMatType(user.name === "황진한" ? "DS" : user.name === "박은숙" ? "TK" : "전체");
    }, 0);
    return () => clearTimeout(t);
  }, [user]);
  const [rows, setRows] = useState<Row[]>([newRow(), newRow(), newRow(), newRow(), newRow()]);
  const [saving, setSaving] = useState(false);
  const [popup, setPopup] = useState<null | "material">(null);
  const [popupRow, setPopupRow] = useState<string | null>(null);

  useEffect(() => {
    api.get<SiteOption[]>("/api/sites").then(setSites).catch(() => {});
  }, []);

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
    setRows(prev => prev.length <= 1 ? [newRow()] : prev.filter(r => r.id !== id));
  }
  function clearAll() {
    setRows([newRow(), newRow(), newRow(), newRow(), newRow()]);
    setSiteName(""); setReference("");
  }

  function applyMaterial(rowId: string, m: MaterialRecord) {
    patchRow(rowId, { materialId: m.id, materialName: m.name, spec: m.modelNo ?? "", qty: 1 });
    setPopup(null); setPopupRow(null);
  }

  function applyMultipleMaterials(startRowId: string, materials: MaterialRecord[]) {
    setRows(prev => {
      const next = [...prev];
      const startIdx = next.findIndex(r => r.id === startRowId);
      materials.forEach((m, i) => {
        const idx = startIdx + i;
        const patch = { materialId: m.id, materialName: m.name, spec: m.modelNo ?? "", qty: 1 };
        if (idx < next.length) {
          next[idx] = { ...next[idx], ...patch };
        } else {
          next.push(newRow(patch));
        }
      });
      return next;
    });
  }

  const totals = useMemo(() => {
    const valid = rows.filter(r => r.materialId);
    return { rows: valid.length, qty: valid.reduce((s, r) => s + r.qty, 0) };
  }, [rows]);

  async function save(goList: boolean) {
    if (!user) return;
    const valid = rows.filter(r => r.materialId && r.qty > 0);
    if (valid.length === 0) { alert("품목을 1개 이상 입력해 주세요."); return; }
    setSaving(true);
    try {
      await api.post("/api/material-requests", {
        siteName: siteName || null,
        items: valid.map(r => ({
          materialId: r.materialId,
          materialName: r.materialName,
          qty: r.qty,
          elevatorName: r.elevatorName || null,
        })),
        note: reference || null,
        requesterId: user.id,
        requesterName: user.name,
        requesterDept: user.dept,
      });
      if (goList) router.push("/requests");
      else clearAll();
    } catch (e) { alert(getErrorMessage(e)); }
    finally { setSaving(false); }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === "F8") { e.preventDefault(); save(false); }
    else if (e.key === "F7") { e.preventDefault(); save(true); }
    else if (e.key === "F3") { e.preventDefault(); setPopup("material"); setPopupRow(rows[0]?.id ?? null); }
  }

  return (
    <div onKeyDown={handleKey} tabIndex={-1} className="flex flex-col h-full bg-[#f5f6fa] dark:bg-gray-900 outline-none">

      {/* 타이틀 */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h1 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <span className="text-slate-500">📋</span> 자재신청입력
        </h1>
        <div className="flex items-center gap-2">
        </div>
      </div>

      {/* 헤더 폼 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-5 py-3">
        <div className="grid grid-cols-4 gap-x-4 gap-y-2">
          <FormField label="일자" required>
            <input type="date" value={reqDate} onChange={e => setReqDate(e.target.value)} className={inputCls} />
          </FormField>
          <FormField label="현장" required>
            <SiteInlineSearch value={siteName} onChange={setSiteName} sites={sites} />
          </FormField>
          <FormField label="신청자">
            <input type="text" value={user?.name ?? ""} readOnly className={inputCls + " bg-gray-50 text-gray-600"} />
          </FormField>
          <FormField label="부서">
            <input type="text" value={user?.dept ?? ""} readOnly className={inputCls + " bg-gray-50 text-gray-600"} />
          </FormField>
          <FormField label="참조" wide>
            <div className="flex items-center gap-2">
              <input type="text" value={reference} onChange={e => setReference(e.target.value)} className={`${inputCls} flex-1`} />
              <div className="flex rounded overflow-hidden border border-gray-300 dark:border-gray-600 shrink-0">
                {(["전체", "DS", "TK"] as const).map(t => (
                  <button key={t} type="button" onClick={() => setMatType(t)}
                    className={`px-2.5 py-1 text-xs font-semibold transition-colors ${
                      matType === t
                        ? t === "DS" ? "bg-red-500 text-white"
                          : t === "TK" ? "bg-blue-600 text-white"
                          : "bg-slate-600 text-white"
                        : "bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600"
                    }`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </FormField>
        </div>
      </div>

      {/* 그리드 툴바 */}
      <div className="bg-[#f0f2f5] dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 px-5 py-1.5 flex items-center gap-1 flex-wrap text-xs">
        <span className="ml-auto text-gray-500 dark:text-gray-400">{totals.rows}품목 / 총 {fmtNum(totals.qty)}개</span>
      </div>

      {/* 그리드 */}
      <div className="flex-1 overflow-auto bg-white dark:bg-gray-800">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#e9ecef] dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              <Th w="32">No</Th>
              <Th w="120">품목코드</Th>
              <Th w="240">품목명</Th>
              <Th w="140">규격</Th>
              <Th w="80">수량</Th>
              <Th w="130">호기</Th>
              <Th>적요</Th>
              <Th w="36"></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-blue-50/30 dark:hover:bg-blue-900/10">
                <Td center className="text-gray-800 dark:text-gray-200 font-medium">{i + 1}</Td>
                <Td>
                  <input type="text" value={r.materialId} readOnly
                    className={cellInput + " bg-gray-50 dark:bg-gray-700 text-gray-400 dark:text-gray-500"} />
                </Td>
                <Td>
                  <MatInlineSearch
                    value={r.materialName}
                    matType={matType}
                    onMultiSelect={materials => applyMultipleMaterials(r.id, materials)}
                    onChange={v => patchRow(r.id, { materialName: v })}
                  />
                </Td>
                <Td>
                  <input type="text" value={r.spec}
                    onChange={e => patchRow(r.id, { spec: e.target.value })}
                    className={cellInput} />
                </Td>
                <Td right>
                  <input type="text" inputMode="numeric" value={r.qty === 0 ? "" : String(r.qty)}
                    onChange={e => {
                      const v = e.target.value.replace(/[^0-9]/g, "");
                      patchRow(r.id, { qty: v === "" ? 0 : Number(v) });
                    }}
                    className={cellInput + " text-right"} />
                </Td>
                <Td>
                  {elevators.length > 0 ? (
                    <select value={r.elevatorName} onChange={e => patchRow(r.id, { elevatorName: e.target.value })}
                      className={cellInput}>
                      <option value=""></option>
                      {elevators.map(e => <option key={e.id} value={e.unitName ?? ""}>{e.unitName}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={r.elevatorName}
                      onChange={e => patchRow(r.id, { elevatorName: e.target.value })}
                      className={cellInput} />
                  )}
                </Td>
                <Td>
                  <input type="text" value={r.remark}
                    onChange={e => patchRow(r.id, { remark: e.target.value })}
                    className={cellInput} />
                </Td>
                <Td center>
                  <button type="button" onClick={() => removeRow(r.id)}
                    className="text-gray-300 hover:text-red-400 leading-none">×</button>
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0">
            <tr className="bg-[#e9ecef] dark:bg-gray-700 font-semibold border-t-2 border-gray-300 dark:border-gray-600">
              <Td colSpan={4} center className="text-gray-600 dark:text-gray-400">합 계</Td>
              <Td right className="tabular-nums dark:text-gray-300">{fmtNum(totals.qty)}</Td>
              <Td colSpan={3} right className="tabular-nums text-blue-700">
                총 {totals.rows}품목
              </Td>
            </tr>
          </tfoot>
        </table>
        <div className="px-5 py-2">
          <button type="button" onClick={addRow} className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600">+ 행 추가</button>
        </div>
      </div>

      {/* 하단 액션 */}
      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-5 py-3 flex items-center justify-end gap-2">
        <button type="button" onClick={() => router.push("/requests")}
          className="text-xs px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">리스트</button>
        <button type="button" onClick={clearAll}
          className="text-xs px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">다시 작성</button>
        <button type="button" disabled={saving} onClick={() => save(true)}
          className="text-xs px-4 py-2 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50">
          저장/전표 <kbd className="text-[10px] text-blue-400">F7</kbd>
        </button>
        <button type="button" disabled={saving} onClick={() => save(false)}
          className="text-xs px-5 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 shadow-sm">
          {saving ? "저장 중..." : <>저장 <kbd className="text-[10px] text-blue-200">F8</kbd></>}
        </button>
      </div>

      {popup === "material" && popupRow && (
        <MaterialPopup onClose={() => setPopup(null)} onSelect={m => applyMaterial(popupRow, m)} />
      )}
    </div>
  );
}

// ── 공통 헬퍼 ──────────────────────────────────────────────────
const inputCls = "w-full px-2 py-1 text-xs font-medium text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:font-normal";
const cellInput = "w-full px-1.5 py-1 text-xs font-medium text-gray-900 dark:text-gray-100 border-0 bg-white dark:bg-gray-800 focus:outline-none focus:bg-yellow-50 dark:focus:bg-yellow-900/20 focus:ring-1 focus:ring-blue-300 placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:font-normal";

// ── 품목명 인라인 자동완성 (다중선택) ─────────────────────────
function MatInlineSearch({ value, matType, onMultiSelect, onChange }: {
  value: string;
  matType: "전체" | "DS" | "TK";
  onMultiSelect: (materials: MaterialRecord[]) => void;
  onChange: (v: string) => void;
}) {
  const [results, setResults]   = useState<MaterialRecord[]>([]);
  const [checked, setChecked]   = useState<Set<string>>(new Set());
  const [open, setOpen]         = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!value.trim()) { setResults([]); setOpen(false); return; }
      const params = new URLSearchParams({ q: value });
      if (matType !== "전체") params.set("matType", matType);
      try {
        const data = await api.get<MaterialRecord[]>(`/api/materials?${params}`);
        setResults(data.slice(0, 15));
        setOpen(data.length > 0);
      } catch { setResults([]); setOpen(false); }
    }, value.trim() ? 150 : 0);
    return () => clearTimeout(t);
  }, [value, matType]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setChecked(new Set());
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function applyChecked() {
    const selected = results.filter(m => checked.has(m.id));
    if (selected.length === 0) return;
    onMultiSelect(selected);
    setChecked(new Set());
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setChecked(new Set()); }}
        onFocus={() => results.length > 0 && setOpen(true)}
        className={cellInput}
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl">
          <ul className="max-h-52 overflow-y-auto">
            {results.map(m => (
              <li key={m.id}>
                <button
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => toggle(m.id)}
                  className={`w-full text-left px-3 py-2 transition-colors border-b border-gray-50 dark:border-gray-700 last:border-0 flex items-center gap-2 ${
                    checked.has(m.id) ? "bg-blue-50 dark:bg-blue-900/30" : "hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={checked.has(m.id)}
                    className="accent-blue-600 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-800 dark:text-gray-200">{m.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{m.id}</span>
                      {m.alias && <span className="text-[10px] text-gray-400 dark:text-gray-500">{m.alias}</span>}
                      <span className="text-[10px] text-gray-300 dark:text-gray-500 ml-auto">재고 {m.stockQty}</span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {/* 다중선택 적용 버튼 */}
          <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-b-lg">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {checked.size > 0 ? `${checked.size}개 선택됨` : "항목을 클릭하여 선택"}
            </span>
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={applyChecked}
              disabled={checked.size === 0}
              className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {checked.size > 0 ? `${checked.size}개 추가` : "추가"}
            </button>
          </div>
        </div>
      )}
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

function SiteInlineSearch({ value, onChange, sites }: {
  value: string;
  onChange: (v: string) => void;
  sites: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const suggestions = value.trim()
    ? sites.filter(s => s.name.toLowerCase().includes(value.toLowerCase())).slice(0, 10)
    : [];

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <input type="text" value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => value.trim() && setOpen(true)}
        className={inputCls} />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 top-full left-0 mt-0.5 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-52 overflow-y-auto">
          {suggestions.map(s => (
            <li key={s.id}>
              <button type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(s.name); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs text-gray-800 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors border-b border-gray-50 dark:border-gray-700 last:border-0">
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
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
    <td colSpan={colSpan}
      className={`px-1 py-0.5 border border-gray-200 dark:border-gray-700 ${right ? "text-right" : center ? "text-center" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}

function MaterialPopup({ onSelect, onClose }: { onSelect: (m: MaterialRecord) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MaterialRecord[]>([]);
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) { setResults([]); return; }
      try {
        const data = await api.get<MaterialRecord[]>(`/api/materials?q=${encodeURIComponent(q)}`);
        setResults(data.slice(0, 50));
      } catch { setResults([]); }
    }, q.trim() ? 200 : 0);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[640px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-semibold dark:text-gray-100">품목 검색</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">×</button>
        </div>
        <div className="p-3">
          <input type="text" value={q} onChange={e => setQ(e.target.value)} autoFocus
            placeholder="품목코드, 품목명, 별칭"
            className="w-full px-3 py-2 text-sm font-medium text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-500 placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:font-normal" />
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
              <tr>
                {["코드","품목명","규격","재고"].map(h => (
                  <th key={h} className="px-2 py-1.5 text-left border-b border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map(m => (
                <tr key={m.id} onClick={() => onSelect(m)} className="hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer border-b border-gray-50 dark:border-gray-700">
                  <td className="px-2 py-1.5 font-mono text-slate-500 dark:text-slate-400">{m.id}</td>
                  <td className="px-2 py-1.5 dark:text-gray-200">{m.name}</td>
                  <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300">{m.modelNo ?? "-"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums dark:text-gray-300">{m.stockQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.length === 0 && q && <p className="text-center py-8 text-xs text-gray-400 dark:text-gray-500">검색 결과 없음</p>}
          {!q && <p className="text-center py-8 text-xs text-gray-400 dark:text-gray-500">검색어를 입력하세요</p>}
        </div>
      </div>
    </div>
  );
}
