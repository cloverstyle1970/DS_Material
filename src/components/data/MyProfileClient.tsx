"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { changeAuthPassword } from "@/lib/auth-ops";
import { formatDate as formatYmd, formatPhone, formatSsn } from "@/lib/input-format";

// 사원관리(UsersClient)에서 관리자가 사원 이름을 클릭할 때 세팅됨
// 같은 키를 UsersClient에서도 export 해 사용
const ADMIN_EDIT_USER_KEY = "ds_admin_edit_user_id";

const PHOTO_BUCKET = "employee-photos";
const CERT_DOCS_BUCKET = "cert-docs";
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

type TabKey = "basic" | "family" | "career" | "vehicle" | "cert" | "rp" | "status_history";

interface UserRow {
  id: number;
  name: string;
  ssn: string | null;
  gender: "M" | "F" | null;
  blood_type: string | null;
  hire_date: string | null;
  dept: string | null;
  rank: string | null;
  status: string | null;
  phone: string | null;
  email: string | null;
  emergency_contact: string | null;
  postal_code: string | null;
  address: string | null;
  photo_url: string | null;
  uniform_top_size: string | null;
  uniform_bottom_size: string | null;
  safety_shoes_size: string | null;
}

interface FamilyMember {
  id?: number;
  relationship: string;
  name: string;
  gender: "M" | "F" | "";
  birth_date: string;
  occupation: string;
  cohabiting: boolean;
  is_emergency: boolean;
  phone: string;
}

interface Vehicle {
  id?: number;
  vehicle_type: "자차" | "렌트" | "회사차량" | "기타" | "";
  plate_number: string;
  model: string;
  year_made: string;
  fuel_type: "가솔린" | "디젤" | "가스" | "전기" | "기타" | "";
  registration_date: string;
  insurance_company?: string | null;
  insurance_start_date?: string | null;
  insurance_end_date?: string | null;
}

interface Certification {
  id?: number;
  cert_name: string;
  cert_number: string;
  self_check: boolean;
  acquired_date: string;
  expiry_date: string;
  issuer: string;
  cert_doc_url: string | null;
  doc_file: File | null;
  doc_preview: string;
}

interface Career {
  id?: number;
  company_name: string;
  joined_date: string;
  left_date: string;
  dept: string;
  rank: string;
  duty: string;
}

interface RP {
  id?: number;
  kind: "상" | "벌" | "";
  content: string;
  occurred_on: string;
}

interface StatusHistory {
  id?: number;
  status_type: "입사" | "퇴직" | "휴직" | "복직" | "재입사" | "부서이동" | "진급" | "강등" | "전보" | "직책변경" | "겸직" | "";
  event_date: string;
  reason: string;
  from_dept?: string;
  to_dept?: string;
  from_rank?: string;
  to_rank?: string;
}

const EMPTY_FAMILY: FamilyMember = {
  relationship: "", name: "", gender: "", birth_date: "", occupation: "",
  cohabiting: true, is_emergency: false, phone: "",
};
const EMPTY_VEHICLE: Vehicle = {
  vehicle_type: "", plate_number: "", model: "", year_made: "",
  fuel_type: "", registration_date: "",
};
const EMPTY_CERT: Certification = {
  cert_name: "", cert_number: "", self_check: false,
  acquired_date: "", expiry_date: "", issuer: "",
  cert_doc_url: null, doc_file: null, doc_preview: "",
};
const EMPTY_CAREER: Career = {
  company_name: "", joined_date: "", left_date: "", dept: "", rank: "", duty: "",
};
const EMPTY_RP: RP = { kind: "", content: "", occurred_on: "" };
const EMPTY_STATUS_HISTORY: StatusHistory = { status_type: "", event_date: "", reason: "", from_dept: "", to_dept: "", from_rank: "", to_rank: "" };

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "basic",   label: "기본정보",     icon: "👤" },
  { key: "family",  label: "가족정보",     icon: "👨‍👩‍👧" },
  { key: "career",  label: "경력",         icon: "💼" },
  { key: "vehicle", label: "차량등록",     icon: "🚗" },
  { key: "cert",    label: "교육 및 자격", icon: "📜" },
  { key: "rp",      label: "상벌사항",     icon: "🏅" },
  { key: "status_history", label: "발령/재직상태 이력", icon: "📅" },
];

function displaySsn(ssn: string | null | undefined): string {
  if (!ssn) return "";
  const d = ssn.replace(/\D/g, "");
  if (d.length <= 6) return d;
  return d.slice(0, 6) + "-" + d.slice(6, 13);
}

export default function MyProfileClient() {
  const { user } = useAuth();
  const meIsAdmin = user ? isAdmin(user) : false;

  // 관리자 대리편집 대상 (null = 본인 편집)
  // sessionStorage 값을 동기적으로 lazy-init해 첫 load부터 올바른 ID로 fire되게 함.
  // 비-admin이거나 본인 ID와 같은 경우는 resolve effect에서 다시 정리한다.
  const [adminTargetId, setAdminTargetId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(ADMIN_EDIT_USER_KEY);
      const id = raw ? Number(raw) : NaN;
      return Number.isFinite(id) ? id : null;
    } catch { return null; }
  });
  // meIsAdmin이 아니면 sessionStorage 값을 무시 (비-admin은 무조건 본인 편집)
  const effectiveTargetId = meIsAdmin ? adminTargetId : null;
  const editingUserId = effectiveTargetId ?? user?.id ?? null;
  const isAdminEditing = effectiveTargetId !== null && effectiveTargetId !== user?.id;

  // 부서/직급 마스터 — 대리편집 모드에서만 select 필요
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [ranks, setRanks] = useState<{ id: number; name: string }[]>([]);

  const [tab, setTab] = useState<TabKey>("basic");
  const [loaded, setLoaded] = useState(false);
  const [row, setRow] = useState<UserRow | null>(null);

  // 관리자 모드 한정: 잠금 필드도 편집 가능
  const [editName, setEditName]         = useState("");
  const [editSsn, setEditSsn]           = useState("");
  const [editHireDate, setEditHireDate] = useState("");
  const [editDept, setEditDept]         = useState("");
  const [editRank, setEditRank]         = useState("");
  const [editStatus, setEditStatus]     = useState("재직");

  // 기본정보 편집 가능 필드 (본인/관리자 공통)
  const [gender, setGender] = useState<"M" | "F" | "">("");
  const [bloodType, setBloodType] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [addressBasic, setAddressBasic] = useState("");
  const [addressDetail, setAddressDetail] = useState("");
  const [topSize, setTopSize] = useState("");
  const [bottomSize, setBottomSize] = useState("");
  const [shoesSize, setShoesSize] = useState("");

  // 사진
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>("");
  const photoInputRef = useRef<HTMLInputElement>(null);

  // 1:N
  const [family, setFamily] = useState<FamilyMember[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [certs, setCerts] = useState<Certification[]>([]);
  const [careers, setCareers] = useState<Career[]>([]);
  const [rps, setRps] = useState<RP[]>([]);
  const [statusHistory, setStatusHistory] = useState<StatusHistory[]>([]);

  // 회사차량
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

  const [daumReady, setDaumReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 비밀번호 변경
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwStatus, setPwStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);

  useEffect(() => {
    if (window.daum?.Postcode) { setDaumReady(true); return; }
    const existing = document.querySelector(`script[src="${DAUM_SCRIPT_SRC}"]`) as HTMLScriptElement | null;
    if (existing) { existing.addEventListener("load", () => setDaumReady(true)); return; }
    const s = document.createElement("script");
    s.src = DAUM_SCRIPT_SRC; s.async = true;
    s.onload = () => setDaumReady(true);
    document.body.appendChild(s);
  }, []);

  // 관리자 대리편집 대상 resolve — sessionStorage 변화에 반응
  useEffect(() => {
    function resolve() {
      if (!user || !isAdmin(user)) { setAdminTargetId(null); return; }
      try {
        const raw = sessionStorage.getItem(ADMIN_EDIT_USER_KEY);
        const id = raw ? Number(raw) : NaN;
        setAdminTargetId(Number.isFinite(id) && id !== user.id ? id : null);
      } catch { setAdminTargetId(null); }
    }
    resolve();
    window.addEventListener("ds:admin-edit-user-changed", resolve);
    return () => window.removeEventListener("ds:admin-edit-user-changed", resolve);
  }, [user]);

  // 부서/직급 마스터 — 대리편집 모드 진입 시 1회 로드
  useEffect(() => {
    if (!isAdminEditing) return;
    if (departments.length > 0 && ranks.length > 0) return;
    (async () => {
      const [d, r] = await Promise.all([
        supabase.from("departments").select("id, name").eq("is_active", true).order("sort_order"),
        supabase.from("ranks").select("id, name").eq("is_active", true).order("sort_order"),
      ]);
      if (d.data) setDepartments(d.data as { id: number; name: string }[]);
      if (r.data) setRanks(r.data as { id: number; name: string }[]);
    })();
  }, [isAdminEditing, departments.length, ranks.length]);

  // 마지막으로 fire한 load 요청 식별자. 더 늦게 도착한 stale 응답을 폐기해 race condition 차단.
  const loadReqRef = useRef(0);

  useEffect(() => {
    if (!editingUserId) return;
    const reqId = ++loadReqRef.current;
    setLoaded(false);
    (async () => {
      const [u, fam, veh, cert, car, rp] = await Promise.all([
        supabase.from("accounts").select("*").eq("id", editingUserId).single(),
        supabase.from("user_family_members").select("*").eq("user_id", editingUserId).order("sort_order"),
        supabase.from("user_vehicles").select("*").eq("user_id", editingUserId).order("sort_order"),
        supabase.from("user_certifications").select("*").eq("user_id", editingUserId).order("sort_order"),
        supabase.from("user_career_history").select("*").eq("user_id", editingUserId).order("sort_order"),
        supabase.from("user_rewards_punishments").select("*").eq("user_id", editingUserId).order("sort_order"),
      ]);

      let shData = [];
      try {
        const { data, error } = await supabase
          .from("user_status_history")
          .select("*")
          .eq("user_id", editingUserId)
          .order("event_date", { ascending: true });
        if (!error && data) {
          shData = data;
        }
      } catch (err) {
        console.error("user_status_history table query failed:", err);
      }

      // 후속 load가 시작됐다면 이 응답은 무시 (target 사용자가 admin 자신으로 덮어쓰이지 않도록)
      if (reqId !== loadReqRef.current) return;
      // accounts: username 이 단일 진리원 → name 필드로 정규화해 다운스트림과 일관 유지
      const raw = u.data as (UserRow & { username?: string }) | null;
      const r = raw ? { ...raw, name: raw.username ?? "" } as UserRow : null;
      if (r) {
        setRow(r);
        setEditName(r.name ?? "");
        setEditSsn(displaySsn(r.ssn));
        setEditHireDate(r.hire_date ?? "");
        setEditDept(r.dept ?? "");
        setEditRank(r.rank ?? "");
        setEditStatus(r.status ?? "재직");
        setGender((r.gender ?? "") as "M" | "F" | "");
        setBloodType(r.blood_type ?? "");
        setPhone(r.phone ?? "");
        setEmail(r.email ?? "");
        setPostalCode(r.postal_code ?? "");
        setAddressBasic(r.address ?? "");
        setAddressDetail("");
        setTopSize(r.uniform_top_size ?? "");
        setBottomSize(r.uniform_bottom_size ?? "");
        setShoesSize(r.safety_shoes_size ?? "");
        setPhotoUrl(r.photo_url ?? null);
        setPhotoFile(null);
        setPhotoPreview("");
        setMessage(null);
      }
      type FamilyRow = Partial<FamilyMember> & { gender?: string | null; phone?: string | null; is_emergency?: boolean | null };
      setFamily(((fam.data ?? []) as FamilyRow[]).map(f => ({
        id: f.id,
        relationship: f.relationship ?? "",
        name: f.name ?? "",
        gender: ((f.gender ?? "") as "M" | "F" | ""),
        birth_date: f.birth_date ?? "",
        occupation: f.occupation ?? "",
        cohabiting: f.cohabiting ?? true,
        is_emergency: f.is_emergency ?? false,
        phone: f.phone ?? "",
      })));
      const vehData = ((veh.data ?? []) as Vehicle[]).map(v => ({
        ...v,
        plate_number: v.plate_number ?? "",
        model: v.model ?? "",
        year_made: v.year_made ?? "",
        registration_date: v.registration_date ?? "",
        insurance_company: v.insurance_company ?? "",
        insurance_start_date: v.insurance_start_date ?? "",
        insurance_end_date: v.insurance_end_date ?? "",
      }));
      setVehicles(vehData);
      if (vehData.some(v => v.vehicle_type === "회사차량")) {
        void loadCompanyVehicles();
      }
      type CertRow = Partial<Certification> & { self_check?: boolean | null; acquired_date?: string | null; expiry_date?: string | null; issuer?: string | null };
      setCerts(((cert.data ?? []) as CertRow[]).map(c => ({
        id: c.id,
        cert_name: c.cert_name ?? "",
        cert_number: c.cert_number ?? "",
        self_check: c.self_check ?? false,
        acquired_date: c.acquired_date ?? "",
        expiry_date: c.expiry_date ?? "",
        issuer: c.issuer ?? "",
        cert_doc_url: c.cert_doc_url ?? null,
        doc_file: null,
        doc_preview: c.cert_doc_url ? "기존 파일" : "",
      })));
      type CareerRow = Partial<Career>;
      setCareers(((car.data ?? []) as CareerRow[]).map(c => ({
        id: c.id,
        company_name: c.company_name ?? "",
        joined_date: c.joined_date ?? "",
        left_date: c.left_date ?? "",
        dept: c.dept ?? "",
        rank: c.rank ?? "",
        duty: c.duty ?? "",
      })));
      type RpRow = Partial<RP> & { kind?: string | null };
      setRps(((rp.data ?? []) as RpRow[]).map(r => ({
        id: r.id,
        kind: ((r.kind ?? "") as RP["kind"]),
        content: r.content ?? "",
        occurred_on: r.occurred_on ?? "",
      })));

      type ShRow = Partial<StatusHistory> & { status_type?: string | null; event_date?: string | null; reason?: string | null; from_dept?: string | null; to_dept?: string | null; from_rank?: string | null; to_rank?: string | null };
      setStatusHistory((shData as ShRow[]).map(s => ({
        id: s.id,
        status_type: ((s.status_type ?? "") as StatusHistory["status_type"]),
        event_date: s.event_date ?? "",
        reason: s.reason ?? "",
        from_dept: s.from_dept ?? "",
        to_dept: s.to_dept ?? "",
        from_rank: s.from_rank ?? "",
        to_rank: s.to_rank ?? "",
      })));

      setLoaded(true);
    })();
  }, [editingUserId]);

  function returnToSelf() {
    try { sessionStorage.removeItem(ADMIN_EDIT_USER_KEY); } catch {}
    setAdminTargetId(null);
  }

  if (!user) {
    return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  }

  function openPostcode() {
    if (!window.daum?.Postcode) { alert("우편번호 서비스를 불러오는 중입니다."); return; }
    new window.daum.Postcode({
      oncomplete: data => { setPostalCode(data.zonecode); setAddressBasic(data.address); }
    }).open();
  }

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoFile(f);
    const reader = new FileReader();
    reader.onload = ev => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  }

  async function uploadFile(bucket: string, file: Blob, ext: string): Promise<string> {
    const ownerId = editingUserId ?? user!.id;
    const path = `${ownerId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { cacheControl: "3600", upsert: false });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  async function handlePasswordChange() {
    if (!user) return;
    setPwStatus(null);
    if (!currentPw) { setPwStatus({ type: "error", text: "현재 비밀번호를 입력하세요." }); return; }
    if (newPw.length < 6) { setPwStatus({ type: "error", text: "새 비밀번호는 6자 이상이어야 합니다." }); return; }
    if (newPw !== confirmPw) { setPwStatus({ type: "error", text: "새 비밀번호가 일치하지 않습니다." }); return; }
    if (currentPw === newPw) { setPwStatus({ type: "error", text: "새 비밀번호가 현재 비밀번호와 같습니다." }); return; }

    setPwSubmitting(true);
    try {
      // 신DB 로그인은 accounts.password(평문) 기반 → 유지보수 사이트와 동일 컬럼으로 일원화.
      const { data: r, error: fErr } = await supabase
        .from("accounts")
        .select("password")
        .eq("id", user.id)
        .single();
      if (fErr || !r) { setPwStatus({ type: "error", text: "사용자 정보를 불러오지 못했습니다." }); return; }
      const stored = r.password as string | null;
      if (stored != null && currentPw !== stored) {
        setPwStatus({ type: "error", text: "현재 비밀번호가 올바르지 않습니다." });
        return;
      }
      const { error: uErr } = await supabase
        .from("accounts")
        .update({ password: newPw })
        .eq("id", user.id);
      if (uErr) { setPwStatus({ type: "error", text: `비밀번호 변경 실패: ${uErr.message}` }); return; }
      // 유지보수 사이트(auth.users) 측 비번도 같이 갱신해 두 시스템 비번을 일치시킨다.
      const authRes = await changeAuthPassword(user.id, newPw);
      if (!authRes.ok) {
        setPwStatus({ type: "error", text: `비밀번호 변경 실패(유지보수 동기화): ${authRes.error}` });
        return;
      }
      setPwStatus({ type: "success", text: "비밀번호가 변경되었습니다." });
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } finally {
      setPwSubmitting(false);
    }
  }

  function setEmergency(targetIdx: number, on: boolean) {
    setFamily(prev => prev.map((m, i) => ({
      ...m,
      is_emergency: i === targetIdx ? on : (on ? false : m.is_emergency),
    })));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user || !row || !editingUserId) return;
    setMessage(null);

    // 관리자 대리편집 모드: 잠금 필드 검증
    if (isAdminEditing) {
      if (!editName.trim()) { setMessage({ type: "error", text: "[기본정보] 성명은 필수입니다." }); setTab("basic"); return; }
    }

    // 긴급연락처 — 선택. 지정한 경우에만 필수필드 검증
    const emergency = family.find(m => m.is_emergency);
    if (emergency && (!emergency.relationship.trim() || !emergency.name.trim() || !emergency.phone.trim())) {
      setMessage({ type: "error", text: "[가족정보] 긴급연락처 지정 시 관계·성명·연락처는 모두 필수입니다." });
      setTab("family"); return;
    }

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v.vehicle_type || !v.plate_number.trim() || !v.model.trim() || !v.fuel_type) {
        setMessage({ type: "error", text: `[차량등록] 차량 #${i + 1}의 필수 항목(구분/차량번호/차종/유종)을 모두 입력하세요.` });
        setTab("vehicle"); return;
      }
    }
    for (let i = 0; i < certs.length; i++) {
      if (!certs[i].cert_name.trim()) {
        setMessage({ type: "error", text: `[교육및자격] 자격 #${i + 1}의 자격명을 입력하세요.` });
        setTab("cert"); return;
      }
    }
    for (let i = 0; i < careers.length; i++) {
      if (!careers[i].company_name.trim()) {
        setMessage({ type: "error", text: `[경력] 경력 #${i + 1}의 회사명을 입력하세요.` });
        setTab("career"); return;
      }
    }
    for (let i = 0; i < rps.length; i++) {
      if (!rps[i].kind || !rps[i].content.trim()) {
        setMessage({ type: "error", text: `[상벌사항] #${i + 1}의 구분과 내용은 필수입니다.` });
        setTab("rp"); return;
      }
    }

    setSaving(true);
    try {
      let newPhotoUrl: string | null = photoUrl;
      if (photoFile) {
        const ext = photoFile.name.split(".").pop()?.toLowerCase() || "jpg";
        newPhotoUrl = await uploadFile(PHOTO_BUCKET, photoFile, ext);
      }
      const fullAddress = [addressBasic, addressDetail].filter(Boolean).join(" ").trim();

      // users — 본인 수정 가능 필드. 관리자 대리편집 모드에서는 잠금 필드(name/ssn/hire_date/dept/rank/status)도 함께 갱신.
      const usersPatch: Record<string, unknown> = {
        gender: gender || null,
        blood_type: bloodType || null,
        phone: phone || null,
        email: email || null,
        emergency_contact: emergency ? `${emergency.relationship} ${emergency.name} ${emergency.phone}`.trim() : null,
        postal_code: postalCode || null,
        address: fullAddress || null,
        photo_url: newPhotoUrl,
        uniform_top_size: topSize || null,
        uniform_bottom_size: bottomSize || null,
        safety_shoes_size: shoesSize || null,
      };
      if (isAdminEditing) {
        usersPatch.username  = editName.trim();   // accounts: username 이 단일 진리원 (name 컬럼 미사용)
        usersPatch.ssn       = editSsn || null;
        usersPatch.hire_date = editHireDate || null;
        usersPatch.dept      = editDept || null;
        usersPatch.rank      = editRank || null;
        usersPatch.status    = editStatus || null;
      }
      const { error: uErr } = await supabase.from("accounts").update(usersPatch).eq("id", editingUserId);
      if (uErr) throw uErr;

      // 가족 — 전체 삭제 후 재삽입
      await supabase.from("user_family_members").delete().eq("user_id", editingUserId);
      const validFam = family.filter(m => m.relationship.trim() && m.name.trim());
      if (validFam.length > 0) {
        const { error: fErr } = await supabase.from("user_family_members").insert(
          validFam.map((m, i) => ({
            user_id: editingUserId,
            relationship: m.relationship,
            name: m.name.trim(),
            gender: m.gender || null,
            birth_date: m.birth_date || null,
            occupation: m.occupation || null,
            cohabiting: m.cohabiting,
            is_emergency: m.is_emergency,
            phone: m.phone || null,
            sort_order: (i + 1) * 10,
          }))
        );
        if (fErr) throw fErr;
      }

      // 차량 — 회사차량은 관리자가 관리하므로 보존
      await supabase.from("user_vehicles").delete().eq("user_id", editingUserId).neq("vehicle_type", "회사차량");
      const editableVehicles = vehicles.filter(v => v.vehicle_type !== "회사차량");
      if (editableVehicles.length > 0) {
        const { error: vErr } = await supabase.from("user_vehicles").insert(
          editableVehicles.map((v, i) => ({
            user_id: editingUserId,
            vehicle_type: v.vehicle_type,
            plate_number: v.plate_number.trim(),
            model: v.model.trim(),
            year_made: v.year_made || null,
            fuel_type: v.fuel_type,
            registration_date: v.registration_date || null,
            sort_order: (i + 1) * 10,
          }))
        );
        if (vErr) throw vErr;
      }

      // 자격
      await supabase.from("user_certifications").delete().eq("user_id", editingUserId);
      if (certs.length > 0) {
        const certRows: Array<Record<string, unknown>> = [];
        for (let i = 0; i < certs.length; i++) {
          const c = certs[i];
          let docUrl: string | null = c.cert_doc_url;
          if (c.doc_file) {
            const ext = c.doc_file.name.split(".").pop()?.toLowerCase() || "bin";
            docUrl = await uploadFile(CERT_DOCS_BUCKET, c.doc_file, ext);
          }
          certRows.push({
            user_id: editingUserId,
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
        const { error: cErr } = await supabase.from("user_certifications").insert(certRows);
        if (cErr) throw cErr;
      }

      // 경력
      await supabase.from("user_career_history").delete().eq("user_id", editingUserId);
      if (careers.length > 0) {
        const { error: cErr } = await supabase.from("user_career_history").insert(
          careers.map((c, i) => ({
            user_id: editingUserId,
            company_name: c.company_name.trim(),
            joined_date: c.joined_date || null,
            left_date: c.left_date || null,
            dept: c.dept || null,
            rank: c.rank || null,
            duty: c.duty || null,
            sort_order: (i + 1) * 10,
          }))
        );
        if (cErr) throw cErr;
      }

      // 상벌
      await supabase.from("user_rewards_punishments").delete().eq("user_id", editingUserId);
      if (rps.length > 0) {
        const { error: rpErr } = await supabase.from("user_rewards_punishments").insert(
          rps.map((r, i) => ({
            user_id: editingUserId,
            kind: r.kind,
            content: r.content.trim(),
            occurred_on: r.occurred_on || null,
            sort_order: (i + 1) * 10,
          }))
        );
        if (rpErr) throw rpErr;
      }

      // 발령/재직상태 이력
      try {
        await supabase.from("user_status_history").delete().eq("user_id", editingUserId);
        const validSh = statusHistory.filter(s => s.status_type && s.event_date);
        if (validSh.length > 0) {
          const { error: shErr } = await supabase.from("user_status_history").insert(
            validSh.map((s, i) => ({
              user_id: editingUserId,
              status_type: s.status_type,
              event_date: s.event_date || null,
              reason: s.reason || null,
              from_dept: s.from_dept || null,
              to_dept: s.to_dept || null,
              from_rank: s.from_rank || null,
              to_rank: s.to_rank || null,
              sort_order: (i + 1) * 10,
            }))
          );
          if (shErr) throw shErr;
        }
      } catch (shSaveErr) {
        console.error("user_status_history save failed (possibly table not migrated yet):", shSaveErr);
      }

      if (newPhotoUrl !== photoUrl) {
        setPhotoUrl(newPhotoUrl);
        setPhotoFile(null);
        setPhotoPreview("");
      }
      setMessage({ type: "success", text: isAdminEditing ? `${editName.trim()} 님의 정보가 저장되었습니다.` : "개인정보가 저장되었습니다." });
    } catch (err) {
      console.error("[my-profile] save error:", err);
      const msg = err instanceof Error ? err.message : (() => { try { return JSON.stringify(err); } catch { return String(err); } })();
      setMessage({ type: "error", text: `저장 실패: ${msg}` });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return <div className="p-12 text-center text-sm text-gray-500">로딩 중...</div>;
  }

  if (!row) {
    return <div className="p-12 text-center text-sm text-gray-500">사원 정보를 불러올 수 없습니다.</div>;
  }

  const inputCls = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400";
  const lockedCls = inputCls + " bg-gray-100 dark:bg-gray-900/40 text-gray-500 dark:text-gray-400 cursor-not-allowed";
  const labelCls = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1";
  const sectionCls = "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5";

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">개인정보수정</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {isAdminEditing
            ? "🛡️ 관리자 편집 모드 — 잠금 필드 포함 모든 정보를 수정할 수 있습니다."
            : "본인의 정보만 수정할 수 있습니다 · 성명·주민번호·입사일·부서·직급·재직상태는 관리자만 변경 가능"}
        </p>
      </div>

      {isAdminEditing && (
        <div className="px-6 py-2 bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 flex items-center justify-between">
          <div className="text-xs text-amber-800 dark:text-amber-200">
            🔧 <strong>관리자 편집 모드</strong>
            {row && <> — <span className="font-semibold">{row.name}</span> 님 (사원번호 #{row.id}) 의 정보를 편집 중</>}
          </div>
          <button type="button" onClick={returnToSelf}
            className="text-xs px-3 py-1 rounded-lg bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-800/50 font-medium">
            ↩ 내 정보로 돌아가기
          </button>
        </div>
      )}

      {/* 탭 */}
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

      <form onSubmit={handleSubmit}
        onKeyDown={e => {
          if (e.key !== "Enter") return;
          if ((e.nativeEvent as KeyboardEvent).isComposing) return;
          const t = e.target as HTMLElement;
          if (t.tagName === "TEXTAREA" || t.tagName === "BUTTON") return;
          const inp = t as HTMLInputElement;
          if (inp.type === "submit") return;
          e.preventDefault();
          const focusables = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(
            "input:not([disabled]):not([type=hidden]):not([readonly]), select:not([disabled])"
          ));
          const idx = focusables.indexOf(t);
          if (idx >= 0 && idx < focusables.length - 1) focusables[idx + 1].focus();
        }}
        className="p-4 lg:p-6 max-w-6xl mx-auto space-y-4">

        {/* ================= 기본정보 ================= */}
        {tab === "basic" && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
              <div className={sectionCls + " flex flex-col"}>
                <label className={labelCls}>📷 프로필 사진 <span className="text-[10px] text-gray-400">(증명사진 3:4)</span></label>
                <div className="w-full aspect-[3/4] rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 overflow-hidden flex items-center justify-center mb-3 mx-auto">
                  {(photoPreview || photoUrl) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoPreview || photoUrl!} alt="프로필" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center text-gray-400">
                      <div className="text-5xl mb-1">👤</div>
                      <div className="text-[10px]">사진 없음</div>
                    </div>
                  )}
                </div>
                <input ref={photoInputRef} type="file" accept="image/*" onChange={onPhotoChange} className="hidden" id="my-photo-input" />
                <div className="flex gap-2">
                  <label htmlFor="my-photo-input" className="flex-1 text-center px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold cursor-pointer hover:bg-blue-700">
                    📁 사진 변경
                  </label>
                  {photoFile && (
                    <button type="button" onClick={() => { setPhotoFile(null); setPhotoPreview(""); if (photoInputRef.current) photoInputRef.current.value = ""; }}
                      className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 text-xs font-semibold">
                      취소
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className={sectionCls}>
                  <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">기본 정보</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className={labelCls}>성명 {isAdminEditing ? <span className="text-red-500">*</span> : "🔒"}</label>
                      {isAdminEditing
                        ? <input type="text" value={editName} onChange={e => setEditName(e.target.value)} lang="ko" required className={inputCls} />
                        : <input type="text" value={row.name} readOnly className={lockedCls} />}
                    </div>
                    <div>
                      <label className={labelCls}>주민등록번호 {isAdminEditing ? "" : "🔒"}</label>
                      {isAdminEditing
                        ? <input type="text" value={editSsn}
                            onChange={e => setEditSsn(formatSsn(e.target.value))}
                            placeholder="000000-0000000" inputMode="numeric" maxLength={14}
                            className={inputCls + " font-mono"} />
                        : <input type="text" value={displaySsn(row.ssn)} readOnly className={lockedCls + " font-mono"} />}
                    </div>
                    <div>
                      <label className={labelCls}>성별</label>
                      <select value={gender} onChange={e => setGender(e.target.value as "M" | "F" | "")} className={inputCls}>
                        <option value="">선택</option>
                        <option value="M">남</option>
                        <option value="F">여</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>입사일 {isAdminEditing ? "" : "🔒"}</label>
                      {isAdminEditing
                        ? <input type="text" value={editHireDate}
                            onChange={e => setEditHireDate(formatYmd(e.target.value))}
                            placeholder="YYYYMMDD" inputMode="numeric" maxLength={10}
                            className={inputCls + " font-mono"} />
                        : <input type="text" value={row.hire_date ?? ""} readOnly className={lockedCls} />}
                    </div>
                    <div>
                      <label className={labelCls}>부서 {isAdminEditing ? "" : "🔒"}</label>
                      {isAdminEditing ? (
                        <select value={editDept} onChange={e => setEditDept(e.target.value)} className={inputCls}>
                          <option value="">선택</option>
                          {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                          {editDept && !departments.some(d => d.name === editDept) && (
                            <option value={editDept}>{editDept} (마스터 외)</option>
                          )}
                        </select>
                      ) : (
                        <input type="text" value={row.dept ?? ""} readOnly className={lockedCls} />
                      )}
                    </div>
                    <div>
                      <label className={labelCls}>직급 {isAdminEditing ? "" : "🔒"}</label>
                      {isAdminEditing ? (
                        <select value={editRank} onChange={e => setEditRank(e.target.value)} className={inputCls}>
                          <option value="">선택</option>
                          {ranks.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                          {editRank && !ranks.some(r => r.name === editRank) && (
                            <option value={editRank}>{editRank} (마스터 외)</option>
                          )}
                        </select>
                      ) : (
                        <input type="text" value={row.rank ?? ""} readOnly className={lockedCls} />
                      )}
                    </div>
                    <div>
                      <label className={labelCls}>재직상태 {isAdminEditing ? "" : "🔒"}</label>
                      {isAdminEditing ? (
                        <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className={inputCls}>
                          <option value="재직">재직</option>
                          <option value="퇴사">퇴사</option>
                          <option value="휴직">휴직</option>
                        </select>
                      ) : (
                        <input type="text" value={row.status ?? ""} readOnly className={lockedCls} />
                      )}
                    </div>
                    <div>
                      <label className={labelCls}>혈액형</label>
                      <select value={bloodType} onChange={e => setBloodType(e.target.value)} className={inputCls}>
                        <option value="">선택</option>
                        {["A+","A-","B+","B-","O+","O-","AB+","AB-"].map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className={sectionCls}>
                    <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">연락처</h2>
                    <div className="space-y-3">
                      <div>
                        <label className={labelCls}>휴대폰</label>
                        <input type="tel" value={phone}
                          onChange={e => setPhone(formatPhone(e.target.value))}
                          placeholder="010-0000-0000 또는 02-000-0000" inputMode="tel" maxLength={14}
                          className={inputCls + " font-mono"} />
                      </div>
                      <div>
                        <label className={labelCls}>이메일</label>
                        <input type="email" value={email}
                          onChange={e => setEmail(e.target.value)}
                          placeholder="user@example.com" className={inputCls} />
                      </div>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">긴급연락처는 [가족정보] 탭에서 1명을 지정합니다.</p>
                    </div>
                  </div>

                  <div className={sectionCls}>
                    <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">주소</h2>
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input type="text" value={postalCode} readOnly placeholder="우편번호"
                          className={inputCls + " font-mono w-32 cursor-not-allowed bg-gray-50 dark:bg-gray-900/40"} />
                        <button type="button" onClick={openPostcode} disabled={!daumReady}
                          className="px-3 py-2 rounded-lg bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap">
                          {daumReady ? "🔍 우편번호" : "로딩..."}
                        </button>
                      </div>
                      <input type="text" value={addressBasic} onChange={e => setAddressBasic(e.target.value)}
                        placeholder="기본주소" lang="ko" className={inputCls} />
                      <input type="text" value={addressDetail} onChange={e => setAddressDetail(e.target.value)}
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
                  <input type="text" value={topSize} onChange={e => setTopSize(e.target.value)} placeholder="예: 95, L" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>하의</label>
                  <input type="text" value={bottomSize} onChange={e => setBottomSize(e.target.value)} placeholder="예: 30, 32" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>안전화</label>
                  <input type="text" value={shoesSize} onChange={e => setShoesSize(e.target.value)} placeholder="예: 250, 270" className={inputCls} />
                </div>
              </div>
            </div>

            {/* 로그인 비밀번호 변경 — 본인 편집 모드 전용 (관리자 대리편집에서는 숨김) */}
            {!isAdminEditing && (
            <div className={sectionCls}>
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-1">🔐 로그인 비밀번호 변경</h2>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">새 비밀번호는 6자 이상이어야 합니다.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>현재 비밀번호</label>
                  <input type="password" value={currentPw}
                    onChange={e => setCurrentPw(e.target.value)}
                    autoComplete="current-password"
                    className={inputCls + " font-mono"} />
                </div>
                <div>
                  <label className={labelCls}>새 비밀번호</label>
                  <input type="password" value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    minLength={4}
                    autoComplete="new-password"
                    className={inputCls + " font-mono"} />
                </div>
                <div>
                  <label className={labelCls}>새 비밀번호 확인</label>
                  <input type="password" value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                    minLength={4}
                    autoComplete="new-password"
                    className={inputCls + " font-mono"} />
                </div>
              </div>
              {pwStatus && (
                <div className={`mt-3 px-3 py-2 rounded-lg text-xs ${
                  pwStatus.type === "success"
                    ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700"
                    : "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700"
                }`}>{pwStatus.text}</div>
              )}
              <div className="mt-3 flex justify-end">
                <button type="button" onClick={handlePasswordChange} disabled={pwSubmitting}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold disabled:opacity-50">
                  {pwSubmitting ? "변경 중..." : "비밀번호 변경"}
                </button>
              </div>
            </div>
            )}
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
              <button type="button" onClick={() => setFamily(p => [...p, { ...EMPTY_FAMILY }])}
                className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">+ 가족 추가</button>
            </div>
            {family.length === 0 && <div className="text-center py-4 text-xs text-gray-400">등록된 가족 없음</div>}
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
                      <button type="button" onClick={() => setFamily(p => p.filter((_, idx) => idx !== i))} className="text-[11px] text-red-500">삭제</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    <div>
                      <label className={labelCls}>관계 {m.is_emergency && <span className="text-red-500">*</span>}</label>
                      <select value={m.relationship}
                        onChange={e => {
                          const rel = e.target.value;
                          const autoG: "M" | "F" | "" = rel === "부" || rel === "형제" ? "M" : rel === "모" || rel === "자매" ? "F" : m.gender;
                          setFamily(p => p.map((f, idx) => idx === i ? { ...f, relationship: rel, gender: autoG } : f));
                        }}
                        className={inputCls}>
                        <option value="">선택</option>
                        {["배우자","부","모","자녀","형제","자매","기타"].map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>성명 {m.is_emergency && <span className="text-red-500">*</span>}</label>
                      <input type="text" value={m.name} onChange={e => setFamily(p => p.map((f, idx) => idx === i ? { ...f, name: e.target.value } : f))} lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>연락처 {m.is_emergency && <span className="text-red-500">*</span>}</label>
                      <input type="tel" value={m.phone}
                        onChange={e => setFamily(p => p.map((f, idx) => idx === i ? { ...f, phone: formatPhone(e.target.value) } : f))}
                        placeholder="010-0000-0000 또는 02-000-0000" inputMode="tel" maxLength={14}
                        className={inputCls + " font-mono"} />
                    </div>
                    <div>
                      <label className={labelCls}>성별 {(m.relationship === "부" || m.relationship === "모" || m.relationship === "형제" || m.relationship === "자매") && <span className="text-[10px] text-gray-400">(자동)</span>}</label>
                      <select value={m.gender}
                        onChange={e => setFamily(p => p.map((f, idx) => idx === i ? { ...f, gender: e.target.value as "M" | "F" | "" } : f))}
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
                        onChange={e => setFamily(p => p.map((f, idx) => idx === i ? { ...f, birth_date: formatYmd(e.target.value) } : f))}
                        placeholder="YYYYMMDD" inputMode="numeric" maxLength={10} className={inputCls + " font-mono"} />
                    </div>
                    <div>
                      <label className={labelCls}>직업</label>
                      <input type="text" value={m.occupation} onChange={e => setFamily(p => p.map((f, idx) => idx === i ? { ...f, occupation: e.target.value } : f))} lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>동거여부</label>
                      <select value={m.cohabiting ? "Y" : "N"}
                        onChange={e => setFamily(p => p.map((f, idx) => idx === i ? { ...f, cohabiting: e.target.value === "Y" } : f))}
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
              <button type="button" onClick={() => setCareers(p => [...p, { ...EMPTY_CAREER }])}
                className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">+ 경력 추가</button>
            </div>
            {careers.length === 0 && <div className="text-center py-4 text-xs text-gray-400">등록된 경력 없음</div>}
            <div className="space-y-3">
              {careers.map((c, i) => (
                <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 bg-gray-50 dark:bg-gray-700/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-bold text-gray-500">경력 #{i + 1}</div>
                    <button type="button" onClick={() => setCareers(p => p.filter((_, idx) => idx !== i))} className="text-[11px] text-red-500">삭제</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    <div>
                      <label className={labelCls}>회사명 *</label>
                      <input type="text" value={c.company_name}
                        onChange={e => setCareers(p => p.map((x, idx) => idx === i ? { ...x, company_name: e.target.value } : x))}
                        lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>근무부서</label>
                      <input type="text" value={c.dept}
                        onChange={e => setCareers(p => p.map((x, idx) => idx === i ? { ...x, dept: e.target.value } : x))}
                        lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>직급</label>
                      <input type="text" value={c.rank}
                        onChange={e => setCareers(p => p.map((x, idx) => idx === i ? { ...x, rank: e.target.value } : x))}
                        lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>입사일</label>
                      <input type="text" value={c.joined_date}
                        onChange={e => setCareers(p => p.map((x, idx) => idx === i ? { ...x, joined_date: formatYmd(e.target.value) } : x))}
                        placeholder="YYYYMMDD" inputMode="numeric" maxLength={10}
                        className={inputCls + " font-mono"} />
                    </div>
                    <div>
                      <label className={labelCls}>퇴사일</label>
                      <input type="text" value={c.left_date}
                        onChange={e => setCareers(p => p.map((x, idx) => idx === i ? { ...x, left_date: formatYmd(e.target.value) } : x))}
                        placeholder="YYYYMMDD (재직 중이면 공백)" inputMode="numeric" maxLength={10}
                        className={inputCls + " font-mono"} />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className={labelCls}>담당업무</label>
                      <input type="text" value={c.duty}
                        onChange={e => setCareers(p => p.map((x, idx) => idx === i ? { ...x, duty: e.target.value } : x))}
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
              <button type="button" onClick={() => setVehicles(p => [...p, { ...EMPTY_VEHICLE }])}
                className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">+ 차량 추가</button>
            </div>
            {vehicles.length === 0 && <div className="text-center py-4 text-xs text-gray-400">등록된 차량 없음</div>}
            <div className="space-y-3">
              {vehicles.map((v, i) => {
                const isCompanyAssigned = v.vehicle_type === "회사차량" && v.id !== undefined;
                return (
                <div key={i} className={"rounded-lg border p-3 " + (isCompanyAssigned
                  ? "border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-900/10"
                  : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30")}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="text-[11px] font-bold text-gray-500">차량 #{i + 1}</div>
                      {isCompanyAssigned && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                          🔒 회사차량 (관리자 관리)
                        </span>
                      )}
                    </div>
                    {!isCompanyAssigned && (
                      <button type="button" onClick={() => setVehicles(p => p.filter((_, idx) => idx !== i))} className="text-[11px] text-red-500">삭제</button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    <div>
                      <label className={labelCls}>구분 *</label>
                      <select value={v.vehicle_type} onChange={e => {
                        const t = e.target.value as Vehicle["vehicle_type"];
                        setVehicles(p => p.map((x, idx) => idx === i ? { ...x, vehicle_type: t, plate_number: "", model: "", fuel_type: "", year_made: "" } : x));
                        if (t === "회사차량") loadCompanyVehicles();
                      }}
                        disabled={isCompanyAssigned}
                        className={inputCls + (isCompanyAssigned ? " bg-gray-100 dark:bg-gray-600 cursor-not-allowed" : "")}>
                        <option value="">선택</option><option value="자차">자차</option><option value="렌트">렌트</option>
                        {isCompanyAssigned && <option value="회사차량">회사차량</option>}
                        <option value="기타">기타</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>차량번호 *</label>
                      {v.vehicle_type === "회사차량" ? (
                        isCompanyAssigned ? (
                          <input type="text" value={v.plate_number} readOnly
                            className={inputCls + " font-mono bg-gray-100 dark:bg-gray-600 cursor-not-allowed"} />
                        ) : (
                        <select value={v.plate_number} onChange={e => {
                          const cv = companyVehicles.find(c => c.plate_number === e.target.value);
                          setVehicles(p => p.map((x, idx) => idx === i ? {
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
                        )
                      ) : (
                        <input type="text" value={v.plate_number} onChange={e => setVehicles(p => p.map((x, idx) => idx === i ? { ...x, plate_number: e.target.value } : x))} lang="ko" className={inputCls} />
                      )}
                    </div>
                    <div>
                      <label className={labelCls}>차종 *</label>
                      <input type="text" value={v.model}
                        onChange={e => setVehicles(p => p.map((x, idx) => idx === i ? { ...x, model: e.target.value } : x))}
                        readOnly={v.vehicle_type === "회사차량"}
                        lang="ko" className={inputCls + (v.vehicle_type === "회사차량" ? " bg-gray-100 dark:bg-gray-600 cursor-not-allowed" : "")} />
                    </div>
                    <div>
                      <label className={labelCls}>년식</label>
                      <input type="text" value={v.year_made}
                        onChange={e => setVehicles(p => p.map((x, idx) => idx === i ? { ...x, year_made: e.target.value.replace(/\D/g, "").slice(0, 4) } : x))}
                        readOnly={v.vehicle_type === "회사차량"}
                        inputMode="numeric" maxLength={4} className={inputCls + " font-mono" + (v.vehicle_type === "회사차량" ? " bg-gray-100 dark:bg-gray-600 cursor-not-allowed" : "")} />
                    </div>
                    <div>
                      <label className={labelCls}>유종 *</label>
                      <select value={v.fuel_type}
                        onChange={e => setVehicles(p => p.map((x, idx) => idx === i ? { ...x, fuel_type: e.target.value as Vehicle["fuel_type"] } : x))}
                        disabled={v.vehicle_type === "회사차량"}
                        className={inputCls + (v.vehicle_type === "회사차량" ? " bg-gray-100 dark:bg-gray-600 cursor-not-allowed" : "")}>
                        <option value="">선택</option><option value="가솔린">가솔린</option><option value="디젤">디젤</option><option value="가스">가스</option><option value="전기">전기</option><option value="기타">기타</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>차량등록일</label>
                      <input type="text" value={v.registration_date ?? ""}
                        onChange={e => setVehicles(p => p.map((x, idx) => idx === i ? { ...x, registration_date: formatYmd(e.target.value) } : x))}
                        readOnly={isCompanyAssigned}
                        placeholder="YYYYMMDD" inputMode="numeric" maxLength={10}
                        className={inputCls + " font-mono" + (isCompanyAssigned ? " bg-gray-100 dark:bg-gray-600 cursor-not-allowed" : "")} />
                    </div>
                    <div>
                      <label className={labelCls}>보험사 <span className="text-[10px] font-normal text-gray-400">(관리자 관리)</span></label>
                      <input type="text" value={v.insurance_company ?? ""} readOnly
                        placeholder="—"
                        className={inputCls + " bg-gray-100 dark:bg-gray-600 cursor-not-allowed"} />
                    </div>
                    <div>
                      <label className={labelCls}>보험가입일 <span className="text-[10px] font-normal text-gray-400">(관리자 관리)</span></label>
                      <input type="text" value={v.insurance_start_date ?? ""} readOnly
                        placeholder="—"
                        className={inputCls + " font-mono bg-gray-100 dark:bg-gray-600 cursor-not-allowed"} />
                    </div>
                    <div>
                      <label className={labelCls}>보험만기일 <span className="text-[10px] font-normal text-gray-400">(관리자 관리)</span></label>
                      <input type="text" value={v.insurance_end_date ?? ""} readOnly
                        placeholder="—"
                        className={inputCls + " font-mono bg-gray-100 dark:bg-gray-600 cursor-not-allowed"} />
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= 교육 및 자격 ================= */}
        {tab === "cert" && (
          <div className={sectionCls}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">교육 및 자격 ({certs.length}건)</h2>
              <button type="button" onClick={() => setCerts(p => [...p, { ...EMPTY_CERT }])}
                className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">+ 자격 추가</button>
            </div>
            {certs.length === 0 && <div className="text-center py-4 text-xs text-gray-400">등록된 자격 없음</div>}
            <div className="space-y-3">
              {certs.map((c, i) => (
                <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 bg-gray-50 dark:bg-gray-700/30">
                  <div className="flex items-center justify-between mb-2">
                    <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-bold">
                      <input type="checkbox" checked={c.self_check}
                        onChange={e => setCerts(p => p.map((x, idx) => idx === i ? { ...x, self_check: e.target.checked } : x))}
                        className="rounded" />
                      <span className={c.self_check ? "text-emerald-600 dark:text-emerald-300" : "text-gray-500 dark:text-gray-400"}>
                        ✅ 자체점검여부
                      </span>
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="text-[11px] text-gray-400">#{i + 1}</div>
                      <button type="button" onClick={() => setCerts(p => p.filter((_, idx) => idx !== i))} className="text-[11px] text-red-500">삭제</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-2">
                    <div>
                      <label className={labelCls}>자격명 *</label>
                      <input type="text" value={c.cert_name} onChange={e => setCerts(p => p.map((x, idx) => idx === i ? { ...x, cert_name: e.target.value } : x))} lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>자격번호</label>
                      <input type="text" value={c.cert_number} onChange={e => setCerts(p => p.map((x, idx) => idx === i ? { ...x, cert_number: e.target.value } : x))} className={inputCls + " font-mono"} />
                    </div>
                    <div>
                      <label className={labelCls}>발행기관</label>
                      <input type="text" value={c.issuer}
                        onChange={e => setCerts(p => p.map((x, idx) => idx === i ? { ...x, issuer: e.target.value } : x))}
                        placeholder="예: 한국산업인력공단" lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>취득일</label>
                      <input type="text" value={c.acquired_date}
                        onChange={e => setCerts(p => p.map((x, idx) => idx === i ? { ...x, acquired_date: formatYmd(e.target.value) } : x))}
                        placeholder="YYYYMMDD" inputMode="numeric" maxLength={10} className={inputCls + " font-mono"} />
                    </div>
                    <div>
                      <label className={labelCls}>만료일</label>
                      <input type="text" value={c.expiry_date}
                        onChange={e => setCerts(p => p.map((x, idx) => idx === i ? { ...x, expiry_date: formatYmd(e.target.value) } : x))}
                        placeholder="YYYYMMDD (없으면 공백)" inputMode="numeric" maxLength={10} className={inputCls + " font-mono"} />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>자격증 사본</label>
                    <div className="flex items-center gap-2">
                      <input id={`my-cert-doc-${i}`} type="file" accept="image/*,application/pdf"
                        onChange={e => {
                          const f = e.target.files?.[0] ?? null;
                          setCerts(p => p.map((x, idx) => idx === i ? { ...x, doc_file: f, doc_preview: f ? f.name : (x.cert_doc_url ? "기존 파일" : "") } : x));
                        }}
                        className="hidden" />
                      <label htmlFor={`my-cert-doc-${i}`} className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold cursor-pointer hover:bg-blue-700 whitespace-nowrap">📁 파일 선택</label>
                      {c.cert_doc_url && !c.doc_file && (
                        <a href={c.cert_doc_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">현재 파일 보기</a>
                      )}
                      <span className="text-xs text-gray-600 dark:text-gray-300 truncate flex-1">
                        {c.doc_file ? c.doc_file.name : (c.cert_doc_url ? "기존 파일 등록됨" : "선택된 파일 없음")}
                      </span>
                      {(c.doc_file || c.cert_doc_url) && (
                        <button type="button"
                          onClick={() => setCerts(p => p.map((x, idx) => idx === i ? { ...x, doc_file: null, cert_doc_url: null, doc_preview: "" } : x))}
                          className="text-xs text-red-500">지우기</button>
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
              <button type="button" onClick={() => setRps(p => [...p, { ...EMPTY_RP }])}
                className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">+ 상벌 추가</button>
            </div>
            {rps.length === 0 && <div className="text-center py-4 text-xs text-gray-400">등록된 상벌 없음</div>}
            <div className="space-y-3">
              {rps.map((r, i) => (
                <div key={i} className={`rounded-lg border p-3 ${
                  r.kind === "상" ? "border-amber-300 bg-amber-50 dark:bg-amber-900/20"
                  : r.kind === "벌" ? "border-red-300 bg-red-50 dark:bg-red-900/20"
                  : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30"
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-bold text-gray-500">#{i + 1}</div>
                    <button type="button" onClick={() => setRps(p => p.filter((_, idx) => idx !== i))} className="text-[11px] text-red-500">삭제</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr_140px] gap-2">
                    <div>
                      <label className={labelCls}>구분 *</label>
                      <select value={r.kind}
                        onChange={e => setRps(p => p.map((x, idx) => idx === i ? { ...x, kind: e.target.value as RP["kind"] } : x))}
                        className={inputCls}>
                        <option value="">선택</option>
                        <option value="상">🏆 상</option>
                        <option value="벌">⚠️ 벌</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>내용 *</label>
                      <input type="text" value={r.content}
                        onChange={e => setRps(p => p.map((x, idx) => idx === i ? { ...x, content: e.target.value } : x))}
                        placeholder="예: 우수사원 표창, 안전수칙 위반 경고"
                        lang="ko" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>일자</label>
                      <input type="text" value={r.occurred_on}
                        onChange={e => setRps(p => p.map((x, idx) => idx === i ? { ...x, occurred_on: formatYmd(e.target.value) } : x))}
                        placeholder="YYYYMMDD" inputMode="numeric" maxLength={10}
                        className={inputCls + " font-mono"} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= 발령/재직상태 이력 ================= */}
        {tab === "status_history" && (
          <div className={sectionCls}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">발령/재직상태 이력 ({statusHistory.length}건)</h2>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">퇴직, 재입사, 휴직, 복직 등 사원의 주요 고용 변동 이력을 관리합니다.</p>
              </div>
              {meIsAdmin && (
                <button type="button" onClick={() => setStatusHistory(p => [...p, { ...EMPTY_STATUS_HISTORY }])}
                  className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">+ 이력 추가</button>
              )}
            </div>
            {statusHistory.length === 0 && <div className="text-center py-4 text-xs text-gray-400">등록된 발령/재직 상태 변경 이력이 없습니다.</div>}
            <div className="space-y-3">
              {statusHistory.map((s, i) => (
                <div key={i} className={`rounded-lg border p-3 ${
                  s.status_type === "퇴직" ? "border-red-300 bg-red-50/30 dark:bg-red-900/10"
                  : s.status_type === "휴직" ? "border-amber-300 bg-amber-50/30 dark:bg-amber-900/10"
                  : s.status_type === "재입사" || s.status_type === "입사" || s.status_type === "복직" ? "border-green-300 bg-green-50/30 dark:bg-green-900/10"
                  : ["부서이동", "진급", "강등", "전보", "직책변경", "겸직"].includes(s.status_type) ? "border-purple-300 bg-purple-50/30 dark:bg-purple-900/10"
                  : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30"
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-bold text-gray-500">이력 #{i + 1}</div>
                    {meIsAdmin && (
                      <button type="button" onClick={() => setStatusHistory(p => p.filter((_, idx) => idx !== i))} className="text-[11px] text-red-500">삭제</button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[140px_160px_1fr] gap-2">
                    <div>
                      <label className={labelCls}>발령구분 *</label>
                      <select value={s.status_type}
                        onChange={e => setStatusHistory(p => p.map((x, idx) => idx === i ? { ...x, status_type: e.target.value as StatusHistory["status_type"] } : x))}
                        disabled={!meIsAdmin}
                        className={inputCls + (!meIsAdmin ? " bg-gray-100 dark:bg-gray-600 cursor-not-allowed" : "")}>
                        <option value="">선택</option>
                        <optgroup label="고용상태">
                          <option value="입사">입사</option>
                          <option value="퇴직">퇴직</option>
                          <option value="휴직">휴직</option>
                          <option value="복직">복직</option>
                          <option value="재입사">재입사</option>
                        </optgroup>
                        <optgroup label="발령">
                          <option value="부서이동">부서이동</option>
                          <option value="진급">진급</option>
                          <option value="강등">강등</option>
                          <option value="전보">전보</option>
                          <option value="직책변경">직책변경</option>
                          <option value="겸직">겸직</option>
                        </optgroup>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>발령일자 *</label>
                      <input type="text" value={s.event_date}
                        onChange={e => setStatusHistory(p => p.map((x, idx) => idx === i ? { ...x, event_date: formatYmd(e.target.value) } : x)) }
                        placeholder="YYYYMMDD" inputMode="numeric" maxLength={10}
                        readOnly={!meIsAdmin}
                        className={inputCls + " font-mono" + (!meIsAdmin ? " bg-gray-100 dark:bg-gray-600 cursor-not-allowed" : "")} />
                    </div>
                    <div>
                      <label className={labelCls}>내용 / 사유</label>
                      <input type="text" value={s.reason}
                        onChange={e => setStatusHistory(p => p.map((x, idx) => idx === i ? { ...x, reason: e.target.value } : x))}
                        placeholder="예: 일신상의 사유, 산전후 휴가, 부서 이동 복직 등"
                        lang="ko"
                        readOnly={!meIsAdmin}
                        className={inputCls + (!meIsAdmin ? " bg-gray-100 dark:bg-gray-600 cursor-not-allowed" : "")} />
                    </div>
                  </div>
                  {(s.to_dept || s.to_rank) && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
                      {s.to_dept && <span>부서: {s.from_dept || "-"} → <span className="font-semibold text-gray-700 dark:text-gray-200">{s.to_dept}</span></span>}
                      {s.to_rank && <span>직급: {s.from_rank || "-"} → <span className="font-semibold text-gray-700 dark:text-gray-200">{s.to_rank}</span></span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {message && (
          <div className={`px-4 py-3 rounded-lg text-sm ${
            message.type === "success"
              ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700"
              : "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700"
          }`}>{message.text}</div>
        )}

        <div className="flex gap-2 pt-2 sticky bottom-0 bg-gray-50 dark:bg-gray-900 py-3 -mx-4 lg:-mx-6 px-4 lg:px-6 border-t border-gray-200 dark:border-gray-700">
          <button type="submit" disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
