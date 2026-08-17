"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import { useAuth, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import { createAuthUser } from "@/lib/auth-ops";
import { formatDate, formatPhone, formatSsn, genderFromSsn } from "@/lib/input-format";

const STORAGE_BUCKET = "employee-photos";
const CERT_DOCS_BUCKET = "cert-docs";
const SIGN_BUCKET = "signatures";
const DAUM_SCRIPT_SRC = "//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

declare global {
  interface Window {
    daum?: {
      Postcode: new (opts: {
        oncomplete: (data: { zonecode: string; address: string }) => void;
      }) => { open: () => void };
    };
  }
}

type TabKey = "basic" | "family" | "career" | "vehicle" | "cert" | "rp";

interface Form {
  name: string;
  ssn: string;
  gender: "M" | "F" | "";
  blood_type: string;
  hireDate: string;
  dept: string;
  crew_id: number | null;
  rank: string;
  status: string;
  phone: string;
  email: string;
  postal_code: string;
  address_basic: string;
  address_detail: string;
  uniform_top_size: string;
  uniform_bottom_size: string;
  safety_shoes_size: string;
  initial_password: string;
  permission_group_id: number | null;
}

const DEFAULT_PASSWORD = "000000";

interface FamilyMember {
  relationship: string;
  name: string;
  gender: "M" | "F" | "";
  birth_date: string;
  occupation: string;
  cohabiting: boolean;
  is_emergency: boolean;
  phone: string;
}

const EMPTY_FAMILY: FamilyMember = {
  relationship: "", name: "", gender: "", birth_date: "", occupation: "",
  cohabiting: true, is_emergency: false, phone: "",
};

interface Vehicle {
  vehicle_type: "자차" | "렌트" | "회사차량" | "기타" | "";
  plate_number: string;
  model: string;
  year_made: string;
  fuel_type: "가솔린" | "디젤" | "가스" | "전기" | "기타" | "";
  registration_date: string;
}

const EMPTY_VEHICLE: Vehicle = {
  vehicle_type: "", plate_number: "", model: "", year_made: "",
  fuel_type: "", registration_date: "",
};

interface Certification {
  cert_name: string;
  cert_number: string;
  self_check: boolean;
  acquired_date: string;
  expiry_date: string;
  issuer: string;
  doc_file: File | null;
  doc_preview: string;
}

const EMPTY_CERT: Certification = {
  cert_name: "", cert_number: "", self_check: false,
  acquired_date: "", expiry_date: "", issuer: "",
  doc_file: null, doc_preview: "",
};

interface Career {
  company_name: string;
  joined_date: string;
  left_date: string;
  dept: string;
  rank: string;
  duty: string;
}

const EMPTY_CAREER: Career = {
  company_name: "", joined_date: "", left_date: "", dept: "", rank: "", duty: "",
};

interface RP {
  kind: "상" | "벌" | "";
  content: string;
  occurred_on: string;
}

const EMPTY_RP: RP = { kind: "", content: "", occurred_on: "" };

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyForm(): Form {
  return {
    name: "", ssn: "", gender: "", blood_type: "",
    hireDate: todayStr(), dept: "", crew_id: null, rank: "", status: "재직",
    phone: "", email: "",
    postal_code: "", address_basic: "", address_detail: "",
    uniform_top_size: "", uniform_bottom_size: "", safety_shoes_size: "",
    initial_password: DEFAULT_PASSWORD,
    permission_group_id: null,
  };
}

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "basic",   label: "기본정보",   icon: "👤" },
  { key: "family",  label: "가족정보",   icon: "👨‍👩‍👧" },
  { key: "career",  label: "경력",       icon: "💼" },
  { key: "vehicle", label: "차량등록",   icon: "🚗" },
  { key: "cert",    label: "교육 및 자격", icon: "📜" },
  { key: "rp",      label: "상벌사항",   icon: "🏅" },
];

export default function EmployeeRegisterClient() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>("basic");
  const [form, setForm] = useState<Form>(emptyForm());
  const [family, setFamily] = useState<FamilyMember[]>([{ ...EMPTY_FAMILY }]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [certs, setCerts] = useState<Certification[]>([]);
  const [careers, setCareers] = useState<Career[]>([]);
  const [rps, setRps] = useState<RP[]>([]);

  const [companyVehicles, setCompanyVehicles] = useState<{id: number; plate_number: string; model: string; fuel_type: string; year_made: string | null}[]>([]);
  const [cvLoading, setCvLoading] = useState(false);

  async function loadCompanyVehicles() {
    if (companyVehicles.length > 0) return;
    setCvLoading(true);
    const { data } = await supabase
      .from("user_vehicles")
      .select("id, plate_number, model, fuel_type, year_made")
      .eq("vehicle_type", "회사차량")
      .eq("status", "active")
      .order("plate_number");
    setCompanyVehicles((data ?? []) as typeof companyVehicles);
    setCvLoading(false);
  }

  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>("");
  const [signature, setSignature] = useState<File | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [daumReady, setDaumReady] = useState(false);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [ranks, setRanks] = useState<{ id: number; name: string }[]>([]);
  const [permGroups, setPermGroups] = useState<{ id: number; name: string; permissions: string[] }[]>([]);
  const [crews, setCrews] = useState<{ id: number; department_id: number; name: string; is_active: boolean }[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);

  const loadRefData = async () => {
    const [d, r, p, c] = await Promise.all([
      supabase.from("departments").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("ranks").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("permission_groups").select("id, name, permissions").order("sort_order"),
      supabase.from("crews").select("id, department_id, name, is_active").eq("is_active", true).order("sort_order"),
    ]);
    if (d.data) setDepartments(d.data as { id: number; name: string }[]);
    if (r.data) setRanks(r.data as { id: number; name: string }[]);
    if (p.data) setPermGroups(p.data as { id: number; name: string; permissions: string[] }[]);
    if (c.data) setCrews(c.data as { id: number; department_id: number; name: string; is_active: boolean }[]);
  };
  useEffect(() => {
    void loadRefData();
  }, []);
  useReloadOnActivate(() => { void loadRefData(); });

  useEffect(() => {
    if (window.daum?.Postcode) { setDaumReady(true); return; }
    const existing = document.querySelector(`script[src="${DAUM_SCRIPT_SRC}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => setDaumReady(true));
      return;
    }
    const s = document.createElement("script");
    s.src = DAUM_SCRIPT_SRC;
    s.async = true;
    s.onload = () => setDaumReady(true);
    document.body.appendChild(s);
  }, []);

  if (!user) {
    return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  }
  if (!hasMenuPermission(user, "/hr/employee-register", "read")) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">사원등록 메뉴 권한이 필요합니다.</div>
      </div>
    );
  }
  // 사원등록은 등록(create) 전용 화면 — 쓰기 권한 없으면 조회만 안내
  if (!hasMenuPermission(user, "/hr/employee-register", "create") && !hasMenuPermission(user, "/hr/employee-register", "update")) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">👁️</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">조회 전용 권한입니다</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">사원등록 권한(생성/수정)이 없어 등록할 수 없습니다.</div>
      </div>
    );
  }

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function openPostcode() {
    if (!window.daum?.Postcode) {
      alert("우편번호 서비스를 불러오는 중입니다. 잠시 후 다시 시도하세요.");
      return;
    }
    new window.daum.Postcode({
      oncomplete: data => {
        setForm(f => ({
          ...f,
          postal_code: data.zonecode,
          address_basic: data.address,
        }));
      },
    }).open();
  }

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhoto(f);
    const reader = new FileReader();
    reader.onload = ev => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  }

  function clearPhoto() {
    setPhoto(null);
    setPhotoPreview("");
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  function onSignatureChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setSignature(f);
    const reader = new FileReader();
    reader.onload = ev => setSignaturePreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  }

  function clearSignature() {
    setSignature(null);
    setSignaturePreview("");
    if (signatureInputRef.current) signatureInputRef.current.value = "";
  }

  // 긴급연락처 1명만 가능 — 토글 시 다른 행은 해제
  function setEmergency(targetIdx: number, on: boolean) {
    setFamily(prev => prev.map((m, i) => ({
      ...m,
      is_emergency: i === targetIdx ? on : (on ? false : m.is_emergency),
    })));
  }

  async function uploadPhoto(): Promise<string | null> {
    if (!photo) return null;
    const ext = photo.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, photo, {
      cacheControl: "3600", upsert: false,
    });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function uploadSignature(): Promise<string | null> {
    if (!signature) return null;
    const ext = signature.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from(SIGN_BUCKET).upload(path, signature, {
      cacheControl: "3600", upsert: false,
    });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(SIGN_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  function resetAll() {
    setForm(emptyForm());
    setFamily([{ ...EMPTY_FAMILY }]);
    setVehicles([]);
    setCerts([]);
    setCareers([]);
    setRps([]);
    clearPhoto();
    clearSignature();
    setMessage(null);
    setTab("basic");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);

    // ---------------- 검증 ----------------
    if (!form.name.trim())     { setMessage({ type: "error", text: "[기본정보] 성명을 입력하세요." }); setTab("basic"); return; }
    if (!form.hireDate)        { setMessage({ type: "error", text: "[기본정보] 입사일을 입력하세요." }); setTab("basic"); return; }
    if (!form.phone.trim())    { setMessage({ type: "error", text: "[기본정보] 휴대폰 번호를 입력하세요." }); setTab("basic"); return; }
    if (!form.initial_password.trim()) {
      setMessage({ type: "error", text: "[기본정보] 초기 비밀번호를 입력하세요. (기본 000000)" }); setTab("basic"); return;
    }
    if (form.initial_password.length < 6) {
      setMessage({ type: "error", text: "[기본정보] 초기 비밀번호는 6자 이상이어야 합니다." }); setTab("basic"); return;
    }

    // 긴급연락처 — 선택. 지정된 경우에만 필수필드 검증
    const emergency = family.find(m => m.is_emergency);
    if (emergency && (!emergency.relationship.trim() || !emergency.name.trim() || !emergency.phone.trim())) {
      setMessage({ type: "error", text: "[가족정보] 긴급연락처 지정 시 관계·성명·연락처는 모두 입력해야 합니다." });
      setTab("family"); return;
    }

    // 차량
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v.vehicle_type || !v.plate_number.trim() || !v.model.trim() || !v.fuel_type) {
        setMessage({ type: "error", text: `[차량등록] 차량 #${i + 1}의 필수 항목(구분/차량번호/차종/유종)을 모두 입력하세요.` });
        setTab("vehicle"); return;
      }
    }

    // 자격
    for (let i = 0; i < certs.length; i++) {
      if (!certs[i].cert_name.trim()) {
        setMessage({ type: "error", text: `[교육및자격] 자격 #${i + 1}의 자격명을 입력하세요.` });
        setTab("cert"); return;
      }
    }

    // 경력
    for (let i = 0; i < careers.length; i++) {
      if (!careers[i].company_name.trim()) {
        setMessage({ type: "error", text: `[경력] 경력 #${i + 1}의 회사명을 입력하세요.` });
        setTab("career"); return;
      }
    }

    // 상벌
    for (let i = 0; i < rps.length; i++) {
      if (!rps[i].kind || !rps[i].content.trim()) {
        setMessage({ type: "error", text: `[상벌사항] #${i + 1}의 구분과 내용은 필수입니다.` });
        setTab("rp"); return;
      }
    }

    // 주민번호 중복
    if (form.ssn) {
      const { data: dup } = await supabase.from("accounts").select("id").eq("ssn", form.ssn).maybeSingle();
      if (dup) { setMessage({ type: "error", text: "이미 등록된 주민등록번호입니다." }); setTab("basic"); return; }
    }

    setSaving(true);
    try {
      const photoUrl = await uploadPhoto();
      const signatureUrl = await uploadSignature();
      const fullAddress = [form.address_basic, form.address_detail].filter(Boolean).join(" ").trim();

      const newPermissions = form.permission_group_id
        ? (permGroups.find(g => g.id === form.permission_group_id)?.permissions ?? [])
        : [];
      // 신DB 정본은 accounts. 권한은 permissions / permission_group_id 가 단일 진리원이므로
      // role 컬럼은 표시용 기본값("직원")만 채운다.
      const payload = {
        username: form.name.trim(),   // accounts: username 이 단일 진리원 (name 컬럼 미사용)
        role: "직원",
        ssn: form.ssn || null,
        gender: form.gender || null,
        blood_type: form.blood_type || null,
        hire_date: form.hireDate,
        dept: form.dept || null,
        crew_id: form.crew_id,
        rank: form.rank || null,
        status: form.status,
        phone: form.phone || null,
        email: form.email || null,
        // 호환: 긴급연락처가 지정된 경우 텍스트 한 줄 요약을 emergency_contact 컬럼에도 저장
        emergency_contact: emergency ? `${emergency.relationship} ${emergency.name} ${emergency.phone}`.trim() : null,
        postal_code: form.postal_code || null,
        address: fullAddress || null,
        photo_url: photoUrl,
        signature_url: signatureUrl,
        uniform_top_size: form.uniform_top_size || null,
        uniform_bottom_size: form.uniform_bottom_size || null,
        safety_shoes_size: form.safety_shoes_size || null,
        permission_group_id: form.permission_group_id,
        permissions: newPermissions,
        password: form.initial_password,
      };
      const { data: inserted, error: insErr } = await supabase.from("accounts")
        .insert(payload).select("id").single();
      if (insErr) {
        console.error("[employee-register] insert error:", insErr, "payload:", payload);
        throw insErr;
      }
      const newUserId = inserted?.id as number;

      // 유지보수 사이트(auth.users)에도 동일 계정 생성 — 안 만들면 유지보수 로그인 불가.
      // 이메일 키는 `${account_id}@daesol.el` 규약(admin-auth-ops 내부에서 조립).
      const authRes = await createAuthUser(newUserId, form.initial_password);
      if (!authRes.ok) {
        console.warn("[employee-register] admin-auth-ops create 실패:", authRes.error);
      }

      // 가족 (긴급연락처 포함, 이름·관계가 모두 비어있는 행은 제외)
      const validFamily = family.filter(m => m.relationship.trim() && m.name.trim());
      if (validFamily.length > 0) {
        const { error: famErr } = await supabase.from("user_family_members").insert(
          validFamily.map((m, idx) => ({
            user_id: newUserId,
            relationship: m.relationship,
            name: m.name.trim(),
            gender: m.gender || null,
            birth_date: m.birth_date || null,
            occupation: m.occupation || null,
            cohabiting: m.cohabiting,
            is_emergency: m.is_emergency,
            phone: m.phone || null,
            sort_order: (idx + 1) * 10,
          }))
        );
        if (famErr) {
          console.error("[employee-register] family insert error:", famErr);
          setMessage({ type: "error", text: `사원은 등록됐으나 가족 정보 저장 실패: ${famErr.message}` });
          return;
        }
      }

      // 차량
      if (vehicles.length > 0) {
        const { error: vehErr } = await supabase.from("user_vehicles").insert(
          vehicles.map((v, i) => ({
            user_id: newUserId,
            vehicle_type: v.vehicle_type,
            plate_number: v.plate_number.trim(),
            model: v.model.trim(),
            year_made: v.year_made || null,
            fuel_type: v.fuel_type,
            registration_date: v.registration_date || null,
            sort_order: (i + 1) * 10,
          }))
        );
        if (vehErr) { setMessage({ type: "error", text: `차량 저장 실패: ${vehErr.message}` }); return; }
      }

      // 자격 — 파일 업로드 후 insert
      if (certs.length > 0) {
        const certRows: Array<Record<string, unknown>> = [];
        for (let i = 0; i < certs.length; i++) {
          const c = certs[i];
          let docUrl: string | null = null;
          if (c.doc_file) {
            const ext = c.doc_file.name.split(".").pop()?.toLowerCase() || "bin";
            const path = `${newUserId}/${Date.now()}_${i}.${ext}`;
            const { error: upErr } = await supabase.storage.from(CERT_DOCS_BUCKET).upload(path, c.doc_file, { cacheControl: "3600", upsert: false });
            if (upErr) { setMessage({ type: "error", text: `자격 #${i + 1} 사본 업로드 실패: ${upErr.message}` }); return; }
            const { data } = supabase.storage.from(CERT_DOCS_BUCKET).getPublicUrl(path);
            docUrl = data.publicUrl;
          }
          certRows.push({
            user_id: newUserId,
            cert_name: c.cert_name.trim(),
            cert_number: c.cert_number || null,
            self_check: c.self_check,
            acquired_date: c.acquired_date || null,
            expiry_date: c.expiry_date || null,
            issuer: c.issuer || null,
            cert_doc_url: docUrl,
            sort_order: (i + 1) * 10,
          });
        }
        const { error: certErr } = await supabase.from("user_certifications").insert(certRows);
        if (certErr) { setMessage({ type: "error", text: `자격 저장 실패: ${certErr.message}` }); return; }
      }

      // 경력
      if (careers.length > 0) {
        const { error: cErr } = await supabase.from("user_career_history").insert(
          careers.map((c, i) => ({
            user_id: newUserId,
            company_name: c.company_name.trim(),
            joined_date: c.joined_date || null,
            left_date: c.left_date || null,
            dept: c.dept || null,
            rank: c.rank || null,
            duty: c.duty || null,
            sort_order: (i + 1) * 10,
          }))
        );
        if (cErr) { setMessage({ type: "error", text: `경력 저장 실패: ${cErr.message}` }); return; }
      }

      // 상벌
      if (rps.length > 0) {
        const { error: rpErr } = await supabase.from("user_rewards_punishments").insert(
          rps.map((r, i) => ({
            user_id: newUserId,
            kind: r.kind,
            content: r.content.trim(),
            occurred_on: r.occurred_on || null,
            sort_order: (i + 1) * 10,
          }))
        );
        if (rpErr) { setMessage({ type: "error", text: `상벌 저장 실패: ${rpErr.message}` }); return; }
      }

      setMessage({
        type: "success",
        text: `사원 등록 완료 (ID: ${newUserId}, 가족 ${validFamily.length}명, 경력 ${careers.length}건, 차량 ${vehicles.length}대, 자격 ${certs.length}건, 상벌 ${rps.length}건, 초기 비밀번호: ${form.initial_password})`,
      });
      resetAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : (() => {
        try { return JSON.stringify(err); } catch { return String(err); }
      })();
      setMessage({ type: "error", text: `저장 실패: ${msg}` });
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-gray-400 dark:placeholder:text-gray-500";
  const labelCls = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1";
  const sectionCls = "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5";

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">사원등록</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">탭으로 항목을 이동하며 입력합니다 (관리자 전용 · 초기 비밀번호 000000)</p>
      </div>

      {/* 탭 네비 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 lg:px-6 overflow-x-auto">
        <nav className="flex gap-1 max-w-6xl mx-auto">
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`whitespace-nowrap px-3 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition-colors ${
                  active
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                <span className="mr-1">{t.icon}</span>{t.label}
              </button>
            );
          })}
        </nav>
      </div>

      <form
        onSubmit={handleSubmit}
        onKeyDown={e => {
          if (e.key !== "Enter") return;
          if ((e.nativeEvent as KeyboardEvent).isComposing) return;
          const target = e.target as HTMLElement;
          if (target.tagName === "TEXTAREA") return;
          if (target.tagName === "BUTTON") return;
          const inp = target as HTMLInputElement;
          if (inp.type === "submit") return;
          e.preventDefault();
          const formEl = e.currentTarget;
          const focusables = Array.from(formEl.querySelectorAll<HTMLElement>(
            "input:not([disabled]):not([type=hidden]):not([readonly]), select:not([disabled])"
          ));
          const idx = focusables.indexOf(target);
          if (idx >= 0 && idx < focusables.length - 1) {
            focusables[idx + 1].focus();
            const next = focusables[idx + 1] as HTMLInputElement;
            if (next.tagName === "INPUT" && (next.type === "text" || next.type === "tel")) {
              next.select?.();
            }
          }
        }}
        className="p-4 lg:p-6 max-w-6xl mx-auto space-y-4"
      >
        {/* ================= 기본정보 ================= */}
        {tab === "basic" && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
              <div className="flex flex-col gap-4">
              <div className={sectionCls + " flex flex-col"}>
                <label className={labelCls}>📷 프로필 사진 <span className="text-[10px] text-gray-400">(증명사진 3:4)</span></label>
                <div className="w-full aspect-[3/4] rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 overflow-hidden flex items-center justify-center mb-3 mx-auto">
                  {photoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoPreview} alt="미리보기" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center text-gray-400">
                      <div className="text-5xl mb-1">👤</div>
                      <div className="text-[10px]">사진 없음</div>
                    </div>
                  )}
                </div>
                <input ref={photoInputRef} type="file" accept="image/*" onChange={onPhotoChange} className="hidden" id="emp-photo-input" />
                <div className="flex gap-2">
                  <label htmlFor="emp-photo-input" className="flex-1 text-center px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold cursor-pointer hover:bg-blue-700">
                    📁 선택
                  </label>
                  {photo && (
                    <button type="button" onClick={clearPhoto}
                      className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-semibold">
                      지우기
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2">JPG/PNG/WEBP, 최대 3MB</p>
              </div>

              <div className={sectionCls + " flex flex-col"}>
                <label className={labelCls}>✍️ 서명(싸인) 이미지</label>
                <div className="w-full h-24 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 overflow-hidden flex items-center justify-center mb-3">
                  {signaturePreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={signaturePreview} alt="서명 미리보기" className="w-full h-full object-contain" />
                  ) : (
                    <div className="text-center text-gray-400">
                      <div className="text-3xl mb-1">✍️</div>
                      <div className="text-[10px]">서명 없음</div>
                    </div>
                  )}
                </div>
                <input ref={signatureInputRef} type="file" accept="image/png,image/jpeg" onChange={onSignatureChange} className="hidden" id="emp-signature-input" />
                <div className="flex gap-2">
                  <label htmlFor="emp-signature-input" className="flex-1 text-center px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold cursor-pointer hover:bg-blue-700">
                    📁 선택
                  </label>
                  {signature && (
                    <button type="button" onClick={clearSignature}
                      className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-semibold">
                      지우기
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2">
                  PNG/JPG, 최대 2MB. 등록 시 위험성평가·TBM 등에서 &quot;등록된 서명 사용&quot; 버튼으로 재사용됩니다.
                </p>
              </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className={sectionCls}>
                  <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">기본 정보</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className={labelCls}>성명 <span className="text-red-500">*</span></label>
                      <input type="text" value={form.name} onChange={e => set("name", e.target.value)} required lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>주민등록번호</label>
                      <input type="text" value={form.ssn}
                        onChange={e => {
                          const v = formatSsn(e.target.value);
                          setForm(f => ({ ...f, ssn: v, gender: genderFromSsn(v) || f.gender }));
                        }}
                        placeholder="000000-0000000 (선택)" inputMode="numeric" maxLength={14}
                        className={inputCls + " font-mono"} />
                    </div>
                    <div>
                      <label className={labelCls}>성별</label>
                      <select value={form.gender}
                        onChange={e => set("gender", e.target.value as Form["gender"])}
                        className={inputCls}>
                        <option value="">선택</option>
                        <option value="M">남</option>
                        <option value="F">여</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>입사일 <span className="text-red-500">*</span></label>
                      <input type="text" value={form.hireDate}
                        onChange={e => set("hireDate", formatDate(e.target.value))}
                        placeholder="YYYYMMDD (예: 20260514)"
                        inputMode="numeric" maxLength={10}
                        required
                        className={inputCls + " font-mono"} />
                    </div>
                    <div>
                      <label className={labelCls}>부서</label>
                      <select value={form.dept}
                        onChange={e => { set("dept", e.target.value); set("crew_id", null); }}
                        className={inputCls}>
                        <option value="">선택하세요</option>
                        {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>조</label>
                      {(() => {
                        const selectedDept = departments.find(d => d.name === form.dept);
                        const deptCrews = selectedDept ? crews.filter(c => c.department_id === selectedDept.id) : [];
                        return (
                          <select value={form.crew_id ?? ""}
                            onChange={e => set("crew_id", e.target.value ? Number(e.target.value) : null)}
                            disabled={!selectedDept || deptCrews.length === 0}
                            className={inputCls}>
                            <option value="">{!selectedDept ? "부서 먼저 선택" : deptCrews.length === 0 ? "등록된 조 없음" : "미배정"}</option>
                            {deptCrews.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        );
                      })()}
                    </div>
                    <div>
                      <label className={labelCls}>직급</label>
                      <select value={form.rank} onChange={e => set("rank", e.target.value)} className={inputCls}>
                        <option value="">선택하세요</option>
                        {ranks.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>재직상태</label>
                      <select value={form.status} onChange={e => set("status", e.target.value)} className={inputCls}>
                        <option value="재직">재직</option>
                        <option value="퇴사">퇴사</option>
                        <option value="휴직">휴직</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>혈액형</label>
                      <select value={form.blood_type} onChange={e => set("blood_type", e.target.value)} className={inputCls}>
                        <option value="">선택</option>
                        {["A+","A-","B+","B-","O+","O-","AB+","AB-"].map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className={labelCls}>🔑 사용자 권한그룹 <span className="text-[10px] text-gray-400">(선택 시 그룹 기본권한이 자동 적용. 세부권한은 [데이터관리 → 사용자권한그룹]에서 조정)</span></label>
                      <select value={form.permission_group_id ?? ""}
                        onChange={e => set("permission_group_id", e.target.value ? Number(e.target.value) : null)}
                        className={inputCls}>
                        <option value="">선택 안 함 (권한 없음)</option>
                        {permGroups.map(g => (
                          <option key={g.id} value={g.id}>
                            {g.name} ({g.permissions.includes("admin") ? "전체 admin" : `${g.permissions.length}개`})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className={sectionCls}>
                    <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">연락처</h2>
                    <div className="space-y-3">
                      <div>
                        <label className={labelCls}>휴대폰 <span className="text-red-500">*</span></label>
                        <input type="tel" value={form.phone}
                          onChange={e => set("phone", formatPhone(e.target.value))}
                          placeholder="010-0000-0000 또는 02-000-0000" inputMode="tel" maxLength={14}
                          required
                          className={inputCls + " font-mono"} />
                      </div>
                      <div>
                        <label className={labelCls}>이메일</label>
                        <input type="email" value={form.email}
                          onChange={e => set("email", e.target.value)}
                          placeholder="user@example.com"
                          className={inputCls} />
                      </div>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">긴급연락처는 [가족정보] 탭에서 1명을 지정합니다.</p>
                    </div>
                  </div>

                  <div className={sectionCls}>
                    <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">주소</h2>
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input type="text" value={form.postal_code} readOnly placeholder="우편번호"
                          className={inputCls + " font-mono w-32 cursor-not-allowed bg-gray-50 dark:bg-gray-900/40"} />
                        <button type="button" onClick={openPostcode} disabled={!daumReady}
                          className="px-3 py-2 rounded-lg bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap">
                          {daumReady ? "🔍 우편번호" : "로딩..."}
                        </button>
                      </div>
                      <input type="text" value={form.address_basic} readOnly placeholder="기본주소 (우편번호 검색 시 자동 입력)"
                        className={inputCls + " cursor-not-allowed bg-gray-50 dark:bg-gray-900/40"} />
                      <input type="text" value={form.address_detail} onChange={e => set("address_detail", e.target.value)}
                        placeholder="상세주소 (예: 101동 1234호)" lang="ko" className={inputCls} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className={sectionCls}>
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">신체정보 (근무복 사이즈)</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>상의</label>
                  <input type="text" value={form.uniform_top_size} onChange={e => set("uniform_top_size", e.target.value)} placeholder="예: 95, 100, L" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>하의</label>
                  <input type="text" value={form.uniform_bottom_size} onChange={e => set("uniform_bottom_size", e.target.value)} placeholder="예: 30, 32" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>안전화</label>
                  <input type="text" value={form.safety_shoes_size} onChange={e => set("safety_shoes_size", e.target.value)} placeholder="예: 250, 270" className={inputCls} />
                </div>
              </div>
            </div>

            {/* 로그인 비밀번호 */}
            <div className={sectionCls}>
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">🔐 로그인 비밀번호</h2>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
                <div>
                  <label className={labelCls}>초기 비밀번호 <span className="text-red-500">*</span> <span className="text-[10px] text-gray-400 ml-1">(기본 000000, 6자 이상)</span></label>
                  <input type="text" value={form.initial_password}
                    onChange={e => set("initial_password", e.target.value)}
                    placeholder={DEFAULT_PASSWORD}
                    required minLength={4}
                    className={inputCls + " font-mono"} />
                </div>
                <button type="button"
                  onClick={() => set("initial_password", DEFAULT_PASSWORD)}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold whitespace-nowrap">
                  ↻ 000000으로 초기화
                </button>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
                사원이 첫 로그인 후 환경설정에서 변경할 수 있습니다.
              </p>
            </div>
          </>
        )}

        {/* ================= 가족정보 ================= */}
        {tab === "family" && (
          <div className={sectionCls}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">가족정보 ({family.length}명)</h2>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">긴급연락처 지정은 선택 사항 — 필요 시 가족 중 1명의 [긴급연락처 지정] 체크</p>
              </div>
              <button type="button"
                onClick={() => setFamily(prev => [...prev, { ...EMPTY_FAMILY }])}
                className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">
                + 가족 추가
              </button>
            </div>
            <div className="space-y-3">
              {family.map((m, i) => (
                <div key={i} className={`rounded-lg border p-3 ${m.is_emergency ? "border-rose-400 bg-rose-50 dark:bg-rose-900/20" : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-bold">
                      <input type="checkbox" checked={m.is_emergency}
                        onChange={e => setEmergency(i, e.target.checked)}
                        className="rounded" />
                      <span className={m.is_emergency ? "text-rose-600 dark:text-rose-300" : "text-gray-500 dark:text-gray-400"}>
                        {m.is_emergency ? "🚨 긴급연락처" : "긴급연락처 지정"}
                      </span>
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="text-[11px] text-gray-400">#{i + 1}</div>
                      {family.length > 1 && (
                        <button type="button"
                          onClick={() => setFamily(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-[11px] text-red-500 hover:text-red-700">
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    <div>
                      <label className={labelCls}>관계 {m.is_emergency && <span className="text-red-500">*</span>}</label>
                      <select
                        value={m.relationship}
                        onChange={e => {
                          const rel = e.target.value;
                          const autoGender: "M" | "F" | "" =
                            rel === "부" || rel === "형제" ? "M"
                            : rel === "모" || rel === "자매" ? "F"
                            : m.gender;
                          setFamily(prev => prev.map((f, idx) => idx === i ? { ...f, relationship: rel, gender: autoGender } : f));
                        }}
                        className={inputCls}>
                        <option value="">선택</option>
                        {["배우자","부","모","자녀","형제","자매","기타"].map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>성명 {m.is_emergency && <span className="text-red-500">*</span>}</label>
                      <input type="text" value={m.name}
                        onChange={e => setFamily(prev => prev.map((f, idx) => idx === i ? { ...f, name: e.target.value } : f))}
                        lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>연락처 {m.is_emergency && <span className="text-red-500">*</span>}</label>
                      <input type="tel" value={m.phone}
                        onChange={e => setFamily(prev => prev.map((f, idx) => idx === i ? { ...f, phone: formatPhone(e.target.value) } : f))}
                        placeholder="010-0000-0000 또는 02-000-0000" inputMode="tel" maxLength={14}
                        className={inputCls + " font-mono"} />
                    </div>
                    <div>
                      <label className={labelCls}>
                        성별
                        {(m.relationship === "부" || m.relationship === "모" || m.relationship === "형제" || m.relationship === "자매") && (
                          <span className="ml-1 text-[10px] text-gray-400">(자동)</span>
                        )}
                      </label>
                      <select
                        value={m.gender}
                        onChange={e => setFamily(prev => prev.map((f, idx) => idx === i ? { ...f, gender: e.target.value as "M" | "F" | "" } : f))}
                        disabled={m.relationship === "부" || m.relationship === "모" || m.relationship === "형제" || m.relationship === "자매"}
                        className={inputCls + " disabled:opacity-70 disabled:cursor-not-allowed"}>
                        <option value="">선택</option>
                        <option value="M">남</option>
                        <option value="F">여</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>생년월일</label>
                      <input type="text" value={m.birth_date}
                        onChange={e => setFamily(prev => prev.map((f, idx) => idx === i ? { ...f, birth_date: formatDate(e.target.value) } : f))}
                        placeholder="YYYYMMDD" inputMode="numeric" maxLength={10}
                        className={inputCls + " font-mono"} />
                    </div>
                    <div>
                      <label className={labelCls}>직업</label>
                      <input type="text" value={m.occupation}
                        onChange={e => setFamily(prev => prev.map((f, idx) => idx === i ? { ...f, occupation: e.target.value } : f))}
                        placeholder="예: 회사원, 학생" lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>동거여부</label>
                      <select value={m.cohabiting ? "Y" : "N"}
                        onChange={e => setFamily(prev => prev.map((f, idx) => idx === i ? { ...f, cohabiting: e.target.value === "Y" } : f))}
                        className={inputCls}>
                        <option value="Y">동거</option>
                        <option value="N">비동거</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= 경력 ================= */}
        {tab === "career" && (
          <div className={sectionCls}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">경력 ({careers.length}건)</h2>
              <button type="button"
                onClick={() => setCareers(prev => [...prev, { ...EMPTY_CAREER }])}
                className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">
                + 경력 추가
              </button>
            </div>
            {careers.length === 0 && (
              <div className="text-center py-4 text-xs text-gray-400 dark:text-gray-500">
                등록된 경력이 없습니다. 필요시 우상단 [+ 경력 추가] 클릭
              </div>
            )}
            <div className="space-y-3">
              {careers.map((c, i) => (
                <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 bg-gray-50 dark:bg-gray-700/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400">경력 #{i + 1}</div>
                    <button type="button"
                      onClick={() => setCareers(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-[11px] text-red-500 hover:text-red-700">
                      삭제
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    <div>
                      <label className={labelCls}>회사명 <span className="text-red-500">*</span></label>
                      <input type="text" value={c.company_name}
                        onChange={e => setCareers(prev => prev.map((x, idx) => idx === i ? { ...x, company_name: e.target.value } : x))}
                        lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>근무부서</label>
                      <input type="text" value={c.dept}
                        onChange={e => setCareers(prev => prev.map((x, idx) => idx === i ? { ...x, dept: e.target.value } : x))}
                        lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>직급</label>
                      <input type="text" value={c.rank}
                        onChange={e => setCareers(prev => prev.map((x, idx) => idx === i ? { ...x, rank: e.target.value } : x))}
                        lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>입사일</label>
                      <input type="text" value={c.joined_date}
                        onChange={e => setCareers(prev => prev.map((x, idx) => idx === i ? { ...x, joined_date: formatDate(e.target.value) } : x))}
                        placeholder="YYYYMMDD" inputMode="numeric" maxLength={10}
                        className={inputCls + " font-mono"} />
                    </div>
                    <div>
                      <label className={labelCls}>퇴사일</label>
                      <input type="text" value={c.left_date}
                        onChange={e => setCareers(prev => prev.map((x, idx) => idx === i ? { ...x, left_date: formatDate(e.target.value) } : x))}
                        placeholder="YYYYMMDD (미입력 시 재직 중)" inputMode="numeric" maxLength={10}
                        className={inputCls + " font-mono"} />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className={labelCls}>담당업무</label>
                      <input type="text" value={c.duty}
                        onChange={e => setCareers(prev => prev.map((x, idx) => idx === i ? { ...x, duty: e.target.value } : x))}
                        placeholder="예: 승강기 정기점검, 자재 발주, 현장 관리" lang="ko" className={inputCls} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= 차량등록 ================= */}
        {tab === "vehicle" && (
          <div className={sectionCls}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">차량 정보 ({vehicles.length}대)</h2>
              <button type="button"
                onClick={() => setVehicles(prev => [...prev, { ...EMPTY_VEHICLE }])}
                className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">
                + 차량 추가
              </button>
            </div>
            {vehicles.length === 0 && (
              <div className="text-center py-4 text-xs text-gray-400 dark:text-gray-500">
                등록된 차량이 없습니다. 필요시 우상단 [+ 차량 추가] 클릭
              </div>
            )}
            <div className="space-y-3">
              {vehicles.map((v, i) => (
                <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 bg-gray-50 dark:bg-gray-700/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400">차량 #{i + 1}</div>
                    <button type="button"
                      onClick={() => setVehicles(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-[11px] text-red-500 hover:text-red-700">
                      삭제
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-2">
                    <div>
                      <label className={labelCls}>구분 <span className="text-red-500">*</span></label>
                      <select value={v.vehicle_type}
                        onChange={e => {
                          const t = e.target.value as Vehicle["vehicle_type"];
                          setVehicles(prev => prev.map((x, idx) => idx === i ? { ...x, vehicle_type: t, plate_number: "", model: "", fuel_type: "", year_made: "" } : x));
                          if (t === "회사차량") loadCompanyVehicles();
                        }}
                        className={inputCls}>
                        <option value="">선택</option>
                        <option value="자차">자차</option>
                        <option value="렌트">렌트</option>
                        <option value="회사차량">회사차량</option>
                        <option value="기타">기타</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>차량번호 <span className="text-red-500">*</span></label>
                      {v.vehicle_type === "회사차량" ? (
                        <select value={v.plate_number} onChange={e => {
                          const cv = companyVehicles.find(c => c.plate_number === e.target.value);
                          setVehicles(prev => prev.map((x, idx) => idx === i ? {
                            ...x,
                            plate_number: e.target.value,
                            model: cv?.model ?? "",
                            fuel_type: (cv?.fuel_type ?? "") as Vehicle["fuel_type"],
                            year_made: cv?.year_made ?? "",
                          } : x));
                        }} className={inputCls}>
                          <option value="">{cvLoading ? "로딩 중..." : "차량 선택"}</option>
                          {companyVehicles.map(cv => (
                            <option key={cv.id} value={cv.plate_number}>{cv.plate_number} ({cv.model})</option>
                          ))}
                        </select>
                      ) : (
                        <input type="text" value={v.plate_number}
                          onChange={e => setVehicles(prev => prev.map((x, idx) => idx === i ? { ...x, plate_number: e.target.value } : x))}
                          placeholder="예: 12가 3456" lang="ko" className={inputCls} />
                      )}
                    </div>
                    <div>
                      <label className={labelCls}>차종 <span className="text-red-500">*</span></label>
                      <input type="text" value={v.model}
                        onChange={e => setVehicles(prev => prev.map((x, idx) => idx === i ? { ...x, model: e.target.value } : x))}
                        readOnly={v.vehicle_type === "회사차량"}
                        placeholder="예: 쏘나타, 포터" lang="ko"
                        className={inputCls + (v.vehicle_type === "회사차량" ? " bg-gray-100 dark:bg-gray-600 cursor-not-allowed" : "")} />
                    </div>
                    <div>
                      <label className={labelCls}>년식</label>
                      <input type="text" value={v.year_made}
                        onChange={e => setVehicles(prev => prev.map((x, idx) => idx === i ? { ...x, year_made: e.target.value.replace(/\D/g, "").slice(0, 4) } : x))}
                        readOnly={v.vehicle_type === "회사차량"}
                        placeholder="예: 2023" inputMode="numeric" maxLength={4}
                        className={inputCls + " font-mono" + (v.vehicle_type === "회사차량" ? " bg-gray-100 dark:bg-gray-600 cursor-not-allowed" : "")} />
                    </div>
                    <div>
                      <label className={labelCls}>유종 <span className="text-red-500">*</span></label>
                      <select value={v.fuel_type}
                        onChange={e => setVehicles(prev => prev.map((x, idx) => idx === i ? { ...x, fuel_type: e.target.value as Vehicle["fuel_type"] } : x))}
                        disabled={v.vehicle_type === "회사차량"}
                        className={inputCls + (v.vehicle_type === "회사차량" ? " bg-gray-100 dark:bg-gray-600 cursor-not-allowed" : "")}>
                        <option value="">선택</option>
                        <option value="가솔린">가솔린</option>
                        <option value="디젤">디젤</option>
                        <option value="가스">가스</option>
                        <option value="전기">전기</option>
                        <option value="기타">기타</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>차량등록일</label>
                      <input type="text" value={v.registration_date}
                        onChange={e => setVehicles(prev => prev.map((x, idx) => idx === i ? { ...x, registration_date: formatDate(e.target.value) } : x))}
                        placeholder="YYYYMMDD" inputMode="numeric" maxLength={10}
                        className={inputCls + " font-mono"} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= 교육 및 자격 ================= */}
        {tab === "cert" && (
          <div className={sectionCls}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">교육 및 자격 ({certs.length}건)</h2>
              <button type="button"
                onClick={() => setCerts(prev => [...prev, { ...EMPTY_CERT }])}
                className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">
                + 자격 추가
              </button>
            </div>
            {certs.length === 0 && (
              <div className="text-center py-4 text-xs text-gray-400 dark:text-gray-500">
                등록된 자격이 없습니다. 필요시 우상단 [+ 자격 추가] 클릭
              </div>
            )}
            <div className="space-y-3">
              {certs.map((c, i) => (
                <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 bg-gray-50 dark:bg-gray-700/30">
                  <div className="flex items-center justify-between mb-2">
                    <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-bold">
                      <input type="checkbox" checked={c.self_check}
                        onChange={e => setCerts(prev => prev.map((x, idx) => idx === i ? { ...x, self_check: e.target.checked } : x))}
                        className="rounded" />
                      <span className={c.self_check ? "text-emerald-600 dark:text-emerald-300" : "text-gray-500 dark:text-gray-400"}>
                        자체점검여부
                      </span>
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="text-[11px] text-gray-400">#{i + 1}</div>
                      <button type="button"
                        onClick={() => setCerts(prev => prev.filter((_, idx) => idx !== i))}
                        className="text-[11px] text-red-500 hover:text-red-700">
                        삭제
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-2">
                    <div>
                      <label className={labelCls}>자격명 <span className="text-red-500">*</span></label>
                      <input type="text" value={c.cert_name}
                        onChange={e => setCerts(prev => prev.map((x, idx) => idx === i ? { ...x, cert_name: e.target.value } : x))}
                        placeholder="예: 산업안전기사" lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>자격번호</label>
                      <input type="text" value={c.cert_number}
                        onChange={e => setCerts(prev => prev.map((x, idx) => idx === i ? { ...x, cert_number: e.target.value } : x))}
                        placeholder="예: 22-12345" className={inputCls + " font-mono"} />
                    </div>
                    <div>
                      <label className={labelCls}>발행기관</label>
                      <input type="text" value={c.issuer}
                        onChange={e => setCerts(prev => prev.map((x, idx) => idx === i ? { ...x, issuer: e.target.value } : x))}
                        placeholder="예: 한국산업인력공단" lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>취득일</label>
                      <input type="text" value={c.acquired_date}
                        onChange={e => setCerts(prev => prev.map((x, idx) => idx === i ? { ...x, acquired_date: formatDate(e.target.value) } : x))}
                        placeholder="YYYYMMDD" inputMode="numeric" maxLength={10}
                        className={inputCls + " font-mono"} />
                    </div>
                    <div>
                      <label className={labelCls}>만료일</label>
                      <input type="text" value={c.expiry_date}
                        onChange={e => setCerts(prev => prev.map((x, idx) => idx === i ? { ...x, expiry_date: formatDate(e.target.value) } : x))}
                        placeholder="YYYYMMDD (없으면 공백)" inputMode="numeric" maxLength={10}
                        className={inputCls + " font-mono"} />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>자격증 사본 (이미지·PDF, 최대 10MB)</label>
                    <div className="flex items-center gap-2">
                      <input id={`cert-doc-${i}`} type="file" accept="image/*,application/pdf"
                        onChange={e => {
                          const f = e.target.files?.[0] ?? null;
                          const previewName = f ? f.name : "";
                          setCerts(prev => prev.map((x, idx) => idx === i ? { ...x, doc_file: f, doc_preview: previewName } : x));
                        }}
                        className="hidden" />
                      <label htmlFor={`cert-doc-${i}`}
                        className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold cursor-pointer hover:bg-blue-700 whitespace-nowrap">
                        📁 파일 선택
                      </label>
                      <span className="text-xs text-gray-600 dark:text-gray-300 truncate flex-1">
                        {c.doc_preview || "선택된 파일 없음"}
                      </span>
                      {c.doc_file && (
                        <button type="button"
                          onClick={() => setCerts(prev => prev.map((x, idx) => idx === i ? { ...x, doc_file: null, doc_preview: "" } : x))}
                          className="text-xs text-red-500 hover:text-red-700">
                          지우기
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= 상벌사항 ================= */}
        {tab === "rp" && (
          <div className={sectionCls}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">상벌사항 ({rps.length}건)</h2>
              <button type="button"
                onClick={() => setRps(prev => [...prev, { ...EMPTY_RP }])}
                className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">
                + 상벌 추가
              </button>
            </div>
            {rps.length === 0 && (
              <div className="text-center py-4 text-xs text-gray-400 dark:text-gray-500">
                등록된 상벌이 없습니다. 필요시 우상단 [+ 상벌 추가] 클릭
              </div>
            )}
            <div className="space-y-3">
              {rps.map((r, i) => (
                <div key={i} className={`rounded-lg border p-3 ${
                  r.kind === "상" ? "border-amber-300 bg-amber-50 dark:bg-amber-900/20"
                  : r.kind === "벌" ? "border-red-300 bg-red-50 dark:bg-red-900/20"
                  : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30"
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400">#{i + 1}</div>
                    <button type="button"
                      onClick={() => setRps(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-[11px] text-red-500 hover:text-red-700">
                      삭제
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr_140px] gap-2">
                    <div>
                      <label className={labelCls}>구분 <span className="text-red-500">*</span></label>
                      <select value={r.kind}
                        onChange={e => setRps(prev => prev.map((x, idx) => idx === i ? { ...x, kind: e.target.value as RP["kind"] } : x))}
                        className={inputCls}>
                        <option value="">선택</option>
                        <option value="상">🏆 상</option>
                        <option value="벌">⚠️ 벌</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>내용 <span className="text-red-500">*</span></label>
                      <input type="text" value={r.content}
                        onChange={e => setRps(prev => prev.map((x, idx) => idx === i ? { ...x, content: e.target.value } : x))}
                        placeholder="예: 우수사원 표창, 안전수칙 위반 경고"
                        lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>일자</label>
                      <input type="text" value={r.occurred_on}
                        onChange={e => setRps(prev => prev.map((x, idx) => idx === i ? { ...x, occurred_on: formatDate(e.target.value) } : x))}
                        placeholder="YYYYMMDD" inputMode="numeric" maxLength={10}
                        className={inputCls + " font-mono"} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 메시지 */}
        {message && (
          <div className={`px-4 py-3 rounded-lg text-sm ${
            message.type === "success"
              ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700"
              : "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700"
          }`}>{message.text}</div>
        )}

        {/* 액션 */}
        <div className="flex gap-2 pt-2 sticky bottom-0 bg-gray-50 dark:bg-gray-900 py-3 -mx-4 lg:-mx-6 px-4 lg:px-6 border-t border-gray-200 dark:border-gray-700">
          <button type="button" onClick={resetAll}
            className="px-6 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold">
            초기화
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
            {saving ? "등록 중..." : "사원 등록"}
          </button>
        </div>

      </form>
    </div>
  );
}
