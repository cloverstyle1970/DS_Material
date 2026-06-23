"use client";

import { useEffect, useState } from "react";
import { useAuth, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import DraggableModal from "@/components/common/DraggableModal";
import {
  SafetyRule, RepairType, FaultType, ChecklistItem,
  SafetyCategory, SafetySeason, ChecklistType,
  CATEGORY_LABELS, SEASON_LABELS,
} from "@/lib/tbm";

type Tab = "safety" | "repair" | "fault" | "checklist";

export default function TBMMasterClient() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("safety");

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  if (!hasMenuPermission(user, "/safety/tbm/master", "read")) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
      </div>
    );
  }
  const canWrite = hasMenuPermission(user, "/safety/tbm/master", "create") || hasMenuPermission(user, "/safety/tbm/master", "update");

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">TBM 마스터 관리</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">안전수칙·공사구분·고장증상·체크리스트 항목 관리</p>
      </div>

      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6">
        <div className="flex gap-1">
          {([
            ["safety", "⚠️ 안전수칙"],
            ["repair", "🛠️ 공사구분"],
            ["fault", "🚨 고장증상"],
            ["checklist", "✅ 체크리스트"],
          ] as [Tab, string][]).map(([t, label]) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors ${
                tab === t
                  ? "text-blue-600 dark:text-blue-400 border-blue-500"
                  : "text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-200"
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 py-4">
        {tab === "safety" && <SafetyRulesEditor canWrite={canWrite} />}
        {tab === "repair" && <RepairTypesEditor canWrite={canWrite} />}
        {tab === "fault" && <FaultTypesEditor canWrite={canWrite} />}
        {tab === "checklist" && <ChecklistEditor canWrite={canWrite} />}
      </div>
    </div>
  );
}

// ============================================================
// 공통 헬퍼
// ============================================================

const inputCls = "px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400";
const cardCls = "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden";

function ToggleActive({ value, onChange, canWrite = true }: { value: boolean; onChange: (v: boolean) => void; canWrite?: boolean }) {
  const cls = `text-[10px] font-bold px-2 py-0.5 rounded-full ${
    value
      ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
      : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
  }`;
  if (!canWrite) return <span className={cls}>{value ? "활성" : "비활성"}</span>;
  return (
    <button type="button" onClick={() => onChange(!value)} className={cls}>
      {value ? "활성" : "비활성"}
    </button>
  );
}

function ActionButtons({ onEdit, onDelete, canWrite = true }: { onEdit: () => void; onDelete: () => void; canWrite?: boolean }) {
  if (!canWrite) return <span className="text-gray-300 dark:text-gray-600 text-[11px]">—</span>;
  return (
    <div className="flex gap-1 justify-end">
      <button type="button" onClick={onEdit}
        className="px-2 py-0.5 text-[11px] rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200">
        수정
      </button>
      <button type="button" onClick={onDelete}
        className="px-2 py-0.5 text-[11px] rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200">
        삭제
      </button>
    </div>
  );
}

// ============================================================
// 안전수칙 에디터
// ============================================================

function SafetyRulesEditor({ canWrite }: { canWrite: boolean }) {
  const [items, setItems] = useState<SafetyRule[]>([]);
  const [editing, setEditing] = useState<SafetyRule | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    const { data } = await supabase.from("tbm_safety_rules_master").select("*").order("sort_order");
    setItems((data ?? []) as SafetyRule[]);
  }
  useEffect(() => { load(); }, []);
  useReloadOnActivate(() => { void load(); });

  async function toggleActive(id: number, v: boolean) {
    await supabase.from("tbm_safety_rules_master").update({ is_active: v }).eq("id", id);
    load();
  }

  async function remove(id: number) {
    if (!confirm("이 안전수칙을 삭제하시겠습니까?")) return;
    const { error } = await supabase.from("tbm_safety_rules_master").delete().eq("id", id);
    if (error) { alert(error.message); return; }
    load();
  }

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="text-xs text-gray-500 dark:text-gray-400">총 {items.length}건</div>
        {canWrite && <button type="button" onClick={() => setShowNew(true)}
          className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">
          + 안전수칙 추가
        </button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase">
            <tr>
              <th className="px-3 py-2 text-center">코드</th>
              <th className="px-3 py-2 text-center">내용</th>
              <th className="px-3 py-2 text-center">분류</th>
              <th className="px-3 py-2 text-center">계절</th>
              <th className="px-3 py-2 text-center">순서</th>
              <th className="px-3 py-2 text-center">상태</th>
              <th className="px-3 py-2 text-right">액션</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {items.map(r => (
              <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-3 py-2 text-center text-xs font-mono text-gray-700 dark:text-gray-200 whitespace-nowrap">{r.code}</td>
                <td className="px-3 py-2 text-center text-xs text-gray-700 dark:text-gray-200">{r.text}</td>
                <td className="px-3 py-2 text-center text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{CATEGORY_LABELS[r.category]}</td>
                <td className="px-3 py-2 text-center text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{SEASON_LABELS[r.season]}</td>
                <td className="px-3 py-2 text-center text-xs text-gray-500 dark:text-gray-400">{r.sort_order}</td>
                <td className="px-3 py-2 text-center"><ToggleActive value={r.is_active} onChange={v => toggleActive(r.id, v)} canWrite={canWrite} /></td>
                <td className="px-3 py-2 text-center"><ActionButtons onEdit={() => setEditing(r)} onDelete={() => remove(r.id)} canWrite={canWrite} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(showNew || editing) && (
        <SafetyRuleModal
          initial={editing}
          onClose={() => { setShowNew(false); setEditing(null); }}
          onSaved={() => { setShowNew(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function SafetyRuleModal({ initial, onClose, onSaved }: {
  initial: SafetyRule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const [category, setCategory] = useState<SafetyCategory>(initial?.category ?? "all");
  const [season, setSeason] = useState<SafetySeason>(initial?.season ?? "all");
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!code.trim() || !text.trim()) { alert("코드와 내용은 필수입니다."); return; }
    setSaving(true);
    const payload = {
      code: code.trim(), text: text.trim(),
      category, season, sort_order: Number(sortOrder) || 0,
    };
    const res = initial
      ? await supabase.from("tbm_safety_rules_master").update(payload).eq("id", initial.id)
      : await supabase.from("tbm_safety_rules_master").insert(payload);
    setSaving(false);
    if (res.error) { alert(res.error.message); return; }
    onSaved();
  }

  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-full max-w-md"
      z={60}
      header={
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-base font-bold text-gray-900 dark:text-white">{initial ? "안전수칙 수정" : "안전수칙 추가"}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
      }
    >
        <div className="p-5 space-y-3">
          <Field label="코드 *">
            <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="예: R21"
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-mono text-gray-900 dark:text-gray-100" />
          </Field>
          <Field label="내용 *">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={3} lang="ko"
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 resize-none" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="분류">
              <select value={category} onChange={e => setCategory(e.target.value as SafetyCategory)}
                className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100">
                {(["all","electric","repair","maintain","rescue","weld"] as SafetyCategory[]).map(c => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </Field>
            <Field label="계절">
              <select value={season} onChange={e => setSeason(e.target.value as SafetySeason)}
                className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100">
                {(["all","spring","summer","fall","winter"] as SafetySeason[]).map(s => (
                  <option key={s} value={s}>{SEASON_LABELS[s]}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="정렬 순서">
            <input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))}
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
          </Field>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">취소</button>
          <button type="button" onClick={save} disabled={saving}
            className="px-4 py-2 rounded text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
    </DraggableModal>
  );
}

// ============================================================
// 공사구분 / 고장증상 — code + label 패턴 공통화
// ============================================================

function SimpleTypeEditor({
  table, codePrefix, title, canWrite,
}: { table: "tbm_repair_types" | "tbm_fault_types"; codePrefix: string; title: string; canWrite: boolean }) {
  const [items, setItems] = useState<(RepairType | FaultType)[]>([]);
  const [editing, setEditing] = useState<RepairType | FaultType | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    const { data } = await supabase.from(table).select("*").order("sort_order");
    setItems((data ?? []) as (RepairType | FaultType)[]);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [table]);
  useReloadOnActivate(() => { void load(); });

  async function toggleActive(id: number, v: boolean) {
    await supabase.from(table).update({ is_active: v }).eq("id", id);
    load();
  }

  async function remove(id: number) {
    if (!confirm(`이 ${title}을(를) 삭제하시겠습니까?`)) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) { alert(error.message); return; }
    load();
  }

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="text-xs text-gray-500 dark:text-gray-400">총 {items.length}건</div>
        {canWrite && <button type="button" onClick={() => setShowNew(true)}
          className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">
          + {title} 추가
        </button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase">
            <tr>
              <th className="px-3 py-2 text-center">코드</th>
              <th className="px-3 py-2 text-center">{title}</th>
              <th className="px-3 py-2 text-center">순서</th>
              <th className="px-3 py-2 text-center">상태</th>
              <th className="px-3 py-2 text-right">액션</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {items.map(r => (
              <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-3 py-2 text-center text-xs font-mono text-gray-700 dark:text-gray-200 whitespace-nowrap">{r.code}</td>
                <td className="px-3 py-2 text-center text-xs text-gray-700 dark:text-gray-200">{r.label}</td>
                <td className="px-3 py-2 text-center text-xs text-gray-500 dark:text-gray-400">{r.sort_order}</td>
                <td className="px-3 py-2 text-center"><ToggleActive value={r.is_active} onChange={v => toggleActive(r.id, v)} canWrite={canWrite} /></td>
                <td className="px-3 py-2 text-center"><ActionButtons onEdit={() => setEditing(r)} onDelete={() => remove(r.id)} canWrite={canWrite} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(showNew || editing) && (
        <SimpleTypeModal
          table={table} codePrefix={codePrefix} title={title}
          initial={editing}
          onClose={() => { setShowNew(false); setEditing(null); }}
          onSaved={() => { setShowNew(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function SimpleTypeModal({
  table, codePrefix, title, initial, onClose, onSaved,
}: {
  table: "tbm_repair_types" | "tbm_fault_types";
  codePrefix: string;
  title: string;
  initial: RepairType | FaultType | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!code.trim() || !label.trim()) { alert("코드와 이름은 필수입니다."); return; }
    setSaving(true);
    const payload = { code: code.trim(), label: label.trim(), sort_order: Number(sortOrder) || 0 };
    const res = initial
      ? await supabase.from(table).update(payload).eq("id", initial.id)
      : await supabase.from(table).insert(payload);
    setSaving(false);
    if (res.error) { alert(res.error.message); return; }
    onSaved();
  }

  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-full max-w-md"
      z={60}
      header={
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-base font-bold text-gray-900 dark:text-white">{initial ? `${title} 수정` : `${title} 추가`}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
      }
    >
        <div className="p-5 space-y-3">
          <Field label={`코드 * (예: ${codePrefix}10)`}>
            <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder={`${codePrefix}10`}
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-mono text-gray-900 dark:text-gray-100" />
          </Field>
          <Field label={`${title} *`}>
            <input type="text" value={label} onChange={e => setLabel(e.target.value)} lang="ko"
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
          </Field>
          <Field label="정렬 순서">
            <input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))}
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
          </Field>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">취소</button>
          <button type="button" onClick={save} disabled={saving}
            className="px-4 py-2 rounded text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
    </DraggableModal>
  );
}

function RepairTypesEditor({ canWrite }: { canWrite: boolean }) {
  return <SimpleTypeEditor table="tbm_repair_types" codePrefix="RT" title="공사구분" canWrite={canWrite} />;
}

function FaultTypesEditor({ canWrite }: { canWrite: boolean }) {
  return <SimpleTypeEditor table="tbm_fault_types" codePrefix="FT" title="고장증상" canWrite={canWrite} />;
}

// ============================================================
// 체크리스트
// ============================================================

function ChecklistEditor({ canWrite }: { canWrite: boolean }) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [editing, setEditing] = useState<ChecklistItem | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [filterType, setFilterType] = useState<"all" | ChecklistType>("all");

  async function load() {
    const { data } = await supabase.from("tbm_checklist_items").select("*").order("list_type").order("sort_order");
    setItems((data ?? []) as ChecklistItem[]);
  }
  useEffect(() => { load(); }, []);
  useReloadOnActivate(() => { void load(); });

  const filtered = filterType === "all" ? items : items.filter(i => i.list_type === filterType);

  async function toggleActive(id: number, v: boolean) {
    await supabase.from("tbm_checklist_items").update({ is_active: v }).eq("id", id);
    load();
  }

  async function remove(id: number) {
    if (!confirm("이 체크리스트 항목을 삭제하시겠습니까?")) return;
    const { error } = await supabase.from("tbm_checklist_items").delete().eq("id", id);
    if (error) { alert(error.message); return; }
    load();
  }

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          {(["all","repair","inspect"] as ("all" | ChecklistType)[]).map(t => (
            <button key={t} type="button" onClick={() => setFilterType(t)}
              className={`px-3 py-1 text-xs font-semibold rounded-full border ${
                filterType === t
                  ? "bg-slate-700 text-white border-slate-700"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600"
              }`}>
              {t === "all" ? "전체" : t === "repair" ? "수리 작업 전 안전조치" : "보수 자체점검"}
            </button>
          ))}
          <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">총 {filtered.length}건</span>
        </div>
        {canWrite && <button type="button" onClick={() => setShowNew(true)}
          className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">
          + 항목 추가
        </button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase">
            <tr>
              <th className="px-3 py-2 text-center">유형</th>
              <th className="px-3 py-2 text-center">항목</th>
              <th className="px-3 py-2 text-center">순서</th>
              <th className="px-3 py-2 text-center">상태</th>
              <th className="px-3 py-2 text-right">액션</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.map(r => (
              <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    r.list_type === "repair"
                      ? "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300"
                      : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                  }`}>
                    {r.list_type === "repair" ? "수리" : "자체점검"}
                  </span>
                </td>
                <td className="px-3 py-2 text-center text-xs text-gray-700 dark:text-gray-200">{r.label}</td>
                <td className="px-3 py-2 text-center text-xs text-gray-500 dark:text-gray-400">{r.sort_order}</td>
                <td className="px-3 py-2 text-center"><ToggleActive value={r.is_active} onChange={v => toggleActive(r.id, v)} canWrite={canWrite} /></td>
                <td className="px-3 py-2 text-center"><ActionButtons onEdit={() => setEditing(r)} onDelete={() => remove(r.id)} canWrite={canWrite} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(showNew || editing) && (
        <ChecklistModal
          initial={editing}
          onClose={() => { setShowNew(false); setEditing(null); }}
          onSaved={() => { setShowNew(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function ChecklistModal({ initial, onClose, onSaved }: {
  initial: ChecklistItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [listType, setListType] = useState<ChecklistType>(initial?.list_type ?? "repair");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!label.trim()) { alert("항목 내용은 필수입니다."); return; }
    setSaving(true);
    const payload = { list_type: listType, label: label.trim(), sort_order: Number(sortOrder) || 0 };
    const res = initial
      ? await supabase.from("tbm_checklist_items").update(payload).eq("id", initial.id)
      : await supabase.from("tbm_checklist_items").insert(payload);
    setSaving(false);
    if (res.error) { alert(res.error.message); return; }
    onSaved();
  }

  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-full max-w-md"
      z={60}
      header={
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-base font-bold text-gray-900 dark:text-white">{initial ? "체크리스트 항목 수정" : "체크리스트 항목 추가"}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
      }
    >
        <div className="p-5 space-y-3">
          <Field label="유형 *">
            <select value={listType} onChange={e => setListType(e.target.value as ChecklistType)}
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100">
              <option value="repair">수리 작업 전 안전조치</option>
              <option value="inspect">보수 자체점검</option>
            </select>
          </Field>
          <Field label="항목 *">
            <input type="text" value={label} onChange={e => setLabel(e.target.value)} lang="ko"
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
          </Field>
          <Field label="정렬 순서">
            <input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))}
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
          </Field>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">취소</button>
          <button type="button" onClick={save} disabled={saving}
            className="px-4 py-2 rounded text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
    </DraggableModal>
  );
}

// ============================================================
// 공통 필드 래퍼
// ============================================================

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      {children}
    </div>
  );
}
