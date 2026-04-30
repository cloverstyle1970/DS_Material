"use client";

import { useState, useMemo, useEffect, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { MaterialRecord } from "@/lib/mock-materials";
import { ElevatorRecord } from "@/lib/mock-elevators";
import { TransactionRecord } from "@/lib/mock-transactions";

interface SiteOption { id: number; name: string }

interface Row {
  id: string;
  materialId: string;
  materialName: string;
  spec: string;
  qty: number;
  elevatorName: string;
  remark: string;
  inboundRef: number | null;
}

interface Props { sites: SiteOption[] }

function newRow(seed: Partial<Row> = {}): Row {
  return { id: crypto.randomUUID(), materialId: "", materialName: "", spec: "", qty: 0, elevatorName: "", remark: "", inboundRef: null, ...seed };
}

function todayISO() { return new Date().toISOString().slice(0, 10); }
function fmtNum(n: number) { return n.toLocaleString(); }

export default function OutboundEntry({ sites }: Props) {
  const router    = useRouter();
  const { user }  = useAuth();

  const [outboundDate, setOutboundDate] = useState(todayISO());
  const [siteName,     setSiteName]     = useState("");
  const [elevators,    setElevators]    = useState<ElevatorRecord[]>([]);
  const [reference,    setReference]    = useState("");
  const [rows, setRows] = useState<Row[]>([newRow(), newRow(), newRow(), newRow(), newRow()]);
  const [saving, setSaving] = useState(false);
  const [popup, setPopup]   = useState<null | "site" | "material" | "inbound">(null);
  const [popupRow, setPopupRow] = useState<string | null>(null);

  useEffect(() => {
    if (!siteName) { setElevators([]); return; }
    fetch(`/api/elevators?site=${encodeURIComponent(siteName)}`).then(r => r.json()).then(setElevators);
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

  function applyInbound(t: TransactionRecord) {
    const firstEmpty = rows.findIndex(r => !r.materialId);
    const row = newRow({
      materialId: t.materialId,
      materialName: t.materialName,
      qty: t.qty,
      inboundRef: t.id,
      remark: `입고#${t.id} 참조`,
    });
    if (t.siteName && !siteName) setSiteName(t.siteName);
    setRows(prev => {
      if (firstEmpty >= 0) {
        const next = [...prev];
        next[firstEmpty] = row;
        return next;
      }
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
    setSaving(true);
    try {
      const results = await Promise.all(valid.map(r =>
        fetch("/api/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "출고",
            materialId: r.materialId,
            materialName: r.materialName,
            qty: r.qty,
            siteName: siteName || null,
            note: r.remark || reference || null,
            userId: user.id,
            userName: user.name,
          }),
        }).then(r => r.json())
      ));
      const err = results.find(r => r.error);
      if (err) { alert(err.error); return; }
      if (goList) router.push("/outbound");
      else clearAll();
    } catch { alert("저장 중 오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === "F8") { e.preventDefault(); save(false); }
    else if (e.key === "F7") { e.preventDefault(); save(true); }
    else if (e.key === "F3") { e.preventDefault(); setPopup("material"); setPopupRow(rows[0]?.id ?? null); }
  }

  return (
    <div onKeyDown={handleKey} tabIndex={-1} className="flex flex-col h-full bg-[#f5f6fa] outline-none">

      {/* 타이틀 */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-white border-b border-gray-200 shrink-0">
        <h1 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <span className="text-orange-400">▲</span> 불출등록입력
        </h1>
        <div className="flex items-center gap-2">
          <button className="text-xs px-3 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">Option</button>
          <button className="text-xs px-3 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">도움말</button>
        </div>
      </div>

      {/* 헤더 폼 */}
      <div className="bg-white border-b border-gray-200 px-5 py-3 shrink-0">
        <div className="grid grid-cols-4 gap-x-4 gap-y-2">
          <FormField label="일자" required>
            <input type="date" value={outboundDate} onChange={e => setOutboundDate(e.target.value)} className={inputCls} />
          </FormField>
          <FormField label="현장" required>
            <SearchField value={siteName} onChange={setSiteName} onOpen={() => setPopup("site")} />
          </FormField>
          <FormField label="담당자">
            <input type="text" value={user?.name ?? ""} readOnly className={inputCls + " bg-gray-50 text-gray-600"} />
          </FormField>
          <FormField label="부서">
            <input type="text" value={user?.dept ?? ""} readOnly className={inputCls + " bg-gray-50 text-gray-600"} />
          </FormField>
          <FormField label="참조" wide>
            <input type="text" value={reference} onChange={e => setReference(e.target.value)} className={inputCls} />
          </FormField>
        </div>
      </div>

      {/* 그리드 툴바 */}
      <div className="bg-[#f0f2f5] border-b border-gray-200 px-5 py-1.5 flex items-center gap-1 flex-wrap text-xs shrink-0">
        <ToolBtn onClick={() => { setPopup("material"); setPopupRow(rows[0]?.id ?? null); }}>
          찾기 <kbd className="ml-1 text-[10px] text-gray-400">F3</kbd>
        </ToolBtn>
        <ToolBtn>정렬</ToolBtn>
        <ToolBtn onClick={() => setPopup("inbound")}>입고내역 참조</ToolBtn>
        <span className="ml-auto text-gray-500">{totals.rows}품목 / 총 {fmtNum(totals.qty)}개</span>
      </div>

      {/* 그리드 */}
      <div className="flex-1 overflow-auto bg-white">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#e9ecef] text-gray-700">
              <Th w="32">No</Th>
              <Th w="120">품목코드</Th>
              <Th w="240">품목명</Th>
              <Th w="140">규격</Th>
              <Th w="80" right>수량</Th>
              <Th w="130">호기</Th>
              <Th>적요</Th>
              <Th w="36"></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-b border-gray-100 hover:bg-orange-50/20">
                <Td center>{i + 1}</Td>
                <Td>
                  <div className="flex items-center">
                    <input type="text" value={r.materialId}
                      onChange={e => patchRow(r.id, { materialId: e.target.value })}
                      className={cellInput} />
                    <button type="button" onClick={() => { setPopup("material"); setPopupRow(r.id); }}
                      className="px-1.5 text-gray-400 hover:text-orange-500">🔍</button>
                  </div>
                </Td>
                <Td>
                  <input type="text" value={r.materialName}
                    onChange={e => patchRow(r.id, { materialName: e.target.value })}
                    className={cellInput} />
                </Td>
                <Td>
                  <input type="text" value={r.spec}
                    onChange={e => patchRow(r.id, { spec: e.target.value })}
                    className={cellInput} />
                </Td>
                <Td right>
                  <input type="number" min={0} value={r.qty || ""}
                    onChange={e => patchRow(r.id, { qty: Number(e.target.value) || 0 })}
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
            <tr className="bg-[#e9ecef] font-semibold border-t-2 border-gray-300">
              <Td colSpan={4} center className="text-gray-600">합 계</Td>
              <Td right className="tabular-nums">{fmtNum(totals.qty)}</Td>
              <Td colSpan={3} right className="tabular-nums text-orange-600">
                총 {totals.rows}품목
              </Td>
            </tr>
          </tfoot>
        </table>
        <div className="px-5 py-2">
          <button type="button" onClick={addRow} className="text-xs text-gray-500 hover:text-orange-500">+ 행 추가</button>
        </div>
      </div>

      {/* 하단 액션 */}
      <div className="bg-white border-t border-gray-200 px-5 py-3 flex items-center justify-end gap-2 shrink-0">
        <button type="button" onClick={() => router.push("/outbound")}
          className="text-xs px-4 py-2 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">리스트</button>
        <button type="button" onClick={clearAll}
          className="text-xs px-4 py-2 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">다시 작성</button>
        <button type="button" disabled={saving} onClick={() => save(true)}
          className="text-xs px-4 py-2 rounded border border-orange-300 text-orange-600 hover:bg-orange-50 disabled:opacity-50">
          저장/전표 <kbd className="text-[10px] text-orange-400">F7</kbd>
        </button>
        <button type="button" disabled={saving} onClick={() => save(false)}
          className="text-xs px-5 py-2 rounded bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-50 shadow-sm">
          {saving ? "저장 중..." : <>저장 <kbd className="text-[10px] text-orange-200">F8</kbd></>}
        </button>
      </div>

      {/* 팝업 */}
      {popup === "site" && (
        <SearchPopup title="현장 검색" onClose={() => setPopup(null)}
          items={sites.map(s => ({ id: s.id, label: s.name }))}
          onSelect={item => { setSiteName(item.label); setPopup(null); }} />
      )}
      {popup === "material" && popupRow && (
        <MaterialPopup onClose={() => setPopup(null)} onSelect={m => applyMaterial(popupRow, m)} />
      )}
      {popup === "inbound" && (
        <InboundRefPopup onClose={() => setPopup(null)} onSelect={applyInbound} />
      )}
    </div>
  );
}

// ── 공통 헬퍼 (다른 Entry 컴포넌트와 동일한 패턴) ──────────────
const inputCls  = "w-full px-2 py-1 text-xs font-medium text-gray-900 border border-gray-300 rounded bg-white focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-200 placeholder:text-gray-400 placeholder:font-normal";
const cellInput = "w-full px-1.5 py-1 text-xs font-medium text-gray-900 border-0 bg-white focus:outline-none focus:bg-yellow-50 focus:ring-1 focus:ring-orange-300 placeholder:text-gray-400 placeholder:font-normal";

function FormField({ label, required, wide, children }: { label: string; required?: boolean; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-2 ${wide ? "col-span-2" : ""}`}>
      <label className="text-xs font-medium text-gray-800 shrink-0 w-16 text-right">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function SearchField({ value, onChange, onOpen }: { value: string; onChange: (v: string) => void; onOpen: () => void }) {
  return (
    <div className="flex gap-1">
      <input type="text" value={value} onChange={e => onChange(e.target.value)} className={inputCls} />
      <button type="button" onClick={onOpen}
        className="px-2 py-1 text-xs border border-gray-300 rounded bg-gray-50 hover:bg-gray-100 shrink-0">🔍</button>
    </div>
  );
}

function ToolBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="px-2.5 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-orange-300 transition-colors text-xs">
      {children}
    </button>
  );
}

function Th({ children, w, right }: { children?: React.ReactNode; w?: string; right?: boolean }) {
  return (
    <th style={{ width: w ? `${w}px` : undefined }}
      className={`px-2 py-1.5 border border-gray-300 font-medium text-gray-700 ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function Td({ children, right, center, className = "", colSpan }: { children?: React.ReactNode; right?: boolean; center?: boolean; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan}
      className={`px-1 py-0.5 border border-gray-200 ${right ? "text-right" : center ? "text-center" : ""} ${className}`}>
      {children}
    </td>
  );
}

// ── 팝업 ───────────────────────��────────────────────────────────
function SearchPopup({ title, items, onSelect, onClose }: {
  title: string;
  items: { id: number; label: string }[];
  onSelect: (item: { id: number; label: string }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const filtered = items.filter(i => !q || i.label.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[480px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="p-3">
          <input type="text" value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="검색"
            className="w-full px-3 py-2 text-sm font-medium text-gray-900 border border-gray-200 rounded focus:outline-none focus:border-orange-400 placeholder:text-gray-400 placeholder:font-normal" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map(item => (
            <button key={item.id} type="button" onClick={() => onSelect(item)}
              className="w-full text-left px-4 py-2 text-sm font-medium text-gray-900 hover:bg-orange-50 border-b border-gray-50">{item.label}</button>
          ))}
          {filtered.length === 0 && <p className="text-center py-8 text-xs text-gray-400">검색 결과 없음</p>}
        </div>
      </div>
    </div>
  );
}

function MaterialPopup({ onSelect, onClose }: { onSelect: (m: MaterialRecord) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MaterialRecord[]>([]);
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/materials?q=${encodeURIComponent(q)}`);
      setResults((await res.json()).slice(0, 50));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[640px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
          <h3 className="text-sm font-semibold">품목 검색</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="p-3">
          <input type="text" value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="품목코드, 품목명, 별칭"
            className="w-full px-3 py-2 text-sm font-medium text-gray-900 border border-gray-200 rounded focus:outline-none focus:border-orange-400 placeholder:text-gray-400 placeholder:font-normal" />
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {["코드", "품목명", "규격", "재고"].map(h => (
                  <th key={h} className="px-2 py-1.5 text-left border-b border-gray-200">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map(m => (
                <tr key={m.id} onClick={() => onSelect(m)} className="hover:bg-orange-50 cursor-pointer border-b border-gray-50">
                  <td className="px-2 py-1.5 font-mono text-slate-500">{m.id}</td>
                  <td className="px-2 py-1.5 font-medium">{m.name}</td>
                  <td className="px-2 py-1.5 text-gray-700">{m.modelNo ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <span className={m.stockQty === 0 ? "text-red-500 font-bold" : ""}>{m.stockQty}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.length === 0 && q  && <p className="text-center py-8 text-xs text-gray-400">검색 결과 없음</p>}
          {!q                         && <p className="text-center py-8 text-xs text-gray-400">검색어를 입력하세요</p>}
        </div>
      </div>
    </div>
  );
}

function InboundRefPopup({ onSelect, onClose }: { onSelect: (t: TransactionRecord) => void; onClose: () => void }) {
  const [records, setRecords] = useState<TransactionRecord[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    fetch("/api/transactions?type=입고").then(r => r.json()).then((data: TransactionRecord[]) => setRecords(data.slice(0, 200)));
  }, []);
  const filtered = records.filter(t =>
    !q ||
    t.materialName.toLowerCase().includes(q.toLowerCase()) ||
    t.materialId.toLowerCase().includes(q.toLowerCase()) ||
    (t.siteName?.toLowerCase().includes(q.toLowerCase()) ?? false)
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[700px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
          <h3 className="text-sm font-semibold">입고내역 참조 ({records.length}건)</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="p-3">
          <input type="text" value={q} onChange={e => setQ(e.target.value)} autoFocus
            placeholder="자재명, 코드, 현장 검색"
            className="w-full px-3 py-2 text-sm font-medium text-gray-900 border border-gray-200 rounded focus:outline-none focus:border-orange-400 placeholder:text-gray-400 placeholder:font-normal" />
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {["입고일", "자재명", "코드", "수량", "현재재고", "현장"].map(h => (
                  <th key={h} className="px-2 py-1.5 text-left border-b border-gray-200">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} onClick={() => onSelect(t)} className="hover:bg-orange-50 cursor-pointer border-b border-gray-50">
                  <td className="px-2 py-1.5 text-gray-600">{t.createdAt.slice(0, 10)}</td>
                  <td className="px-2 py-1.5 font-medium">{t.materialName}</td>
                  <td className="px-2 py-1.5 font-mono text-slate-500">{t.materialId}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-blue-600">+{t.qty}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{t.afterStock}</td>
                  <td className="px-2 py-1.5 text-gray-600">{t.siteName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="text-center py-8 text-xs text-gray-400">입고 내역 없음</p>}
        </div>
      </div>
    </div>
  );
}
