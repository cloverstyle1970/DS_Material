"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import Combobox from "@/components/tbm/Combobox";
import DraggableModal from "@/components/common/DraggableModal";
import { formatDate as sharedFormatYmd } from "@/lib/input-format";

const MENU_HREF = "/hr/company-vehicles";
const VEHICLE_DOCS_BUCKET = "vehicle-docs";
const SHARED_USER_ID = -1;
const SHARED_USER_LABEL = "공용 차량";

interface Vehicle {
  id: number;
  user_id: number | null;
  vehicle_type: string;
  plate_number: string;
  model: string;
  year_made: string | null;
  fuel_type: string;
  registration_date: string | null;
  registration_doc_url: string | null;
  insurance_company: string | null;
  insurance_start_date: string | null;
  insurance_end_date: string | null;
  driver_age_range: string | null;
  driver_scope: string | null;
  insurance_doc_url: string | null;
  status: "active" | "scrapped";
  scrapped_at: string | null;
  scrapped_by_name: string | null;
  scrapped_note: string | null;
  sort_order: number;
}

interface UserMini { id: number; name: string; dept: string | null; }

interface Row extends Vehicle {
  user_name: string;
  user_dept: string;
}

type StatusFilter = "active" | "scrapped" | "all";

// 정렬 가능 컬럼 (이력·액션 제외)
const SORT_COLS: { key: keyof Row; label: string }[] = [
  { key: "vehicle_type",        label: "구분" },
  { key: "user_name",           label: "사용자" },
  { key: "user_dept",           label: "부서" },
  { key: "plate_number",        label: "차량번호" },
  { key: "model",               label: "차종" },
  { key: "fuel_type",           label: "유종" },
  { key: "insurance_company",   label: "보험사" },
  { key: "insurance_end_date",  label: "보험만기" },
];
function compareCell(a: unknown, b: unknown): number {
  return String(a ?? "").localeCompare(String(b ?? ""), "ko", { numeric: true });
}

export default function CompanyVehiclesClient() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<UserMini[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [editing, setEditing] = useState<Row | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [historyOf, setHistoryOf] = useState<Row | null>(null);
  const [sort, setSort] = useState<{ key: keyof Row | null; dir: "asc" | "desc" }>({ key: null, dir: "asc" });
  function toggleSort(key: keyof Row) {
    setSort(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  }

  async function load() {
    setLoading(true);
    const [v, u] = await Promise.all([
      // 모든 구분 포함: 자차·렌트·회사차량·기타 (개인정보수정·사원등록에서 입력된 것 포함)
      supabase.from("user_vehicles").select("*").order("plate_number"),
      supabase.from("accounts").select("id, name:username, dept").eq("status", "재직").order("username"),
    ]);
    const userMap = new Map<number, UserMini>();
    ((u.data ?? []) as UserMini[]).forEach(x => userMap.set(x.id, x));
    setUsers((u.data ?? []) as UserMini[]);
    const enriched: Row[] = ((v.data ?? []) as Vehicle[]).map(r => {
      if (r.user_id === null) return { ...r, user_name: SHARED_USER_LABEL, user_dept: "" };
      const m = userMap.get(r.user_id);
      return { ...r, user_name: m?.name ?? `(ID: ${r.user_id})`, user_dept: m?.dept ?? "" };
    });
    setRows(enriched);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  useReloadOnActivate(() => { void load(); });

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  const admin = isAdmin(user);
  const canRead   = admin || hasMenuPermission(user, MENU_HREF, "read");
  const canCreate = admin || hasMenuPermission(user, MENU_HREF, "create");
  const canUpdate = admin || hasMenuPermission(user, MENU_HREF, "update");

  if (!canRead) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
      </div>
    );
  }

  const filtered = rows
    .filter(r => statusFilter === "all" ? true : r.status === statusFilter)
    .filter(r => {
      if (!search.trim()) return true;
      const s = search.trim().toLowerCase();
      return r.user_name.toLowerCase().includes(s)
        || r.plate_number.toLowerCase().includes(s)
        || r.model.toLowerCase().includes(s)
        || r.user_dept.toLowerCase().includes(s);
    });

  const sorted = sort.key
    ? [...filtered].sort((a, b) => {
        const r = compareCell(a[sort.key!], b[sort.key!]);
        return sort.dir === "asc" ? r : -r;
      })
    : filtered;

  function exportExcel() {
    const fmt = (v: string | null | undefined) => (v ? sharedFormatYmd(v) : "");
    const data = sorted.map((r, i) => ({
      번호:         i + 1,
      구분:         r.vehicle_type,
      사용자:       r.user_name,
      부서:         r.user_dept,
      차량번호:     r.plate_number,
      차종:         r.model,
      연식:         r.year_made ?? "",
      유종:         r.fuel_type,
      등록일:       fmt(r.registration_date),
      보험사:       r.insurance_company ?? "",
      보험시작:     fmt(r.insurance_start_date),
      보험만기:     fmt(r.insurance_end_date),
      운전자연령:   r.driver_age_range ?? "",
      운전자범위:   r.driver_scope ?? "",
      상태:         r.status === "active" ? "활성" : "폐차",
      폐차일:       fmt(r.scrapped_at),
      폐차처리자:   r.scrapped_by_name ?? "",
      폐차사유:     r.scrapped_note ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    // 대략적인 컬럼 폭 지정
    ws["!cols"] = [
      { wch: 5 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 14 },
      { wch: 14 }, { wch: 6 }, { wch: 8 }, { wch: 12 }, { wch: 14 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 6 },
      { wch: 12 }, { wch: 10 }, { wch: 30 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "회사차량현황");
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `회사차량현황_${stamp}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">회사차량관리</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">총 {rows.length}대 (활성 {rows.filter(r => r.status === "active").length}, 폐차 {rows.filter(r => r.status === "scrapped").length})</p>
      </div>

      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {([["active","활성"],["scrapped","폐차"],["all","전체"]] as [StatusFilter, string][]).map(([f, label]) => (
            <button key={f} type="button" onClick={() => setStatusFilter(f)}
              className={`px-3 py-1 text-[11px] font-semibold rounded-full border ${
                statusFilter === f
                  ? "bg-slate-700 text-white border-slate-700"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600"
              }`}>{label}</button>
          ))}
        </div>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="사용자명·부서·차량번호·차종 검색" lang="ko"
          className="flex-1 max-w-md px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs" />
        <button
          type="button"
          onClick={exportExcel}
          disabled={loading || sorted.length === 0}
          title={sorted.length === 0 ? "출력할 데이터가 없습니다" : `${sorted.length}건 엑셀 출력`}
          className="ml-auto px-3 py-1.5 rounded border border-emerald-600 text-emerald-700 dark:text-emerald-300 dark:border-emerald-500 text-xs font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          📊 엑셀 출력
        </button>
        {canCreate && (
          <button type="button" onClick={() => setShowNew(true)}
            className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">+ 회사차량 등록</button>
        )}
      </div>

      <div className="px-6 py-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <tr className="text-center text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  {SORT_COLS.map(c => (
                    <th key={c.key} onClick={() => toggleSort(c.key)}
                      className="px-3 py-2.5 cursor-pointer select-none hover:text-gray-900 dark:hover:text-white">
                      <span className="inline-flex items-center gap-0.5">
                        {c.label}
                        <span className="text-[9px] text-gray-400">
                          {sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-2.5">이력</th>
                  <th className="px-3 py-2.5">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading && <tr><td colSpan={10} className="px-3 py-8 text-center text-xs text-gray-500">로딩 중...</td></tr>}
                {!loading && sorted.length === 0 && (
                  <tr><td colSpan={10} className="px-3 py-12 text-center text-xs text-gray-500">조건에 해당하는 회사차량이 없습니다.</td></tr>
                )}
                {!loading && sorted.map(r => (
                  <tr key={r.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 text-center ${r.status === "scrapped" ? "opacity-60" : ""}`}>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${vehicleTypeBadgeCls(r.vehicle_type)}`}>
                        {r.vehicle_type}
                      </span>
                      {r.status === "scrapped" && (
                        <div className="mt-1 text-[10px] font-bold text-gray-500">폐차</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-semibold text-gray-800 dark:text-gray-100">{r.user_name}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-gray-300">{r.user_dept}</td>
                    <td className="px-3 py-2.5 text-xs font-mono text-gray-700 dark:text-gray-200">{r.plate_number}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-700 dark:text-gray-200">{r.model}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500">{r.fuel_type}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500">{r.insurance_company ?? ""}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 font-mono">{r.insurance_end_date ?? ""}</td>
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={() => setHistoryOf(r)}
                        className="px-2 py-0.5 text-[11px] rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200">
                        📋 이력
                      </button>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {canUpdate && r.status === "active" ? (
                        <button type="button" onClick={() => setEditing(r)}
                          className="px-2 py-0.5 text-[11px] rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200">수정</button>
                      ) : (
                        <span className="text-[11px] text-gray-400">{r.status === "scrapped" ? "폐차됨" : "조회 전용"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showNew && (
        <CreateModal users={users}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }} />
      )}
      {editing && (
        <EditModal users={users} vehicle={editing} actor={user} isAdmin={admin}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
      {historyOf && (
        <HistoryModal vehicle={historyOf} onClose={() => setHistoryOf(null)} />
      )}
    </div>
  );
}

// ============================================================
// 공용 헬퍼
// ============================================================

function vehicleTypeBadgeCls(type: string): string {
  switch (type) {
    case "회사차량": return "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300";
    case "자차":     return "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300";
    case "렌트":     return "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300";
    case "기타":     return "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300";
    default:        return "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300";
  }
}

const formatYmd = sharedFormatYmd;
function addOneYear(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(parseInt(m[1]) + 1, parseInt(m[2]) - 1, parseInt(m[3]));
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function extractStoragePath(publicUrl: string): string | null {
  const marker = `/object/public/${VEHICLE_DOCS_BUCKET}/`;
  const i = publicUrl.indexOf(marker);
  if (i < 0) return null;
  return decodeURIComponent(publicUrl.slice(i + marker.length));
}

async function uploadDoc(file: File, userId: number): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from(VEHICLE_DOCS_BUCKET).upload(path, file, { cacheControl: "3600", upsert: false });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from(VEHICLE_DOCS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

const inputCls = "w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100";
const labelCls = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1";

// ============================================================
// 신규 등록 모달
// ============================================================

function CreateModal({ users, onClose, onSaved }: { users: UserMini[]; onClose: () => void; onSaved: () => void }) {
  const [userText, setUserText] = useState("");
  const [userId, setUserId] = useState<number | null>(null);
  const [plate, setPlate] = useState("");
  const [model, setModel] = useState("");
  const [yearMade, setYearMade] = useState("");
  const [fuel, setFuel] = useState("");
  const [regDate, setRegDate] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [insCompany, setInsCompany] = useState("");
  const [insStart, setInsStart] = useState("");
  const [insEnd, setInsEnd] = useState("");
  const [driverAge, setDriverAge] = useState("");
  const [driverScope, setDriverScope] = useState("");
  const [insDocFile, setInsDocFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    if (userId === null) { setError("사용자를 선택하세요. (공용 차량으로 등록하려면 '공용 차량'을 선택)"); return; }
    if (!plate.trim() || !model.trim() || !fuel) { setError("차량번호·차종·유종은 필수입니다."); return; }
    setSaving(true);
    try {
      const uploadOwnerId = userId === SHARED_USER_ID ? 0 : userId;
      const docUrl    = docFile    ? await uploadDoc(docFile, uploadOwnerId)    : null;
      const insDocUrl = insDocFile ? await uploadDoc(insDocFile, uploadOwnerId) : null;
      const payload = {
        user_id: userId === SHARED_USER_ID ? null : userId, vehicle_type: "회사차량",
        plate_number: plate.trim(), model: model.trim(),
        year_made: yearMade || null, fuel_type: fuel,
        registration_date: regDate || null, registration_doc_url: docUrl,
        insurance_company: insCompany || null,
        insurance_start_date: insStart || null,
        insurance_end_date: insEnd || null,
        driver_age_range: driverAge || null, driver_scope: driverScope || null,
        insurance_doc_url: insDocUrl,
      };
      const { error: e } = await supabase.from("user_vehicles").insert(payload);
      if (e) {
        console.error("[company-vehicle-create] insert error:", e, "payload:", payload);
        throw e;
      }
      onSaved();
    } catch (e) {
      console.error("[company-vehicle-create] save error:", e);
      const msg = e instanceof Error ? e.message : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
      setError(msg);
    } finally { setSaving(false); }
  }

  return (
    <Modal title="회사차량 등록" onClose={onClose} onSave={save} saving={saving} error={error}>
      <div>
        <label className={labelCls}>사용자 * <span className="text-[10px] font-normal text-gray-400">(특정 사용자 없이 공용으로 운용 시 '공용 차량' 선택)</span></label>
        <Combobox<UserMini>
          value={userText}
          onChange={v => {
            setUserText(v);
            if (v === SHARED_USER_LABEL) { setUserId(SHARED_USER_ID); return; }
            const m = users.find(u => v === `${u.name}${u.dept ? ` (${u.dept})` : ""}`);
            setUserId(m?.id ?? null);
          }}
          options={[{ id: SHARED_USER_ID, name: SHARED_USER_LABEL, dept: null }, ...users]}
          getLabel={u => u.id === SHARED_USER_ID ? SHARED_USER_LABEL : `${u.name}${u.dept ? ` (${u.dept})` : ""}`}
          filter={(u, q) => {
            const ql = q.toLowerCase();
            if (u.id === SHARED_USER_ID) return SHARED_USER_LABEL.includes(q) || "공용".includes(q);
            return u.name.toLowerCase().includes(ql) || (u.dept ?? "").toLowerCase().includes(ql);
          }}
          onSelect={u => setUserId(u.id)}
          placeholder="이름·부서 또는 '공용' (↓·↑·Enter)"
          className={inputCls}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>차량번호 *</label><input value={plate} onChange={e => setPlate(e.target.value)} lang="ko" className={inputCls + " font-mono"} /></div>
        <div><label className={labelCls}>차종 *</label><input value={model} onChange={e => setModel(e.target.value)} lang="ko" className={inputCls} /></div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className={labelCls}>년식</label><input value={yearMade} onChange={e => setYearMade(e.target.value.replace(/\D/g, "").slice(0, 4))} maxLength={4} className={inputCls + " font-mono"} /></div>
        <div><label className={labelCls}>유종 *</label>
          <select value={fuel} onChange={e => setFuel(e.target.value)} className={inputCls}>
            <option value="">선택</option><option>가솔린</option><option>디젤</option><option>가스</option><option>전기</option><option>기타</option>
          </select>
        </div>
        <div><label className={labelCls}>차량등록일</label><input value={regDate} onChange={e => setRegDate(formatYmd(e.target.value))} placeholder="YYYYMMDD" maxLength={10} className={inputCls + " font-mono"} /></div>
      </div>
      <FileField label="차량등록증" file={docFile} onChange={setDocFile} />
      <InsuranceFields
        company={insCompany} setCompany={setInsCompany}
        start={insStart} setStart={setInsStart}
        end={insEnd} setEnd={setInsEnd}
        ageRange={driverAge} setAgeRange={setDriverAge}
        scope={driverScope} setScope={setDriverScope}
        docFile={insDocFile} setDocFile={setInsDocFile}
        existingDocUrl={null}
      />
    </Modal>
  );
}

// ============================================================
// 수정 모달 (3 모드: 사용자변경 / 보험정보변경 / 폐차)
// ============================================================

type EditMode = "user" | "insurance" | "scrap" | "delete";

function EditModal({
  users, vehicle, actor, isAdmin, onClose, onSaved,
}: {
  users: UserMini[];
  vehicle: Row;
  actor: { id: number; name: string };
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<EditMode>("user");
  const [note, setNote] = useState("");

  // 사용자 변경
  const [userText, setUserText] = useState(`${vehicle.user_name}${vehicle.user_dept ? ` (${vehicle.user_dept})` : ""}`);
  const [newUserId, setNewUserId] = useState<number | null>(vehicle.user_id === null ? SHARED_USER_ID : vehicle.user_id);

  // 보험 변경
  const [insCompany, setInsCompany] = useState(vehicle.insurance_company ?? "");
  const [insStart, setInsStart] = useState(vehicle.insurance_start_date ?? "");
  const [insEnd, setInsEnd] = useState(vehicle.insurance_end_date ?? "");
  const [driverAge, setDriverAge] = useState(vehicle.driver_age_range ?? "");
  const [driverScope, setDriverScope] = useState(vehicle.driver_scope ?? "");
  const [insDocFile, setInsDocFile] = useState<File | null>(null);
  const [insDocUrl, setInsDocUrl] = useState<string | null>(vehicle.insurance_doc_url);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    setSaving(true);
    try {
      if (mode === "user") {
        if (newUserId === null) { setError("새 사용자를 선택하세요. (공용 차량으로 변경하려면 '공용 차량' 선택)"); return; }
        const finalUserId = newUserId === SHARED_USER_ID ? null : newUserId;
        if (finalUserId === vehicle.user_id) { setError("동일한 사용자입니다."); return; }
        const newUser = finalUserId === null ? null : users.find(u => u.id === finalUserId);
        const { error: e1 } = await supabase.from("user_vehicles").update({ user_id: finalUserId }).eq("id", vehicle.id);
        if (e1) throw e1;
        const { error: e2 } = await supabase.from("vehicle_user_history").insert({
          vehicle_id: vehicle.id,
          prev_user_id: vehicle.user_id,
          prev_user_name: vehicle.user_name,
          new_user_id: finalUserId,
          new_user_name: finalUserId === null ? SHARED_USER_LABEL : (newUser?.name ?? ""),
          changed_by_id: actor.id,
          changed_by_name: actor.name,
          note: note || null,
        });
        if (e2) throw e2;
      } else if (mode === "insurance") {
        let finalDocUrl = insDocUrl;
        if (insDocFile) finalDocUrl = await uploadDoc(insDocFile, vehicle.user_id ?? 0);
        const { error: e1 } = await supabase.from("user_vehicles").update({
          insurance_company: insCompany || null,
          insurance_start_date: insStart || null,
          insurance_end_date: insEnd || null,
          driver_age_range: driverAge || null,
          driver_scope: driverScope || null,
          insurance_doc_url: finalDocUrl,
        }).eq("id", vehicle.id);
        if (e1) throw e1;
        const { error: e2 } = await supabase.from("vehicle_insurance_history").insert({
          vehicle_id: vehicle.id,
          prev_company: vehicle.insurance_company,
          prev_start_date: vehicle.insurance_start_date,
          prev_end_date: vehicle.insurance_end_date,
          prev_age_range: vehicle.driver_age_range,
          prev_scope: vehicle.driver_scope,
          prev_doc_url: vehicle.insurance_doc_url,
          new_company: insCompany || null,
          new_start_date: insStart || null,
          new_end_date: insEnd || null,
          new_age_range: driverAge || null,
          new_scope: driverScope || null,
          new_doc_url: finalDocUrl,
          changed_by_id: actor.id,
          changed_by_name: actor.name,
          note: note || null,
        });
        if (e2) throw e2;
      } else if (mode === "scrap") {
        if (!confirm("폐차 처리하시겠습니까? (이후 활성 목록에서 사라집니다)")) return;
        const { error: e } = await supabase.from("user_vehicles").update({
          status: "scrapped",
          scrapped_at: new Date().toISOString(),
          scrapped_by_id: actor.id,
          scrapped_by_name: actor.name,
          scrapped_note: note || null,
        }).eq("id", vehicle.id);
        if (e) throw e;
      } else if (mode === "delete") {
        if (!isAdmin) { setError("완전삭제는 관리자만 가능합니다."); return; }
        if (!confirm(`[${vehicle.plate_number}] 차량을 완전삭제합니다.\n\n· 차량 정보, 사용자/보험 이력, 첨부 파일이 모두 영구 삭제됩니다.\n· 복구할 수 없습니다.\n\n계속하시겠습니까?`)) return;
        // 1) Storage 첨부 파일 정리 (실패해도 진행)
        const docUrls = [vehicle.registration_doc_url, vehicle.insurance_doc_url].filter(Boolean) as string[];
        for (const url of docUrls) {
          const path = extractStoragePath(url);
          if (path) {
            const { error: se } = await supabase.storage.from(VEHICLE_DOCS_BUCKET).remove([path]);
            if (se) console.warn("[company-vehicle-delete] storage remove failed:", se, path);
          }
        }
        // 2) 차량 레코드 삭제 (이력 테이블은 ON DELETE CASCADE)
        const { error: de } = await supabase.from("user_vehicles").delete().eq("id", vehicle.id);
        if (de) throw de;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }

  return (
    <Modal title={`회사차량 수정 [${vehicle.plate_number}]`} onClose={onClose} onSave={save} saving={saving} error={error}>
      <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-3 text-xs text-gray-600 dark:text-gray-300">
        <div><span className="font-semibold">차량:</span> {vehicle.plate_number} · {vehicle.model} · {vehicle.fuel_type}</div>
        <div><span className="font-semibold">현재 사용자:</span> {vehicle.user_name} {vehicle.user_dept && `(${vehicle.user_dept})`}</div>
      </div>

      <div>
        <label className={labelCls}>변경 유형</label>
        <div className={`grid ${isAdmin ? "grid-cols-4" : "grid-cols-3"} gap-2`}>
          {(([
            ["user","🔄 사용자 변경"],
            ["insurance","🛡️ 보험정보 변경"],
            ["scrap","🚫 폐차 처리"],
            ...(isAdmin ? [["delete","🗑️ 완전삭제"]] as [EditMode, string][] : []),
          ]) as [EditMode, string][]).map(([m, label]) => {
            const isDestructive = m === "scrap" || m === "delete";
            return (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`py-2.5 rounded-lg border-2 text-xs font-bold transition-all ${
                  mode === m
                    ? (isDestructive ? "border-red-500 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                                     : "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300")
                    : "border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400"
                }`}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {mode === "user" && (
        <div>
          <label className={labelCls}>새 사용자 * <span className="text-[10px] font-normal text-gray-400">(공용으로 변경 시 '공용 차량' 선택)</span></label>
          <Combobox<UserMini>
            value={userText}
            onChange={v => {
              setUserText(v);
              if (v === SHARED_USER_LABEL) { setNewUserId(SHARED_USER_ID); return; }
              const m = users.find(u => v === `${u.name}${u.dept ? ` (${u.dept})` : ""}`);
              setNewUserId(m?.id ?? null);
            }}
            options={[{ id: SHARED_USER_ID, name: SHARED_USER_LABEL, dept: null }, ...users]}
            getLabel={u => u.id === SHARED_USER_ID ? SHARED_USER_LABEL : `${u.name}${u.dept ? ` (${u.dept})` : ""}`}
            filter={(u, q) => {
              const ql = q.toLowerCase();
              if (u.id === SHARED_USER_ID) return SHARED_USER_LABEL.includes(q) || "공용".includes(q);
              return u.name.toLowerCase().includes(ql) || (u.dept ?? "").toLowerCase().includes(ql);
            }}
            onSelect={u => setNewUserId(u.id)}
            placeholder="이름·부서 또는 '공용'"
            className={inputCls}
          />
        </div>
      )}

      {mode === "insurance" && (
        <InsuranceFields
          company={insCompany} setCompany={setInsCompany}
          start={insStart} setStart={setInsStart}
          end={insEnd} setEnd={setInsEnd}
          ageRange={driverAge} setAgeRange={setDriverAge}
          scope={driverScope} setScope={setDriverScope}
          docFile={insDocFile} setDocFile={setInsDocFile}
          existingDocUrl={insDocUrl}
          onClearExisting={() => setInsDocUrl(null)}
        />
      )}

      {mode === "scrap" && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-xs text-red-700 dark:text-red-300">
          폐차 처리 시 차량 상태가 <span className="font-bold">[폐차]</span>로 변경되며 활성 목록에서 사라집니다.
          이력은 그대로 보존되며, 필터를 [폐차/전체]로 두면 다시 조회할 수 있습니다.
        </div>
      )}

      {mode === "delete" && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg p-3 text-xs text-red-700 dark:text-red-300 space-y-1">
          <div className="font-bold text-sm">⚠️ 완전삭제 (복구 불가)</div>
          <div>차량 정보, 사용자/보험 변경 이력, 등록증·보험증권 첨부 파일이 모두 영구 삭제됩니다.</div>
          <div>일반적으로는 <span className="font-bold">[폐차 처리]</span>를 권장합니다. 잘못 등록된 데이터를 정리할 때만 사용하세요.</div>
        </div>
      )}

      <div>
        <label className={labelCls}>변경 사유 / 비고</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} lang="ko"
          placeholder="이력에 함께 기록됩니다 (선택)"
          className={inputCls + " resize-none"} />
      </div>
    </Modal>
  );
}

// ============================================================
// 이력 보기 모달
// ============================================================

interface UserHistRow {
  id: number;
  prev_user_name: string | null;
  new_user_name: string | null;
  changed_at: string;
  changed_by_name: string | null;
  note: string | null;
}
interface InsHistRow {
  id: number;
  prev_company: string | null;
  prev_start_date: string | null;
  prev_end_date: string | null;
  new_company: string | null;
  new_start_date: string | null;
  new_end_date: string | null;
  changed_at: string;
  changed_by_name: string | null;
  note: string | null;
}

function HistoryModal({ vehicle, onClose }: { vehicle: Row; onClose: () => void }) {
  const [tab, setTab] = useState<"user" | "insurance">("user");
  const [userHist, setUserHist] = useState<UserHistRow[]>([]);
  const [insHist, setInsHist] = useState<InsHistRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [u, i] = await Promise.all([
        supabase.from("vehicle_user_history").select("*").eq("vehicle_id", vehicle.id).order("changed_at", { ascending: false }),
        supabase.from("vehicle_insurance_history").select("*").eq("vehicle_id", vehicle.id).order("changed_at", { ascending: false }),
      ]);
      setUserHist((u.data ?? []) as UserHistRow[]);
      setInsHist((i.data ?? []) as InsHistRow[]);
      setLoading(false);
    })();
  }, [vehicle.id]);

  function fmt(iso: string) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  }

  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-full max-w-2xl max-h-[90vh]"
      z={60}
      header={
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <div className="text-base font-bold text-gray-900 dark:text-white">변경 이력</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{vehicle.plate_number} · {vehicle.model}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
      }
    >
        <div className="px-5 border-b border-gray-200 dark:border-gray-700">
          <div className="flex gap-1">
            {([["user", `👤 사용자 (${userHist.length})`],["insurance", `🛡️ 보험 (${insHist.length})`]] as [typeof tab, string][]).map(([t, label]) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={`py-2.5 px-3 text-sm font-semibold border-b-2 transition-colors ${
                  tab === t ? "text-blue-600 dark:text-blue-400 border-blue-500"
                            : "text-gray-500 dark:text-gray-400 border-transparent"
                }`}>{label}</button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {loading && <div className="text-center text-xs text-gray-500 py-6">로딩 중...</div>}

          {!loading && tab === "user" && (userHist.length === 0
            ? <div className="text-center text-xs text-gray-500 py-6">사용자 변경 이력이 없습니다.</div>
            : userHist.map(h => (
                <div key={h.id} className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-3 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-gray-700 dark:text-gray-200">{fmt(h.changed_at)}</span>
                    {h.changed_by_name && <span className="text-gray-500 dark:text-gray-400">처리자: {h.changed_by_name}</span>}
                  </div>
                  <div className="text-gray-700 dark:text-gray-200">
                    <span className="text-gray-400">{h.prev_user_name ?? "(없음)"}</span> → <span className="font-semibold text-blue-600 dark:text-blue-400">{h.new_user_name ?? "(없음)"}</span>
                  </div>
                  {h.note && <div className="text-gray-500 dark:text-gray-400 mt-1">📝 {h.note}</div>}
                </div>
              )))}

          {!loading && tab === "insurance" && (insHist.length === 0
            ? <div className="text-center text-xs text-gray-500 py-6">보험 변경 이력이 없습니다.</div>
            : insHist.map(h => (
                <div key={h.id} className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-3 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-gray-700 dark:text-gray-200">{fmt(h.changed_at)}</span>
                    {h.changed_by_name && <span className="text-gray-500 dark:text-gray-400">처리자: {h.changed_by_name}</span>}
                  </div>
                  <div className="space-y-0.5 text-gray-700 dark:text-gray-200">
                    <div>보험사: <span className="text-gray-400">{h.prev_company ?? "-"}</span> → <span className="font-semibold text-blue-600 dark:text-blue-400">{h.new_company ?? "-"}</span></div>
                    <div>가입~만기: <span className="text-gray-400">{h.prev_start_date ?? "-"} ~ {h.prev_end_date ?? "-"}</span> → <span className="font-semibold text-blue-600 dark:text-blue-400">{h.new_start_date ?? "-"} ~ {h.new_end_date ?? "-"}</span></div>
                  </div>
                  {h.note && <div className="text-gray-500 dark:text-gray-400 mt-1">📝 {h.note}</div>}
                </div>
              )))}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">닫기</button>
        </div>
    </DraggableModal>
  );
}

// ============================================================
// 공용 모달 + 보험 필드 + 파일 필드
// ============================================================

function Modal({ title, children, onClose, onSave, saving, error }: {
  title: string; children: React.ReactNode; onClose: () => void; onSave: () => void; saving: boolean; error: string;
}) {
  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-full max-w-2xl max-h-[90vh]"
      header={
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-base font-bold text-gray-900 dark:text-white">{title}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
      }
    >
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {children}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 text-xs px-3 py-2 rounded">{error}</div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">취소</button>
          <button type="button" onClick={onSave} disabled={saving}
            className="px-4 py-2 rounded text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
    </DraggableModal>
  );
}

function FileField({ label, file, onChange }: { label: string; file: File | null; onChange: (f: File | null) => void }) {
  const id = `file-${label.replace(/\s/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
  return (
    <div>
      <label className={labelCls}>{label} (이미지·PDF, 최대 10MB)</label>
      <div className="flex items-center gap-2">
        <input id={id} type="file" accept="image/*,application/pdf" onChange={e => onChange(e.target.files?.[0] ?? null)} className="hidden" />
        <label htmlFor={id} className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold cursor-pointer hover:bg-blue-700">📁 파일 선택</label>
        <span className="text-xs text-gray-600 dark:text-gray-300 truncate flex-1">{file ? file.name : "선택된 파일 없음"}</span>
        {file && <button type="button" onClick={() => onChange(null)} className="text-xs text-red-500">지우기</button>}
      </div>
    </div>
  );
}

function InsuranceFields({
  company, setCompany, start, setStart, end, setEnd,
  ageRange, setAgeRange, scope, setScope,
  docFile, setDocFile, existingDocUrl, onClearExisting,
}: {
  company: string; setCompany: (v: string) => void;
  start: string; setStart: (v: string) => void;
  end: string; setEnd: (v: string) => void;
  ageRange: string; setAgeRange: (v: string) => void;
  scope: string; setScope: (v: string) => void;
  docFile: File | null; setDocFile: (f: File | null) => void;
  existingDocUrl: string | null;
  onClearExisting?: () => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 bg-gray-50 dark:bg-gray-700/30">
      <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200 mb-2">🛡️ 차량보험 정보</div>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div><label className={labelCls}>보험사</label><input value={company} onChange={e => setCompany(e.target.value)} lang="ko" className={inputCls} /></div>
          <div>
            <label className={labelCls}>가입일시</label>
            <input value={start} onChange={e => {
              const v = formatYmd(e.target.value); setStart(v);
              if (v.length === 10) { const n = addOneYear(v); if (n) setEnd(n); }
            }} placeholder="YYYYMMDD" maxLength={10} className={inputCls + " font-mono"} />
          </div>
          <div>
            <label className={labelCls}>만기일시 <span className="text-[10px] text-gray-400">(가입+1년 자동)</span></label>
            <input value={end} onChange={e => setEnd(formatYmd(e.target.value))} placeholder="YYYYMMDD" maxLength={10} className={inputCls + " font-mono"} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>운전자 연령</label>
            <select value={ageRange} onChange={e => setAgeRange(e.target.value)} className={inputCls}>
              <option value="">선택</option>
              <option>모든 연령</option><option>만 21세 이상</option><option>만 24세 이상</option>
              <option>만 26세 이상</option><option>만 30세 이상</option><option>만 35세 이상</option>
              <option>만 43세 이상</option><option>만 48세 이상</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>운전자 범위</label>
            <select value={scope} onChange={e => setScope(e.target.value)} className={inputCls}>
              <option value="">선택</option>
              <option>누구나</option><option>본인 한정</option><option>본인+배우자</option>
              <option>가족 한정</option><option>1인 한정</option><option>임직원</option>
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>보험증권 (이미지·PDF, 최대 10MB)</label>
          <div className="flex items-center gap-2">
            <input id="ins-doc-input-shared" type="file" accept="image/*,application/pdf"
              onChange={e => setDocFile(e.target.files?.[0] ?? null)} className="hidden" />
            <label htmlFor="ins-doc-input-shared" className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold cursor-pointer hover:bg-blue-700 whitespace-nowrap">📁 파일 선택</label>
            {existingDocUrl && !docFile && (
              <a href={existingDocUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">현재 파일 보기</a>
            )}
            <span className="text-xs text-gray-600 dark:text-gray-300 truncate flex-1">
              {docFile ? docFile.name : (existingDocUrl ? "기존 파일 등록됨" : "선택된 파일 없음")}
            </span>
            {(docFile || existingDocUrl) && (
              <button type="button"
                onClick={() => { setDocFile(null); onClearExisting?.(); }}
                className="text-xs text-red-500">지우기</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
