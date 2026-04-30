"use client";

import { useState, FormEvent, useMemo } from "react";
import * as XLSX from "xlsx";
import { SiteRecord } from "@/lib/mock-sites";
import { ElevatorRecord } from "@/lib/mock-elevators";
import { useAuth, isViewOnly } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { api, getErrorMessage } from "@/lib/api-client";

// ── 배지 ────────────────────────────────────────────────────────
const COMPANY_STYLES: Record<string, string> = {
  TKE: "bg-blue-50 text-blue-600 border border-blue-100",
  DS:  "bg-emerald-50 text-emerald-700 border border-emerald-100",
};
const COMPANY_STYLES_DARK: Record<string, string> = {
  TKE: "bg-blue-900/60 text-blue-300 border border-blue-800",
  DS:  "bg-emerald-900/60 text-emerald-300 border border-emerald-800",
};
function companyBadge(type: string | null, dark = false) {
  const styles = dark ? COMPANY_STYLES_DARK : COMPANY_STYLES;
  const style = (type && styles[type]) ?? (dark ? "bg-gray-700 text-gray-300 border border-gray-600" : "bg-gray-100 text-gray-500 border border-gray-200");
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${style}`}>{type ?? "기타"}</span>;
}

// ── 호기 등록/수정 모달 ───────────────────────────────────────

interface ElevatorFormModalProps {
  siteName: string;
  editElevator: ElevatorRecord | null;
  onClose: () => void;
  onSaved: () => void;
}

function ElevatorFormModal({ siteName, editElevator, onClose, onSaved }: ElevatorFormModalProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const fieldCls = `w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${isDark ? "border-gray-600 bg-gray-700 text-gray-100 placeholder:text-gray-400" : "border-gray-200 bg-white text-gray-900"}`;
  const labelCls = `block text-xs font-medium mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`;
  const isEdit = !!editElevator;
  const [unitName,   setUnitName]   = useState(editElevator?.unitName   ?? "");
  const [elevatorNo, setElevatorNo] = useState(editElevator?.elevatorNo ?? "");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!unitName.trim()) { setError("호기명을 입력해 주세요."); return; }
    setSaving(true);
    const body = { siteName, unitName: unitName.trim(), elevatorNo: elevatorNo.trim() || null };
    try {
      if (isEdit) await api.patch(`/api/elevators/${editElevator!.id}`, body);
      else        await api.post("/api/elevators", body);
      onSaved();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className={`rounded-2xl shadow-xl w-full max-w-sm mx-4 ${isDark ? "bg-gray-800" : "bg-white"}`} onClick={e => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}>
          <h2 className={`text-base font-semibold ${isDark ? "text-gray-100" : "text-gray-800"}`}>{isEdit ? "호기 수정" : "호기 등록"}</h2>
          <button onClick={onClose} className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg transition-colors ${isDark ? "text-gray-400 hover:bg-gray-700 hover:text-gray-200" : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"}`}>×</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className={labelCls}>현장명</label>
            <input value={siteName} readOnly className={fieldCls + (isDark ? " !bg-gray-900/40 !text-gray-400" : " !bg-gray-50 !text-gray-500")} />
          </div>
          <div>
            <label className={labelCls}>호기명 <span className="text-red-500">*</span></label>
            <input value={unitName} onChange={e => setUnitName(e.target.value)} placeholder="예: 1호기" required className={fieldCls} />
          </div>
          <div>
            <label className={labelCls}>승강기 번호</label>
            <input value={elevatorNo} onChange={e => setElevatorNo(e.target.value)} placeholder="예: 2163209" className={fieldCls} />
          </div>
          {error && <p className={`text-sm text-red-500 rounded-lg px-3 py-2 ${isDark ? "bg-red-900/30" : "bg-red-50"}`}>{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className={`flex-1 rounded-lg border py-2.5 text-sm font-medium transition-colors ${isDark ? "border-gray-600 text-gray-300 hover:bg-gray-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
              취소
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? "저장 중..." : isEdit ? "수정 저장" : "등록"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── 현장 등록 모달 ─────────────────────────────────────────────

interface AddSiteModalProps { onClose: () => void; onSaved: () => void; editSite?: SiteRecord; }

function AddSiteModal({ onClose, onSaved, editSite }: AddSiteModalProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const fieldCls = `w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${isDark ? "border-gray-600 bg-gray-700 text-gray-100 placeholder:text-gray-400" : "border-gray-200 bg-white text-gray-900"}`;
  const labelCls = `block text-xs font-medium mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`;
  const isEdit = !!editSite;
  const [name,             setName]             = useState(editSite?.name ?? "");
  const [companyType,      setCompanyType]       = useState(editSite?.companyType ?? "TKE");
  const [contractType,     setContractType]      = useState(editSite?.contractType ?? "");
  const [contractDate,     setContractDate]      = useState(editSite?.contractDate ?? "");
  const [contractStart,    setContractStart]     = useState(editSite?.contractStart ?? "");
  const [contractEnd,      setContractEnd]       = useState(editSite?.contractEnd ?? "");
  const [primaryInspector, setPrimaryInspector]  = useState(editSite?.primaryInspector ?? "");
  const [subInspector,     setSubInspector]      = useState(editSite?.subInspector ?? "");
  const [subInspector2,    setSubInspector2]     = useState(editSite?.subInspector2 ?? "");
  const [sitePhone,        setSitePhone]         = useState(editSite?.sitePhone ?? "");
  const [siteMobile,       setSiteMobile]        = useState(editSite?.siteMobile ?? "");
  const [fax]                                     = useState(editSite?.fax ?? "");
  const [managerPhone,     setManagerPhone]      = useState(editSite?.managerPhone ?? "");
  const [managerEmail,     setManagerEmail]      = useState(editSite?.managerEmail ?? "");
  const [address,          setAddress]           = useState(editSite?.address ?? "");
  const [postalCode,       setPostalCode]        = useState("");
  const [vendor,           setVendor]            = useState(editSite?.vendor ?? "");
  const [entryInfo]                              = useState(editSite?.entryInfo ?? "");
  const [note,             setNote]              = useState(editSite?.note ?? "");
  const [warrantyCount,    setWarrantyCount]     = useState<string>(editSite?.warrantyCount != null ? String(editSite.warrantyCount) : "");
  const [warrantyUnits,    setWarrantyUnits]     = useState(editSite?.warrantyUnits ?? "");
  const [warrantyStart,    setWarrantyStart]     = useState(editSite?.warrantyStart ?? "");
  const [warrantyEnd,      setWarrantyEnd]       = useState(editSite?.warrantyEnd ?? "");
  const [emergencyDevices, setEmergencyDevices]  = useState(
    editSite?.emergencyDevices?.length ? editSite.emergencyDevices : [{ number: "", note: "" }]
  );
  const [saving,           setSaving]            = useState(false);
  const [error,            setError]             = useState("");

  function searchAddress() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const daum = (window as any).daum;
    if (!daum?.Postcode) { alert("주소 검색 서비스를 불러오는 중입니다. 잠시 후 다시 시도해 주세요."); return; }
    new daum.Postcode({
      oncomplete(data: { roadAddress: string; jibunAddress: string; zonecode: string }) {
        setAddress(data.roadAddress || data.jibunAddress);
        setPostalCode(data.zonecode);
      },
    }).open();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("현장명을 입력해 주세요."); return; }
    setSaving(true);
    const body = {
      name, companyType: companyType || null, contractType: contractType || null,
      contractDate: contractDate || null, contractStart: contractStart || null,
      contractEnd: contractEnd || null, primaryInspector: primaryInspector || null,
      subInspector: subInspector || null, subInspector2: subInspector2 || null, sitePhone: sitePhone || null,
      siteMobile: siteMobile || null, fax: fax || null,
      managerPhone: managerPhone || null, managerEmail: managerEmail || null,
      address: address || null, entryInfo: entryInfo || null,
      vendor: vendor || null, customerEmail: null, jobNo: null, note: note || null,
      emergencyDevice: null,
      emergencyDevices: emergencyDevices.filter(d => d.number.trim()),
      warrantyCount: warrantyCount !== "" ? Number(warrantyCount) : null,
      warrantyUnits: warrantyUnits || null,
      warrantyStart: warrantyStart || null,
      warrantyEnd: warrantyEnd || null,
    };
    try {
      if (isEdit) await api.patch(`/api/sites/${editSite!.id}`, body);
      else        await api.post("/api/sites", body);
      onSaved();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className={`rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col ${isDark ? "bg-gray-800" : "bg-white"}`} onClick={e => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-6 py-4 border-b shrink-0 ${isDark ? "border-gray-700" : "border-gray-200"}`}>
          <h2 className={`text-base font-semibold ${isDark ? "text-gray-100" : "text-gray-800"}`}>{isEdit ? "현장 수정" : "현장 등록"}</h2>
          <button onClick={onClose} className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg transition-colors ${isDark ? "text-gray-400 hover:bg-gray-700 hover:text-gray-200" : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"}`}>×</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-3 overflow-y-auto flex-1">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>현장명 <span className="text-red-500">*</span></label>
              <input value={name} onChange={e => setName(e.target.value)} required className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>회사구분</label>
              <select value={companyType} onChange={e => setCompanyType(e.target.value)} className={fieldCls}>
                <option value="TKE">TKE</option>
                <option value="DS">DS</option>
                <option value="">기타</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>계약구분</label>
              <input value={contractType} onChange={e => setContractType(e.target.value)} placeholder="유지보수, 하자 등" className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>계약일자</label>
              <input type="date" value={contractDate} onChange={e => setContractDate(e.target.value)} className={fieldCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>계약시작</label>
              <input type="date" value={contractStart} onChange={e => setContractStart(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>계약만료</label>
              <input type="date" value={contractEnd} onChange={e => setContractEnd(e.target.value)} className={fieldCls} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>주점검자</label>
              <input value={primaryInspector} onChange={e => setPrimaryInspector(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>보조점검자1</label>
              <input value={subInspector} onChange={e => setSubInspector(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>보조점검자2</label>
              <input value={subInspector2} onChange={e => setSubInspector2(e.target.value)} className={fieldCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>현장전화</label>
              <input value={sitePhone} onChange={e => setSitePhone(e.target.value)} placeholder="031-000-0000" className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>현장핸드폰</label>
              <input value={siteMobile} onChange={e => setSiteMobile(e.target.value)} placeholder="010-0000-0000" className={fieldCls} />
            </div>
          </div>
          {/* 비상통화장치 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls}>비상통화장치</label>
              <button type="button"
                onClick={() => setEmergencyDevices(prev => [...prev, { number: "", note: "" }])}
                className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${isDark ? "bg-gray-700 text-gray-300 hover:bg-gray-600" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                + 추가
              </button>
            </div>
            <div className="space-y-2">
              {emergencyDevices.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={d.number}
                    onChange={e => setEmergencyDevices(prev => prev.map((x, j) => j === i ? { ...x, number: e.target.value } : x))}
                    placeholder="전화번호" className={`${fieldCls} w-36 shrink-0`} />
                  <input value={d.note}
                    onChange={e => setEmergencyDevices(prev => prev.map((x, j) => j === i ? { ...x, note: e.target.value } : x))}
                    placeholder="비고 (예: 1~3호기)" className={`${fieldCls} flex-1`} />
                  {emergencyDevices.length > 1 && (
                    <button type="button"
                      onClick={() => setEmergencyDevices(prev => prev.filter((_, j) => j !== i))}
                      className={`text-xl hover:text-red-400 ${isDark ? "text-gray-500" : "text-gray-300"}`}>×</button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>담당자 HP</label>
              <input value={managerPhone} onChange={e => setManagerPhone(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>담당자 메일</label>
              <input type="email" value={managerEmail} onChange={e => setManagerEmail(e.target.value)} className={fieldCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>소재지 (도로명주소)</label>
            <div className="flex gap-2">
              <input value={address} onChange={e => setAddress(e.target.value)}
                placeholder="도로명주소 검색 또는 직접 입력" className={`${fieldCls} flex-1`} />
              <button type="button" onClick={searchAddress}
                className={`shrink-0 px-3 py-2 rounded-lg border text-xs whitespace-nowrap transition-colors ${isDark ? "border-gray-600 text-gray-300 hover:bg-gray-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                🔍 주소 검색
              </button>
            </div>
            {postalCode && <p className={`mt-1 text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>우편번호: {postalCode}</p>}
          </div>
          {/* 하자 정보 */}
          <div className={`border-t pt-3 ${isDark ? "border-gray-700" : "border-gray-200"}`}>
            <p className={`text-xs font-semibold uppercase tracking-wide mb-2.5 ${isDark ? "text-gray-500" : "text-gray-500"}`}>하자 정보</p>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>하자기 대수</label>
                  <input type="number" min={0} value={warrantyCount} onChange={e => setWarrantyCount(e.target.value)} placeholder="0" className={fieldCls} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>하자기 호기정보</label>
                  <input value={warrantyUnits} onChange={e => setWarrantyUnits(e.target.value)} placeholder="예: 1호기, 3호기" className={fieldCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>하자기간 시작</label>
                  <input type="date" value={warrantyStart} onChange={e => setWarrantyStart(e.target.value)} className={fieldCls} />
                </div>
                <div>
                  <label className={labelCls}>하자기간 종료</label>
                  <input type="date" value={warrantyEnd} onChange={e => setWarrantyEnd(e.target.value)} className={fieldCls} />
                </div>
              </div>
            </div>
          </div>
          <div>
            <label className={labelCls}>거래처</label>
            <input value={vendor} onChange={e => setVendor(e.target.value)} className={fieldCls} />
          </div>
          <div>
            <label className={labelCls}>비고</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={5}
              className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none ${isDark ? "border-gray-600 bg-gray-700 text-gray-100 placeholder:text-gray-400" : "border-gray-200 bg-white text-gray-800"}`} />
          </div>
          {error && <p className={`text-sm text-red-500 rounded-lg px-4 py-2.5 ${isDark ? "bg-red-900/30" : "bg-red-50"}`}>{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className={`flex-1 rounded-lg border py-2.5 text-sm font-medium transition-colors ${isDark ? "border-gray-600 text-gray-300 hover:bg-gray-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
              취소
            </button>
            <button type="submit" disabled={saving || !name.trim()}
              className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? "저장 중..." : isEdit ? "수정 저장" : "현장 등록"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── 상세 행 ────────────────────────────────────────────────────
function InfoRow({ label, value, dark = false }: { label: string; value: string | null | undefined; dark?: boolean }) {
  return (
    <div className={`flex items-start gap-3 py-2 border-b last:border-0 ${dark ? "border-gray-700" : "border-gray-50"}`}>
      <span className={`text-xs w-24 shrink-0 pt-0.5 ${dark ? "text-gray-500" : "text-gray-400"}`}>{label}</span>
      <span className={`text-sm flex-1 ${dark ? "text-gray-200" : "text-gray-800"}`}>{value || "—"}</span>
    </div>
  );
}

// ── 메인 컴포넌트 ───────────────────────────────────────────────
interface Props {
  initial: SiteRecord[];
  elevators: ElevatorRecord[];
}

const INITIAL_SHOW = 25;

export default function SitesClient({ initial, elevators }: Props) {
  const [sites, setSites]       = useState(initial);
  const [allElevators, setAllElevators] = useState(elevators);
  const [query, setQuery]       = useState("");
  const [companyFilter, setCompanyFilter] = useState<"전체" | "TKE" | "DS">("전체");
  const [selected, setSelected] = useState<SiteRecord | null>(null);
  const [showAdd, setShowAdd]   = useState(false);
  const [editTarget, setEditTarget] = useState<SiteRecord | null>(null);
  // 호기 CRUD
  const [showElevatorForm, setShowElevatorForm]     = useState(false);
  const [editElevator, setEditElevator]             = useState<ElevatorRecord | null>(null);
  const [deleteElevatorTarget, setDeleteElevatorTarget] = useState<ElevatorRecord | null>(null);

  const { user } = useAuth();
  const viewOnly = user ? isViewOnly(user) : true;
  const canEdit  = user ? !viewOnly : false;

  const q = query.trim().toLowerCase();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  // 승강기번호로 매칭되는 현장명 Set (검색어 있을 때만 계산)
  const elevatorMatchSites = useMemo(() => {
    if (!q) return new Set<string>();
    const matched = new Set<string>();
    for (const e of allElevators) {
      if (e.elevatorNo?.toLowerCase().includes(q)) {
        matched.add(e.siteName);
      }
    }
    return matched;
  }, [allElevators, q]);

  const displaySites = useMemo(() => {
    const byCompany = companyFilter !== "전체" ? sites.filter(s => s.companyType === companyFilter) : sites;
    if (!q) return byCompany.slice(0, INITIAL_SHOW);
    return byCompany.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.primaryInspector?.toLowerCase().includes(q) ?? false) ||
      (s.subInspector?.toLowerCase().includes(q) ?? false) ||
      (s.subInspector2?.toLowerCase().includes(q) ?? false) ||
      (s.address?.toLowerCase().includes(q) ?? false) ||
      (s.companyType?.toLowerCase().includes(q) ?? false) ||
      (s.vendor?.toLowerCase().includes(q) ?? false) ||
      // 비상통화장치번호
      (s.emergencyDevice?.toLowerCase().includes(q) ?? false) ||
      (s.emergencyDevices?.some(d => d.number.toLowerCase().includes(q)) ?? false) ||
      // 승강기번호
      elevatorMatchSites.has(s.name)
    );
  }, [sites, q, elevatorMatchSites, companyFilter]);

  const selectedElevators = useMemo(() =>
    selected ? allElevators.filter(e => e.siteName === selected.name) : [],
    [allElevators, selected]
  );

  function downloadExcel() {
    const list = q ? displaySites : sites;
    const rows = list.map(s => ({
      현장명: s.name, 회사구분: s.companyType ?? "", 계약구분: s.contractType ?? "",
      계약일자: s.contractDate ?? "", 계약시작: s.contractStart ?? "", 계약만료: s.contractEnd ?? "",
      주점검자: s.primaryInspector ?? "", 보조점검자1: s.subInspector ?? "", 보조점검자2: s.subInspector2 ?? "",
      현장전화: s.sitePhone ?? "", 현장핸드폰: s.siteMobile ?? "",
      담당자HP: s.managerPhone ?? "", 소재지: s.address ?? "",
      거래처: s.vendor ?? "", 호기수: elevators.filter(e => e.siteName === s.name).length,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "현장목록");
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `현장목록_${stamp}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  }

  async function reload() {
    const updated = await api.get<SiteRecord[]>("/api/sites").catch(() => null);
    if (!updated) { alert("현장 목록 조회에 실패했습니다."); return; }
    setSites(updated);
    setShowAdd(false);
    if (editTarget) {
      const refreshed = updated.find(s => s.id === editTarget.id) ?? null;
      setSelected(refreshed);
      setEditTarget(null);
    }
  }

  async function reloadElevators(siteName: string) {
    const updated = await api.get<ElevatorRecord[]>(`/api/elevators?site=${encodeURIComponent(siteName)}`).catch(() => [] as ElevatorRecord[]);
    setAllElevators(prev => [
      ...prev.filter(e => e.siteName !== siteName),
      ...updated,
    ]);
    setShowElevatorForm(false);
    setEditElevator(null);
    setDeleteElevatorTarget(null);
  }

  async function handleDeleteElevator(e: ElevatorRecord) {
    try {
      await api.delete(`/api/elevators/${e.id}`);
      if (selected) reloadElevators(selected.name);
    } catch (err) {
      alert(getErrorMessage(err));
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 상단 헤더 */}
      <div className="shrink-0 px-6 py-4 bg-white border-b border-gray-200 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-base font-semibold text-gray-800">현장/호기 관리</h1>
          <p className="text-xs text-gray-500 mt-0.5">현장 목록 조회 및 호기 정보 관리</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={downloadExcel}
            className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5">
            <span className="text-xs">📥</span> 엑셀 다운로드
          </button>
          {canEdit && (
            <button onClick={() => setShowAdd(true)}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-1.5">
              + 현장 등록
            </button>
          )}
        </div>
      </div>

      {/* 좌우 분할 패널 */}
      <div className="flex flex-1 min-h-0">

        {/* ── 좌측: 현장 목록 ─────────────────────────────────── */}
        <div className={`w-80 xl:w-96 shrink-0 flex flex-col border-r transition-colors ${isDark ? "border-gray-700 bg-gray-900" : "border-gray-200 bg-white"}`}>
          {/* 검색 */}
          <div className={`shrink-0 p-3 border-b transition-colors ${isDark ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-200"}`}>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="현장명, 점검자, 소재지, 비상통화장치, 승강기번호 검색"
                className={`w-full pl-9 pr-8 py-2 rounded-lg border text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 ${isDark ? "border-gray-600 bg-gray-700 text-white focus:ring-gray-500" : "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:ring-blue-400"}`}
              />
              {query && (
                <button onClick={() => { setQuery(""); setSelected(null); }}
                  className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-lg leading-none ${isDark ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"}`}>×</button>
              )}
            </div>
            <div className="mt-2 flex gap-1 p-1 bg-gray-100 rounded-xl">
              {(["전체", "TKE", "DS"] as const).map(t => (
                <button key={t} type="button" onClick={() => setCompanyFilter(t)}
                  className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    companyFilter === t
                      ? t === "전체" ? "bg-gray-900 text-white shadow-sm"
                        : t === "DS" ? "bg-emerald-600 text-white shadow-sm"
                        : "bg-blue-600 text-white shadow-sm"
                      : isDark ? "text-gray-400 hover:text-gray-200" : "text-gray-400 hover:text-gray-600"
                  }`}>{t}</button>
              ))}
            </div>
            <p className={`mt-1.5 text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>
              {q
                ? `검색 결과 ${displaySites.length}건`
                : companyFilter !== "전체"
                  ? `${companyFilter} ${displaySites.length.toLocaleString()}건`
                  : `전체 ${sites.length.toLocaleString()}건 중 ${Math.min(INITIAL_SHOW, sites.length)}건 표시`}
            </p>
          </div>

          {/* 현장 리스트 */}
          <div className="flex-1 overflow-y-auto">
            {displaySites.length === 0 ? (
              <div className={`flex flex-col items-center justify-center py-16 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                <p className="text-3xl mb-2">🏢</p>
                <p className="text-sm">{q ? "검색 결과가 없습니다" : "검색어를 입력하세요"}</p>
              </div>
            ) : (
              displaySites.map(site => {
                const unitCount = elevators.filter(e => e.siteName === site.name).length;
                const isSelected = selected?.id === site.id;
                return (
                  <button
                    key={site.id}
                    onClick={() => setSelected(isSelected ? null : site)}
                    className={`w-full text-left px-4 py-3 transition-colors ${isDark ? "border-b border-gray-700" : "border-b border-gray-50"} ${
                      isSelected
                        ? isDark ? "bg-gray-700 border-l-2 border-l-gray-400" : "bg-blue-50 border-l-2 border-l-blue-500"
                        : isDark ? "hover:bg-gray-800 border-l-2 border-l-transparent" : "hover:bg-gray-50 border-l-2 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium truncate ${isSelected ? isDark ? "text-white" : "text-blue-700" : isDark ? "text-gray-200" : "text-gray-800"}`}>
                          {site.name}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {companyBadge(site.companyType, isDark)}
                          {site.primaryInspector && (
                            <span className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>{site.primaryInspector}</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {unitCount > 0 ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isDark ? "bg-gray-600 text-gray-200" : "bg-slate-100 text-slate-600"}`}>
                            {unitCount}대
                          </span>
                        ) : (
                          <span className={`text-xs ${isDark ? "text-gray-600" : "text-gray-300"}`}>호기 없음</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── 우측: 현장 상세 + 호기 목록 ──────────────────────── */}
        <div className={`flex-1 overflow-y-auto transition-colors ${isDark ? "bg-gray-900" : "bg-gray-50"}`}>
          {!selected ? (
            <div className={`flex flex-col items-center justify-center h-full min-h-64 ${isDark ? "text-gray-600" : "text-gray-400"}`}>
              <p className="text-5xl mb-4">🏙️</p>
              <p className={`text-base font-medium ${isDark ? "text-gray-500" : "text-gray-500"}`}>현장을 선택하세요</p>
              <p className="text-sm mt-1">좌측 목록에서 현장을 클릭하면 상세 정보가 표시됩니다</p>
            </div>
          ) : (
            <div className="p-6 space-y-5">
              {/* 현장 헤더 */}
              <div className={`rounded-xl border p-5 transition-colors ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{selected.name}</h2>
                      {companyBadge(selected.companyType, isDark)}
                      {selected.contractType && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${isDark ? "bg-gray-700 text-gray-300 border-gray-600" : "bg-gray-100 text-gray-600 border-gray-200"}`}>
                          {selected.contractType}
                        </span>
                      )}
                    </div>
                    {selected.address && (
                      <p className={`text-sm mt-1.5 flex items-center gap-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                        <span>📍</span>{selected.address}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canEdit && (
                      <button onClick={() => setEditTarget(selected)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDark ? "bg-blue-900/40 text-blue-300 hover:bg-blue-900/60" : "bg-blue-50 text-blue-600 hover:bg-blue-100"}`}>
                        수정
                      </button>
                    )}
                    <button onClick={() => setSelected(null)}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${isDark ? "hover:bg-gray-700 text-gray-500 hover:text-gray-300" : "hover:bg-gray-100 text-gray-400 hover:text-gray-600"}`}>
                      ×
                    </button>
                  </div>
                </div>
              </div>

              {/* 현장 정보 그리드 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* 계약 정보 */}
                <div className={`rounded-xl border p-4 transition-colors ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}>
                  <h3 className={`text-xs font-semibold uppercase tracking-wide mb-3 ${isDark ? "text-gray-400" : "text-gray-500"}`}>계약 정보</h3>
                  <InfoRow label="계약구분"   value={selected.contractType} dark={isDark} />
                  <InfoRow label="계약일자"   value={selected.contractDate} dark={isDark} />
                  <InfoRow label="계약기간"   value={
                    selected.contractStart || selected.contractEnd
                      ? `${selected.contractStart ?? ""} ~ ${selected.contractEnd ?? ""}`
                      : null
                  } dark={isDark} />
                  <InfoRow label="하자종료"   value={selected.warrantyEnd} dark={isDark} />
                  <InfoRow label="거래처"     value={selected.vendor} dark={isDark} />
                  <InfoRow label="비고"       value={selected.note} dark={isDark} />
                </div>

                {/* 담당자 정보 */}
                <div className={`rounded-xl border p-4 transition-colors ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}>
                  <h3 className={`text-xs font-semibold uppercase tracking-wide mb-3 ${isDark ? "text-gray-400" : "text-gray-500"}`}>담당자 정보</h3>
                  <InfoRow label="주점검자"    value={selected.primaryInspector} dark={isDark} />
                  <InfoRow label="보조점검자1" value={selected.subInspector} dark={isDark} />
                  <InfoRow label="보조점검자2" value={selected.subInspector2} dark={isDark} />
                  <InfoRow label="현장전화"    value={selected.sitePhone} dark={isDark} />
                  <InfoRow label="핸드폰"     value={selected.siteMobile} dark={isDark} />
                  <InfoRow label="담당자 HP"  value={selected.managerPhone} dark={isDark} />
                </div>
              </div>

              {/* 하자 정보 */}
              {(selected.warrantyCount != null || selected.warrantyStart) && (
                <div className={`rounded-xl border p-4 transition-colors ${isDark ? "bg-gray-800 border-amber-800" : "bg-white border-amber-200"}`}>
                  <h3 className={`text-xs font-semibold uppercase tracking-wide mb-3 ${isDark ? "text-amber-400" : "text-amber-600"}`}>⚠ 하자 정보</h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {selected.warrantyCount != null && (
                      <div>
                        <span className={`text-xs block mb-0.5 ${isDark ? "text-gray-500" : "text-gray-400"}`}>하자기 대수</span>
                        <span className={`font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}>{selected.warrantyCount}대</span>
                      </div>
                    )}
                    {selected.warrantyUnits && (
                      <div>
                        <span className={`text-xs block mb-0.5 ${isDark ? "text-gray-500" : "text-gray-400"}`}>하자기 호기</span>
                        <span className={`font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}>{selected.warrantyUnits}</span>
                      </div>
                    )}
                    {(selected.warrantyStart || selected.warrantyEnd) && (
                      <div className="col-span-2">
                        <span className={`text-xs block mb-0.5 ${isDark ? "text-gray-500" : "text-gray-400"}`}>하자기간</span>
                        <span className={`font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}>
                          {selected.warrantyStart ?? ""} ~ {selected.warrantyEnd ?? ""}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 비상통화장치 */}
              <EmergencyDevicesPanel
                key={selected.id}
                site={selected}
                canEdit={canEdit}
                isDark={isDark}
                onSaved={async () => {
                  const updated = await api.get<SiteRecord[]>("/api/sites").catch(() => null);
                  if (!updated) return;
                  setSites(updated);
                  const refreshed = updated.find(s => s.id === selected.id) ?? null;
                  setSelected(refreshed);
                }}
              />

              {/* 호기 목록 */}
              <div className={`rounded-xl border overflow-hidden transition-colors ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}>
                <div className={`flex items-center justify-between px-5 py-3.5 border-b ${isDark ? "border-gray-700" : "border-gray-100"}`}>
                  <div className="flex items-center gap-2">
                    <h3 className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-gray-700"}`}>호기 목록</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? "bg-gray-700 text-gray-300" : "bg-slate-100 text-slate-600"}`}>
                      {selectedElevators.length}대
                    </span>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => { setEditElevator(null); setShowElevatorForm(true); }}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors">
                      + 호기 등록
                    </button>
                  )}
                </div>
                {selectedElevators.length === 0 ? (
                  <div className={`text-center py-10 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                    <p className="text-2xl mb-1">🛗</p>
                    <p className="text-sm">등록된 호기가 없습니다</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className={`border-b ${isDark ? "bg-gray-700 border-gray-600" : "bg-gray-50 border-gray-100"}`}>
                        <tr>
                          <th className={`px-4 py-3 text-left text-xs font-medium w-8 ${isDark ? "text-gray-400" : "text-gray-500"}`}>#</th>
                          <th className={`px-4 py-3 text-left text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}>호기명</th>
                          <th className={`px-4 py-3 text-left text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}>승강기 번호</th>
                          {canEdit && (
                            <th className={`px-4 py-3 text-xs font-medium w-20 ${isDark ? "text-gray-400" : "text-gray-500"}`}></th>
                          )}
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${isDark ? "divide-gray-700" : "divide-gray-50"}`}>
                        {selectedElevators.map((e, idx) => (
                          <tr key={e.id} className={`transition-colors ${isDark ? "hover:bg-gray-700" : "hover:bg-gray-50"}`}>
                            <td className={`px-4 py-3 text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>{idx + 1}</td>
                            <td className={`px-4 py-3 font-medium whitespace-nowrap ${isDark ? "text-gray-200" : "text-gray-800"}`}>{e.unitName ?? "—"}</td>
                            <td className={`px-4 py-3 font-mono text-xs whitespace-nowrap ${isDark ? "text-blue-400" : "text-blue-600"}`}>{e.elevatorNo ?? "—"}</td>
                            {canEdit && (
                              <td className="px-4 py-3">
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => { setEditElevator(e); setShowElevatorForm(true); }}
                                    className={`text-xs px-2 py-1 rounded border transition-colors ${isDark ? "border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white" : "border-gray-200 text-gray-500 hover:bg-slate-50 hover:text-slate-700"}`}>
                                    수정
                                  </button>
                                  <button
                                    onClick={() => setDeleteElevatorTarget(e)}
                                    className={`text-xs px-2 py-1 rounded border transition-colors ${isDark ? "border-red-800 text-red-400 hover:bg-red-900/40" : "border-red-100 text-red-400 hover:bg-red-50"}`}>
                                    삭제
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 비고 */}
              {selected.note && (
                <div className={`border rounded-xl p-4 transition-colors ${isDark ? "bg-amber-900/20 border-amber-800" : "bg-amber-50 border-amber-200"}`}>
                  <h3 className={`text-xs font-semibold mb-1.5 ${isDark ? "text-amber-400" : "text-amber-700"}`}>비고</h3>
                  <p className={`text-sm ${isDark ? "text-amber-300" : "text-amber-900"}`}>{selected.note}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 현장 등록 모달 */}
      {showAdd && <AddSiteModal onClose={() => setShowAdd(false)} onSaved={reload} />}

      {/* 현장 수정 모달 */}
      {editTarget && (
        <AddSiteModal
          editSite={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={reload}
        />
      )}

      {/* 호기 등록/수정 모달 */}
      {showElevatorForm && selected && (
        <ElevatorFormModal
          siteName={selected.name}
          editElevator={editElevator}
          onClose={() => { setShowElevatorForm(false); setEditElevator(null); }}
          onSaved={() => reloadElevators(selected.name)}
        />
      )}

      {/* 호기 삭제 확인 */}
      {deleteElevatorTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setDeleteElevatorTarget(null)}>
          <div className={`rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 ${isDark ? "bg-gray-800" : "bg-white"}`}
            onClick={e => e.stopPropagation()}>
            <h3 className={`text-base font-semibold mb-2 ${isDark ? "text-gray-100" : "text-gray-800"}`}>호기 삭제</h3>
            <p className={`text-sm mb-1 ${isDark ? "text-gray-300" : "text-gray-600"}`}>
              <span className={`font-medium ${isDark ? "text-gray-100" : "text-gray-800"}`}>{deleteElevatorTarget.unitName ?? "—"}</span>
              {deleteElevatorTarget.elevatorNo && (
                <span className={isDark ? "text-gray-500" : "text-gray-400"}> ({deleteElevatorTarget.elevatorNo})</span>
              )}
              을(를) 삭제하시겠습니까?
            </p>
            <p className="text-xs text-red-500 mb-5">삭제 후 복구할 수 없습니다.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteElevatorTarget(null)}
                className={`flex-1 py-2.5 rounded-xl border text-sm transition-colors ${isDark ? "border-gray-600 text-gray-300 hover:bg-gray-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                취소
              </button>
              <button onClick={() => handleDeleteElevator(deleteElevatorTarget)}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors">
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 비상통화장치 인라인 편집 패널 ──────────────────────────────
function EmergencyDevicesPanel({
  site, canEdit, isDark, onSaved,
}: {
  site: SiteRecord;
  canEdit: boolean;
  isDark: boolean;
  onSaved: () => void;
}) {
  const [devices, setDevices] = useState(
    site.emergencyDevices?.length ? site.emergencyDevices : []
  );
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);

  function patch(i: number, field: "number" | "note", value: string) {
    setDevices(prev => prev.map((d, j) => j === i ? { ...d, [field]: value } : d));
  }

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/api/sites/${site.id}`, { emergencyDevices: devices.filter(d => d.number.trim()) });
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
    setEditing(false);
    onSaved();
  }

  function cancel() {
    setDevices(site.emergencyDevices?.length ? site.emergencyDevices : []);
    setEditing(false);
  }

  const cardCls = `rounded-xl border p-4 transition-colors ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`;
  const inputCls = `rounded-lg border px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 ${isDark ? "bg-gray-700 border-gray-600 text-gray-100 placeholder:text-gray-500" : "bg-white border-gray-200 text-gray-900 placeholder:text-gray-400"}`;

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={`text-xs font-semibold uppercase tracking-wide ${isDark ? "text-gray-400" : "text-gray-500"}`}>비상통화장치</h3>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${isDark ? "border-gray-600 text-gray-300 hover:bg-gray-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
            편집
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          {devices.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={d.number}
                onChange={e => patch(i, "number", e.target.value)}
                placeholder="전화번호"
                className={`${inputCls} w-36 shrink-0`}
              />
              <input
                value={d.note}
                onChange={e => patch(i, "note", e.target.value)}
                placeholder="비고 (예: 1~3호기)"
                className={`${inputCls} flex-1`}
              />
              <button type="button"
                onClick={() => setDevices(prev => prev.filter((_, j) => j !== i))}
                className="text-gray-300 hover:text-red-400 text-xl leading-none shrink-0">×</button>
            </div>
          ))}
          <button type="button"
            onClick={() => setDevices(prev => [...prev, { number: "", note: "" }])}
            className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${isDark ? "bg-gray-700 text-gray-300 hover:bg-gray-600" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            + 추가
          </button>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={cancel}
              className={`flex-1 text-xs py-1.5 rounded-lg border transition-colors ${isDark ? "border-gray-600 text-gray-400 hover:bg-gray-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
              취소
            </button>
            <button type="button" onClick={save} disabled={saving}
              className="flex-1 text-xs py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {devices.filter(d => d.number).length === 0 ? (
            <p className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>등록된 비상통화장치가 없습니다.</p>
          ) : (
            devices.filter(d => d.number).map((d, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className={`font-mono font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}>{d.number}</span>
                {d.note && <span className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>{d.note}</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
