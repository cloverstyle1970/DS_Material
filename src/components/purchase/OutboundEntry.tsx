"use client";

import { useState, useMemo, useEffect, useRef, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { MaterialRecord } from "@/lib/mock-materials";
import { ElevatorRecord } from "@/lib/mock-elevators";
import { TransactionRecord } from "@/lib/mock-transactions";
import { api, getErrorMessage } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { fmtNum, parseNum } from "@/lib/format";
import { isTkMaterial, TK_TEXT_CLASS, isRepairMaterial } from "@/lib/material-style";
import DraggableModal from "@/components/common/DraggableModal";
import SerialEntryModal from "./SerialEntryModal";
import ElevatorPicker from "@/components/common/ElevatorPicker";
import { formatDate as sharedFormatYmd } from "@/lib/input-format";
import OutboundDeliveryNotePaper, { DNReceiver, DNVendor } from "./OutboundDeliveryNotePaper";

interface SiteOption { id: number; name: string }

interface Row {
  id: string;
  materialId: string;
  materialName: string;
  spec: string;
  qty: number;
  unitPrice: number;       // 출고 공급가 = 판매단가
  buyPrice: number;        // 구매단가
  stockQty: number;        // 현재 재고 (재고조정 후 갱신)
  storageLoc: string;      // 보관위치 (재고조정 모달 기본값용)
  elevatorName: string;
  requiresReturn: boolean;
  remark: string;
  inboundRef: number | null;
  serialNos: string[];
  existingId?: number;
}

function newRow(seed: Partial<Row> = {}): Row {
  return { id: crypto.randomUUID(), materialId: "", materialName: "", spec: "", qty: 0, unitPrice: 0, buyPrice: 0, stockQty: 0, storageLoc: "", elevatorName: "", requiresReturn: false, remark: "", inboundRef: null, serialNos: [], ...seed };
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

export default function OutboundEntry({ editId }: { editId?: number } = {}) {
  const router   = useRouter();
  const { user } = useAuth();
  const isEdit = editId != null && editId > 0;

  const [outboundDate, setOutboundDate] = useState(todayISO());
  const [siteName,     setSiteName]     = useState("");
  const [elevators,    setElevators]    = useState<ElevatorRecord[]>([]);
  const [sites,        setSites]        = useState<SiteOption[]>([]);
  const [reference,    setReference]    = useState("");
  const [matType,      setMatType]      = useState<"전체" | "DS" | "TK">("전체");

  const [saving, setSaving] = useState(false);
  const [serialEditRowId, setSerialEditRowId] = useState<string | null>(null);
  const [editBatchId, setEditBatchId] = useState<string | null>(null);
  const [previewDN, setPreviewDN] = useState(false);
  const [dnReceiver, setDnReceiver] = useState<DNReceiver>({ name: "", bizNo: "", address: "", phone: "" });
  const [dnVendors, setDnVendors] = useState<DNVendor[]>([]);
  const [dnStampUrl, setDnStampUrl] = useState("");

  useEffect(() => {
    if (!isEdit || !editId) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await api.get<TransactionRecord[]>("/api/transactions?type=출고");
        const target = all.find(t => t.id === editId);
        if (!target) { alert("내역을 찾을 수 없습니다."); router.push("/outbound"); return; }
        
        const siblings = target.batchId
          ? all.filter(t => t.batchId === target.batchId).sort((a, b) => a.id - b.id)
          : [target];
          
        if (cancelled) return;
        
        setOutboundDate(target.createdAt.slice(0, 10));
        setSiteName(target.siteName || "");
        setReference(target.note || "");
        setEditBatchId(target.batchId || null);
        
        const loaded: Row[] = [];
        for (const t of siblings) {
          loaded.push({
            id: crypto.randomUUID(),
            existingId: t.id,
            materialId: t.materialId,
            materialName: t.materialName,
            spec: "",
            qty: t.qty,
            unitPrice: 0,
            buyPrice: 0,
            stockQty: 0,
            storageLoc: "",
            elevatorName: t.elevatorName || "",
            remark: t.note || "",
            inboundRef: null,
            serialNos: t.serialNo ? [t.serialNo] : [],
            requiresReturn: !!t.requiresReturn,
          });
        }
        
        while (loaded.length < 5) loaded.push(newRow());
        setRows(loaded);
      } catch (e) {
        if (!cancelled) alert(getErrorMessage(e));
      }
    })();
    return () => { cancelled = true; };
  }, [isEdit, editId, router]);

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      setMatType(user.name === "황진한" ? "DS" : user.name === "박은숙" ? "TK" : "전체");
    }, 0);
    return () => clearTimeout(t);
  }, [user]);

  useEffect(() => {
    api.get<SiteOption[]>("/api/sites").then(setSites).catch(() => {});
    api.get<{ name: string; bizNo: string | null; address: string | null; phone: string | null }[]>("/api/vendors")
      .then(data => setDnVendors(data.map(v => ({ name: v.name, bizNo: v.bizNo ?? "", address: v.address ?? "", phone: v.phone ?? "" }))))
      .catch(() => {});
    (async () => {
      const { data } = await supabase.from("quote_settings").select("company_stamp_url").eq("id", 1).maybeSingle();
      if (data?.company_stamp_url) setDnStampUrl(data.company_stamp_url);
    })();
  }, []);

  const [rows,  setRows]  = useState<Row[]>([newRow(), newRow(), newRow(), newRow(), newRow()]);
  const [popup,  setPopup]  = useState<null | "inbound">(null);
  const [adjustRowId, setAdjustRowId] = useState<string | null>(null);

  async function refreshRowStock(rowId: string, materialId: string) {
    try {
      const m = await api.get<MaterialRecord>(`/api/materials/${encodeURIComponent(materialId)}`);
      patchRow(rowId, {
        spec: m.modelNo ?? "",
        stockQty: m.stockQty ?? 0,
        storageLoc: m.storageLoc ?? "",
        buyPrice: m.buyPrice ?? 0,
        unitPrice: m.sellPrice ?? 0,
      });
    } catch { /* ignore */ }
  }

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
          unitPrice: m.sellPrice ?? 0,
          buyPrice: m.buyPrice ?? 0,
          stockQty: m.stockQty ?? 0,
          storageLoc: m.storageLoc ?? "",
          serialNos: [] as string[],
        };
        if (idx < next.length) next[idx] = { ...next[idx], ...patch };
        else next.push(newRow(patch));
      });
      return next;
    });
  }

  function applyInbound(t: TransactionRecord) {
    // remark는 사용자 메모 자리이므로 비워둠. 입고 식별은 inboundRef로,
    // transaction note의 '입고 #N 출고완료' 패턴은 save() 단에서 자동 prepend.
    const row = newRow({
      materialId: t.materialId, materialName: t.materialName,
      qty: t.qty, inboundRef: t.id, remark: "",
    });
    if (t.siteName && !siteName) setSiteName(t.siteName);
    setRows(prev => {
      const firstEmpty = prev.findIndex(r => !r.materialId);
      if (firstEmpty >= 0) { const next = [...prev]; next[firstEmpty] = row; return next; }
      return [...prev, row];
    });
    setPopup(null);
    if (t.materialId) refreshRowStock(row.id, t.materialId);
  }

  const totals = useMemo(() => {
    const valid = rows.filter(r => r.materialId);
    let qty = 0, supply = 0;
    for (const r of valid) { qty += r.qty; supply += r.qty * r.unitPrice; }
    return { rows: valid.length, qty, supply };
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
      if (isEdit) {
        if (editBatchId) {
          await api.delete(`/api/transactions/batch/${editBatchId}`);
        } else {
          await api.delete(`/api/transactions/${editId}`);
        }
      }
      
      const batchId = isEdit && editBatchId ? editBatchId : crypto.randomUUID();
      for (const r of valid) {
        // note 형식 표준: r.inboundRef가 있으면 '입고 #N 출고완료' 패턴 강제 포함.
        // 사용자 메모는 ' / ' 구분자로 뒤에 append. 이 패턴이 InboundRefPopup
        // 안전장치의 매칭 정규식에서 활용됨.
        const userMemo = (r.remark || reference || "").trim();
        let note: string | null;
        if (r.inboundRef != null) {
          const tag = `입고 #${r.inboundRef} 출고완료`;
          note = userMemo ? `${tag} / ${userMemo}` : tag;
        } else {
          note = userMemo || null;
        }
        await api.post("/api/transactions", {
          type: "출고", materialId: r.materialId, materialName: r.materialName,
          qty: r.qty, siteName: siteName || null,
          elevatorName: r.elevatorName || null,
          serialNos: r.serialNos.length > 0 ? r.serialNos : null,
          requiresReturn: r.requiresReturn,
          note, userId: user.id, userName: user.name,
          batchId,
          createdAt: isEdit ? outboundDate : undefined,
        });
      }
      if (goList) router.push("/outbound");
      else clearAll();
    } catch (e) {
      alert(getErrorMessage(e));
    } finally { setSaving(false); }
  }

  // TODO(추후 검토): 거래명세서 공급받는자 등록번호/주소가 거래처 선택 시에도 표시 안 되는 사례 보고됨(2026-05-25).
  // 거래처관리(vendors) biz_no/address 데이터 점검 + 현장↔거래처 매핑 방식 재검토 필요.
  function openDeliveryNote() {
    // 현장명과 이름이 일치하는 거래처가 있으면 등록번호·주소·전화까지 자동 채움
    setDnReceiver(r => {
      if (r.bizNo || r.address) return r; // 이미 거래처를 선택해 채워진 경우 보존
      const key = (r.name || siteName).trim();
      const matched = key ? dnVendors.find(v => v.name === key) : undefined;
      if (matched) return { name: matched.name, bizNo: matched.bizNo, address: matched.address, phone: matched.phone };
      return { ...r, name: r.name || siteName };
    });
    setPreviewDN(true);
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === "F8") { e.preventDefault(); save(false); }
    else if (e.key === "F7") { e.preventDefault(); openDeliveryNote(); }
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
            <input type="text" value={user?.name ?? ""} readOnly className={inputCls + " bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 cursor-not-allowed"} />
          </FormField>
          <FormField label="부서">
            <input type="text" value={user?.dept ?? ""} readOnly className={inputCls + " bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 cursor-not-allowed"} />
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
        <span className="ml-auto text-gray-500 dark:text-gray-400">{totals.rows}품목 / 총 {fmtNum(totals.qty)}개 / 공급가액 {fmtNum(totals.supply)}원</span>
      </div>

      <div className="flex-1 overflow-auto bg-white dark:bg-gray-800">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#e9ecef] dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              <Th w="32">No</Th>
              <Th w="120">품목코드</Th>
              <Th w="200">품목명</Th>
              <Th w="240">규격</Th>
              <Th w="70">수량</Th>
              <Th w="100">단가</Th>
              <Th w="110">공급가액</Th>
              <Th w="110">호기</Th>
              <Th w="110">S/N</Th>
              <Th w="50">회수</Th>
              <Th w="140">적요</Th>
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
                    materialId={r.materialId}
                    matType={matType}
                    onMultiSelect={materials => applyMultipleMaterials(r.id, materials)}
                    onChange={v => patchRow(r.id, { materialId: v, materialName: v, spec: v })}
                  />
                </Td>
                <Td>
                  <div className="flex items-center gap-1">
                    {isRepairMaterial(r.materialId) && <span className="shrink-0 text-[9px] px-1 rounded bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300 font-bold">RE</span>}
                    <div className="flex-1 min-w-0">
                      <MatInlineSearch
                        value={r.materialName} materialId={r.materialId} matType={matType}
                        onMultiSelect={materials => applyMultipleMaterials(r.id, materials)}
                        onChange={v => patchRow(r.id, { materialId: v, materialName: v, spec: v })}
                      />
                    </div>
                  </div>
                </Td>
                <Td>
                  <MatInlineSearch
                    value={r.spec}
                    materialId={r.materialId}
                    matType={matType}
                    onMultiSelect={materials => applyMultipleMaterials(r.id, materials)}
                    onChange={v => patchRow(r.id, { materialId: v, materialName: v, spec: v })}
                  />
                </Td>
                <Td right>
                  <div className="flex flex-col gap-0.5">
                    <input type="text" inputMode="numeric" value={r.qty === 0 ? "" : String(r.qty)}
                      onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ""); patchRow(r.id, { qty: v === "" ? 0 : Number(v) }); }}
                      title={r.serialNos.length > 0 ? `S/N ${r.serialNos.length}건 선택됨 — 수량은 ${r.serialNos.length} 이상이어야 함` : undefined}
                      className={cellInput + " text-right"} />
                    {r.materialId && (
                      r.qty > r.stockQty ? (
                        <button type="button" onClick={() => setAdjustRowId(r.id)}
                          title={`재고 부족: 보유 ${fmtNum(r.stockQty)} / 필요 ${fmtNum(r.qty)}`}
                          className="text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 font-semibold whitespace-nowrap">
                          ⚠ 재고{fmtNum(r.stockQty)} · 조정
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 text-right">재고 {fmtNum(r.stockQty)}</span>
                      )
                    )}
                  </div>
                </Td>
                <Td right>
                  <input type="text" inputMode="numeric" value={r.unitPrice === 0 ? "" : fmtNum(r.unitPrice)}
                    onChange={e => patchRow(r.id, { unitPrice: parseNum(e.target.value) })}
                    className={cellInput + " text-right"} />
                </Td>
                <Td right className="text-gray-700 dark:text-gray-300 tabular-nums">{fmtNum(r.qty * r.unitPrice)}</Td>
                <Td>
                  {elevators.length > 0 ? (
                    <ElevatorPicker value={r.elevatorName} elevators={elevators}
                      onChange={v => patchRow(r.id, { elevatorName: v })} />
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
              <Td></Td>
              <Td right className="tabular-nums text-orange-600">{fmtNum(totals.supply)}</Td>
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
        <button type="button" onClick={openDeliveryNote}
          className="text-xs px-4 py-2 rounded border border-orange-300 text-orange-600 hover:bg-orange-50">
          🖨 거래명세서
        </button>
        <button type="button" disabled={saving} onClick={() => save(false)}
          className="text-xs px-5 py-2 rounded bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-50 shadow-sm">
          {saving ? "저장 중..." : "저장"}
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

      {adjustRowId && user && (() => {
        const row = rows.find(r => r.id === adjustRowId);
        if (!row) return null;
        return (
          <StockAdjustModal
            row={row}
            user={user}
            onClose={() => setAdjustRowId(null)}
            onSaved={async () => {
              await refreshRowStock(row.id, row.materialId);
              setAdjustRowId(null);
            }}
          />
        );
      })()}

      {/* 거래명세서 미리보기 / 인쇄 오버레이 */}
      {previewDN && (
        <div className="fixed inset-0 z-50 bg-gray-100 dark:bg-gray-900 overflow-auto dn-preview-overlay">
          <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm px-4 py-2 flex items-center gap-2 print:hidden">
            <span className="text-sm font-bold text-gray-800 dark:text-gray-100">🖨 거래명세서 미리보기</span>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => window.print()}
                className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white font-semibold hover:bg-blue-700">🖨 인쇄 / PDF로 저장</button>
              <button type="button" onClick={() => setPreviewDN(false)}
                className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">✕ 닫기</button>
            </div>
          </div>
          <div className="p-6 print:p-0">
            <OutboundDeliveryNotePaper
              outboundDate={outboundDate}
              items={rows.map(r => ({
                materialId:   r.materialId,
                materialName: r.materialName,
                spec:         r.spec,
                qty:          r.qty,
                unitPrice:    r.unitPrice,
              }))}
              receiver={dnReceiver}
              onReceiverChange={patch => setDnReceiver(s => ({ ...s, ...patch }))}
              vendors={dnVendors}
              stampUrl={dnStampUrl}
            />
          </div>

          {/* 인쇄 시 미리보기만 출력되도록 격리 */}
          <style jsx global>{`
            @media print {
              body * { visibility: hidden !important; }
              .dn-preview-overlay, .dn-preview-overlay * { visibility: visible !important; }
              .dn-preview-overlay {
                position: absolute !important;
                left: 0; top: 0; right: 0;
                background: white !important;
                overflow: visible !important;
              }
            }
          `}</style>
        </div>
      )}
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
        // 단일 결과면 자동 포커스 (Enter로 즉시 선택 가능)
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
            {results.map((m, idx) => (
              <li key={m.id}>
                <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => toggle(m.id)}
                  className={`w-full text-left px-3 py-2 border-b border-gray-50 dark:border-gray-700 last:border-0 flex items-center gap-2 ${checked.has(m.id) ? "bg-orange-50 dark:bg-orange-900/30" : focusedIndex === idx ? "bg-orange-100 dark:bg-orange-900/50" : "hover:bg-gray-50 dark:hover:bg-gray-700"}`}>
                  <input type="checkbox" readOnly checked={checked.has(m.id)} className="accent-orange-500 shrink-0" />
                  <div className="min-w-0">
                    <div className={`text-xs font-medium ${isTkMaterial(m.id) ? TK_TEXT_CLASS : "text-gray-800 dark:text-gray-200"}`}>
                      {m.isRepair && <span className="mr-1 text-[9px] px-1 rounded bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300 font-bold align-middle">RE</span>}
                      {m.name}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[10px] font-mono ${isTkMaterial(m.id) ? TK_TEXT_CLASS : "text-slate-400 dark:text-slate-500"}`}>{m.id}</span>
                      {m.modelNo && <span className="text-[10px] text-gray-500 dark:text-gray-400 border-l border-gray-300 dark:border-gray-600 pl-2">{m.modelNo}</span>}
                      {m.alias && <span className="text-[10px] text-gray-400 dark:text-gray-500">{m.alias}</span>}
                      <span className={`text-[10px] ml-auto font-semibold ${m.stockQty === 0 ? "text-red-400" : "text-gray-400 dark:text-gray-500"}`}>재고 {fmtNum(m.stockQty)}</span>
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
      <input type="text" lang="ko" value={value} onChange={e => { onChange(e.target.value); setOpen(true); }}
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
    // 안전장치: type='입고' 후보 중에서 이미 출고에 참조된 입고는 제외.
    // 출고 transaction의 note에 '입고 #N' 또는 옛 형식 '입고#N' 패턴이 있으면 매칭.
    Promise.all([
      api.get<TransactionRecord[]>("/api/transactions?type=입고"),
      supabase.from("transactions").select("note").eq("type", "출고").ilike("note", "%입고%"),
    ]).then(([inboundRecords, txRes]) => {
      const matchedIds = new Set<number>();
      const re = /입고\s*#(\d+)/g;
      for (const t of (txRes.data ?? []) as { note: string | null }[]) {
        if (!t.note) continue;
        let m: RegExpExecArray | null;
        while ((m = re.exec(t.note)) !== null) {
          const id = Number(m[1]);
          if (id) matchedIds.add(id);
        }
      }
      const remaining = inboundRecords.filter(r => !matchedIds.has(r.id));
      setRecords(remaining.slice(0, 200));
    }).catch(() => setRecords([]));
  }, []);
  const filtered = records.filter(t =>
    !q || t.materialName.toLowerCase().includes(q.toLowerCase()) ||
    t.materialId.toLowerCase().includes(q.toLowerCase()) ||
    (t.siteName?.toLowerCase().includes(q.toLowerCase()) ?? false)
  );
  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-[700px] max-h-[70vh]"
      header={
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-semibold dark:text-gray-100">입고내역 참조 ({fmtNum(records.length)}건)</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">×</button>
        </div>
      }
    >
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
                  <td className={`px-2 py-1.5 font-medium ${isTkMaterial(t.materialId) ? TK_TEXT_CLASS : "dark:text-gray-200"}`}>{t.materialName}</td>
                  <td className={`px-2 py-1.5 font-mono ${isTkMaterial(t.materialId) ? TK_TEXT_CLASS : "text-slate-500 dark:text-slate-400"}`}>{t.materialId}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-blue-600">{fmtNum(t.qty)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold dark:text-gray-300">{fmtNum(t.afterStock)}</td>
                  <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">{t.siteName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="text-center py-8 text-xs text-gray-400 dark:text-gray-500">입고 내역 없음</p>}
        </div>
    </DraggableModal>
  );
}

// ── 재고조정 (입고 처리) 모달 ─────────────────────────────────────
function StockAdjustModal({
  row, user, onClose, onSaved,
}: {
  row: Row;
  user: { id: number; name: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  // 오늘 날짜 yyyy-MM-dd
  function todayLocal() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  // 입력 자동 포맷: 숫자만 추출, 8자리까지, 4-2-2로 하이픈 삽입
  const formatYmd = sharedFormatYmd;
  const need = Math.max(0, row.qty - row.stockQty);
  const [adjDate, setAdjDate]    = useState(todayLocal());
  const [adjQty,  setAdjQty]     = useState<number>(need || 1);
  const [buyPrice,  setBuyPrice]  = useState<number>(row.buyPrice  || 0);
  const [sellPrice, setSellPrice] = useState<number>(row.unitPrice || 0);
  const [storageLoc, setStorageLoc] = useState(row.storageLoc || "");
  const [serialText, setSerialText] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // S/N 텍스트 → 배열 (줄바꿈/콤마 구분, trim, 빈줄 제거, 중복 제거)
  const serialList = serialText
    .split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
  const dupSerial = serialList.find((s, i) => serialList.indexOf(s) !== i);

  async function handleSave() {
    setError("");
    if (adjQty <= 0) { setError("조정수량은 1 이상이어야 합니다."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(adjDate)) { setError("재고조정 일자는 YYYY-MM-DD 형식이어야 합니다."); return; }
    if (dupSerial) { setError(`중복된 S/N: ${dupSerial}`); return; }
    if (serialList.length > 0 && serialList.length !== adjQty) {
      setError(`S/N 갯수(${serialList.length})와 조정수량(${adjQty})이 일치해야 합니다.`);
      return;
    }
    setSaving(true);
    try {
      // 1) 자재 정보 갱신 (단가·보관위치 변경된 경우)
      const matPatch: Record<string, unknown> = {};
      if (buyPrice  !== row.buyPrice)  matPatch.buyPrice   = buyPrice;
      if (sellPrice !== row.unitPrice) matPatch.sellPrice  = sellPrice;
      if (storageLoc !== row.storageLoc) matPatch.storageLoc = storageLoc;
      if (Object.keys(matPatch).length > 0) {
        await api.patch(`/api/materials/${encodeURIComponent(row.materialId)}`, matPatch);
      }
      // 2) 재고조정 = 입고 트랜잭션 생성
      await api.post("/api/transactions", {
        type: "입고",
        materialId: row.materialId,
        materialName: row.materialName,
        qty: adjQty,
        siteName: null,
        elevatorName: null,
        serialNos: serialList.length > 0 ? serialList : null,
        requiresReturn: false,
        note: `[재고조정] ${note || ""}`.trim(),
        userId: user.id,
        userName: user.name,
        adjustedAt: adjDate ? new Date(`${adjDate}T00:00:00`).toISOString() : null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-full max-w-md"
      z={60}
      header={
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <div className="text-base font-bold text-gray-900 dark:text-white">재고수량 조정</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">입고 처리로 재고 증가</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
      }
    >
        <div className="p-5 space-y-3">
          <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-3 text-xs space-y-1">
            <div><span className="text-gray-500">자재명: </span><span className={`font-semibold ${isTkMaterial(row.materialId) ? TK_TEXT_CLASS : "text-gray-800 dark:text-gray-100"}`}>{row.materialName}</span></div>
            <div><span className="text-gray-500">자재코드: </span><span className={`font-mono ${isTkMaterial(row.materialId) ? TK_TEXT_CLASS : "text-gray-700 dark:text-gray-300"}`}>{row.materialId}</span></div>
            {row.spec && <div><span className="text-gray-500">규격: </span><span className="text-gray-700 dark:text-gray-300">{row.spec}</span></div>}
            <div className="pt-1 border-t border-gray-200 dark:border-gray-600 flex items-center justify-between">
              <span className="text-gray-500">현재 재고</span>
              <span className="font-bold text-gray-800 dark:text-gray-100">{fmtNum(row.stockQty)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">필요 수량</span>
              <span className="font-bold text-orange-600 dark:text-orange-400">{fmtNum(row.qty)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">부족분</span>
              <span className="font-bold text-red-600 dark:text-red-400">{fmtNum(need)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">재고조정 일자</label>
              <input type="text" inputMode="numeric" value={adjDate}
                onChange={e => setAdjDate(formatYmd(e.target.value))}
                placeholder="YYYYMMDD" maxLength={10}
                className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs font-mono text-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">재고조정 수량 *</label>
              <input type="number" min={1} value={adjQty} onChange={e => setAdjQty(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-right tabular-nums text-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">구매단가</label>
              <input type="text" inputMode="numeric" value={buyPrice === 0 ? "" : fmtNum(buyPrice)}
                onChange={e => setBuyPrice(parseNum(e.target.value))}
                className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-right tabular-nums text-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">판매단가</label>
              <input type="text" inputMode="numeric" value={sellPrice === 0 ? "" : fmtNum(sellPrice)}
                onChange={e => setSellPrice(parseNum(e.target.value))}
                className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-right tabular-nums text-gray-900 dark:text-gray-100" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">보관위치</label>
              <input type="text" value={storageLoc} onChange={e => setStorageLoc(e.target.value)} lang="ko"
                placeholder="예: A-1-3"
                className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-gray-900 dark:text-gray-100" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              S/N <span className="text-[10px] text-gray-400 font-normal">(선택, 한 줄에 하나씩)</span>
            </label>
            <textarea value={serialText} onChange={e => setSerialText(e.target.value)} rows={3}
              placeholder="S/N을 한 줄씩 입력 (입력 시 조정수량과 갯수 일치 필요)"
              className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs font-mono text-gray-900 dark:text-gray-100 resize-y" />
            {serialList.length > 0 && (
              <div className="mt-1 text-[10px] text-gray-500">
                {serialList.length}건 입력됨{serialList.length !== adjQty && <span className="text-red-500 ml-1">(수량 {adjQty}와 불일치)</span>}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">비고</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)} lang="ko"
              placeholder="조정 사유 (선택)"
              className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-gray-900 dark:text-gray-100" />
          </div>

          {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 text-xs px-3 py-2 rounded">{error}</div>}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">취소</button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="px-4 py-2 rounded text-xs font-semibold bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50">
            {saving ? "처리 중..." : "재고조정 처리"}
          </button>
        </div>
    </DraggableModal>
  );
}
