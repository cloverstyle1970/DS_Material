"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { hashPassword } from "@/lib/password";

const STORAGE_BUCKET = "employee-photos";
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

interface Form {
  name: string;
  ssn: string;
  hireDate: string;
  dept: string;
  rank: string;
  status: string;
  phone: string;
  email: string;
  emergency_contact: string;
  postal_code: string;
  address_basic: string;
  address_detail: string;
  uniform_top_size: string;
  uniform_bottom_size: string;
  safety_shoes_size: string;
}

interface FamilyMember {
  relationship: string;
  name: string;
  gender: "M" | "F" | "";
  birth_date: string;
  occupation: string;
  cohabiting: boolean;
}

const EMPTY_FAMILY: FamilyMember = {
  relationship: "", name: "", gender: "", birth_date: "", occupation: "", cohabiting: true,
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
  edu_completed_date: string;
  edu_next_date: string;
  doc_file: File | null;
  doc_preview: string;
}

const EMPTY_CERT: Certification = {
  cert_name: "", cert_number: "", edu_completed_date: "", edu_next_date: "",
  doc_file: null, doc_preview: "",
};

const CERT_DOCS_BUCKET = "cert-docs";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyForm(): Form {
  return {
    name: "", ssn: "", hireDate: todayStr(), dept: "", rank: "", status: "재직",
    phone: "", email: "", emergency_contact: "",
    postal_code: "", address_basic: "", address_detail: "",
    uniform_top_size: "", uniform_bottom_size: "", safety_shoes_size: "",
  };
}

export default function EmployeeRegisterClient() {
  const { user } = useAuth();
  const [form, setForm] = useState<Form>(emptyForm());
  const [family, setFamily] = useState<FamilyMember[]>([{ ...EMPTY_FAMILY }]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [certs, setCerts] = useState<Certification[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [daumReady, setDaumReady] = useState(false);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [ranks, setRanks] = useState<{ id: number; name: string }[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // 부서/직급 마스터 로드
  useEffect(() => {
    (async () => {
      const [d, r] = await Promise.all([
        supabase.from("departments").select("id, name").eq("is_active", true).order("sort_order"),
        supabase.from("ranks").select("id, name").eq("is_active", true).order("sort_order"),
      ]);
      if (d.data) setDepartments(d.data as { id: number; name: string }[]);
      if (r.data) setRanks(r.data as { id: number; name: string }[]);
    })();
  }, []);

  // 다음 우편번호 스크립트 로드
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
  if (!isAdmin(user)) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">관리자 권한이 필요합니다</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">사원등록 페이지는 관리자만 접근할 수 있습니다.</div>
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

  // 주민번호 자동 포맷: 6+7 숫자 입력 시 XXXXXX-XXXXXXX
  function formatSsn(value: string): string {
    const d = value.replace(/\D/g, "").slice(0, 13);
    if (d.length <= 6) return d;
    return d.slice(0, 6) + "-" + d.slice(6);
  }

  // 휴대폰 자동 포맷
  function formatPhone(value: string): string {
    const d = value.replace(/\D/g, "").slice(0, 11);
    if (d.length < 4) return d;
    if (d.length < 8) return d.slice(0, 3) + "-" + d.slice(3);
    if (d.length === 10) return d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6);
    return d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (!form.name.trim()) { setMessage({ type: "error", text: "성명을 입력하세요." }); return; }
    if (!form.ssn.trim()) { setMessage({ type: "error", text: "주민등록번호를 입력하세요." }); return; }
    if (!form.hireDate) { setMessage({ type: "error", text: "입사일을 입력하세요." }); return; }
    if (!form.phone.trim()) { setMessage({ type: "error", text: "휴대폰 번호를 입력하세요." }); return; }

    // 차량 필수필드 검증 (등록한 차량은 모든 필수필드 채워야 함)
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v.vehicle_type || !v.plate_number.trim() || !v.model.trim() || !v.fuel_type) {
        setMessage({ type: "error", text: `차량 #${i + 1}의 필수 항목(구분/차량번호/차종/유종)을 모두 입력하세요.` });
        return;
      }
    }

    // 자격 필수필드 검증 (자격명만 필수)
    for (let i = 0; i < certs.length; i++) {
      if (!certs[i].cert_name.trim()) {
        setMessage({ type: "error", text: `자격 #${i + 1}의 자격명을 입력하세요.` });
        return;
      }
    }

    // 동일 이름 + 주민번호 중복 체크 (간단)
    if (form.ssn) {
      const { data: dup } = await supabase.from("users").select("id").eq("ssn", form.ssn).maybeSingle();
      if (dup) { setMessage({ type: "error", text: "이미 등록된 주민등록번호입니다." }); return; }
    }

    setSaving(true);
    try {
      // 1. 사진 업로드
      const photoUrl = await uploadPhoto();

      // 2. 주소 결합
      const fullAddress = [form.address_basic, form.address_detail].filter(Boolean).join(" ").trim();

      // 3. 초기 비밀번호 = "1234"
      const initialPwHash = await hashPassword("1234");

      // 4. INSERT (id는 SERIAL 시퀀스로 자동 채번)
      const payload = {
        name: form.name.trim(),
        ssn: form.ssn || null,
        hire_date: form.hireDate,
        dept: form.dept || null,
        rank: form.rank || null,
        status: form.status,
        phone: form.phone || null,
        email: form.email || null,
        emergency_contact: form.emergency_contact || null,
        postal_code: form.postal_code || null,
        address: fullAddress || null,
        photo_url: photoUrl,
        uniform_top_size: form.uniform_top_size || null,
        uniform_bottom_size: form.uniform_bottom_size || null,
        safety_shoes_size: form.safety_shoes_size || null,
        permissions: [],
        password_hash: initialPwHash,
      };
      const { data: inserted, error: insErr } = await supabase.from("users")
        .insert(payload).select("id").single();
      if (insErr) {
        console.error("[employee-register] insert error:", insErr, "payload:", payload);
        throw insErr;
      }

      const newUserId = inserted?.id as number;

      // 5. 가족 정보 insert (이름·관계 모두 입력된 행만)
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
            sort_order: (idx + 1) * 10,
          }))
        );
        if (famErr) {
          console.error("[employee-register] family insert error:", famErr);
          // 가족 저장 실패는 경고만 (사원 본인은 등록됨)
          setMessage({ type: "error", text: `사원은 등록됐으나 가족 정보 저장 실패: ${famErr.message}` });
          return;
        }
      }

      // 6. 차량 정보 insert
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
        if (vehErr) {
          console.error("[employee-register] vehicle insert error:", vehErr);
          setMessage({ type: "error", text: `사원·가족은 등록됐으나 차량 저장 실패: ${vehErr.message}` });
          return;
        }
      }

      // 7. 자격 정보 — 파일 업로드 후 insert
      if (certs.length > 0) {
        const certRows: Array<Record<string, unknown>> = [];
        for (let i = 0; i < certs.length; i++) {
          const c = certs[i];
          let docUrl: string | null = null;
          if (c.doc_file) {
            const ext = c.doc_file.name.split(".").pop()?.toLowerCase() || "bin";
            const path = `${newUserId}/${Date.now()}_${i}.${ext}`;
            const { error: upErr } = await supabase.storage.from(CERT_DOCS_BUCKET).upload(path, c.doc_file, { cacheControl: "3600", upsert: false });
            if (upErr) {
              console.error("[employee-register] cert doc upload error:", upErr);
              setMessage({ type: "error", text: `자격 #${i + 1} 사본 업로드 실패: ${upErr.message}` });
              return;
            }
            const { data } = supabase.storage.from(CERT_DOCS_BUCKET).getPublicUrl(path);
            docUrl = data.publicUrl;
          }
          certRows.push({
            user_id: newUserId,
            cert_name: c.cert_name.trim(),
            cert_number: c.cert_number || null,
            edu_completed_date: c.edu_completed_date || null,
            edu_next_date: c.edu_next_date || null,
            cert_doc_url: docUrl,
            sort_order: (i + 1) * 10,
          });
        }
        const { error: certErr } = await supabase.from("user_certifications").insert(certRows);
        if (certErr) {
          console.error("[employee-register] cert insert error:", certErr);
          setMessage({ type: "error", text: `사원·가족·차량은 등록됐으나 자격 저장 실패: ${certErr.message}` });
          return;
        }
      }

      setMessage({ type: "success", text: `사원 등록 완료 (ID: ${newUserId}, 가족 ${validFamily.length}명, 차량 ${vehicles.length}대, 자격 ${certs.length}건, 초기 비밀번호: 1234)` });
      setForm(emptyForm());
      setFamily([{ ...EMPTY_FAMILY }]);
      setVehicles([]);
      setCerts([]);
      clearPhoto();
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
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">신규 사원의 기본정보·주소·근무복 사이즈를 등록합니다 (관리자 전용)</p>
      </div>

      <form onSubmit={handleSubmit}
        onKeyDown={e => {
          // Enter로 다음 입력란 자동 이동 (textarea/select 제외, 한글 IME 조합 중 무시)
          if (e.key !== "Enter") return;
          if ((e.nativeEvent as KeyboardEvent).isComposing) return;
          const target = e.target as HTMLElement;
          if (target.tagName === "TEXTAREA") return;
          if (target.tagName === "BUTTON") return;
          // type=submit인 경우 폼 제출 허용
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
            // input 텍스트 전체 선택 (편의)
            const next = focusables[idx + 1] as HTMLInputElement;
            if (next.tagName === "INPUT" && (next.type === "text" || next.type === "tel")) {
              next.select?.();
            }
          }
        }}
        className="p-4 lg:p-6 max-w-6xl mx-auto space-y-4">
        {/* PC: 좌측 사진 + 우측 기본정보 / 모바일: 세로 스택 */}
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          {/* 사진 — 우측 기본정보 높이에 맞춰 flex로 자동 신축 */}
          <div className={sectionCls + " flex flex-col"}>
            <label className={labelCls}>📷 프로필 사진</label>
            <div className="flex-1 w-full min-h-[180px] rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 overflow-hidden flex items-center justify-center mb-3">
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

          {/* 우측 영역: 기본 정보 + 그 아래 (연락처 좌·주소 우) */}
          <div className="flex flex-col gap-4">
            {/* 기본 정보 */}
            <div className={sectionCls}>
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">기본 정보</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>성명 <span className="text-red-500">*</span></label>
                  <input type="text" value={form.name} onChange={e => set("name", e.target.value)} required lang="ko" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>주민등록번호 <span className="text-red-500">*</span></label>
                  <input type="text" value={form.ssn}
                    onChange={e => set("ssn", formatSsn(e.target.value))}
                    placeholder="000000-0000000" inputMode="numeric" maxLength={14}
                    required
                    className={inputCls + " font-mono"} />
                </div>
                <div>
                  <label className={labelCls}>입사일 <span className="text-red-500">*</span></label>
                  <input type="date" value={form.hireDate} onChange={e => set("hireDate", e.target.value)} required className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>부서</label>
                  <select value={form.dept} onChange={e => set("dept", e.target.value)} className={inputCls}>
                    <option value="">선택하세요</option>
                    {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
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
              </div>
            </div>

            {/* 연락처(좌) + 주소(우) — 우측 영역 안에서 2열 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* 연락처 */}
              <div className={sectionCls}>
                <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">연락처</h2>
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>휴대폰 <span className="text-red-500">*</span></label>
                    <input type="tel" value={form.phone}
                      onChange={e => set("phone", formatPhone(e.target.value))}
                      placeholder="010-0000-0000" inputMode="numeric" maxLength={13}
                      required
                      className={inputCls + " font-mono"} />
                  </div>
                  <div>
                    <label className={labelCls}>긴급연락처</label>
                    <input type="text" value={form.emergency_contact}
                      onChange={e => set("emergency_contact", e.target.value)}
                      placeholder="예: 배우자 010-1234-5678 / 부친 02-123-4567"
                      lang="ko" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>이메일</label>
                    <input type="email" value={form.email}
                      onChange={e => set("email", e.target.value)}
                      placeholder="user@example.com"
                      className={inputCls} />
                  </div>
                </div>
              </div>

              {/* 주소 */}
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

        {/* 근무복 사이즈 */}
        <div className={sectionCls}>
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">근무복 사이즈</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>상의</label>
              <input type="text" value={form.uniform_top_size} onChange={e => set("uniform_top_size", e.target.value)}
                placeholder="예: 95, 100, L" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>하의</label>
              <input type="text" value={form.uniform_bottom_size} onChange={e => set("uniform_bottom_size", e.target.value)}
                placeholder="예: 30, 32" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>안전화</label>
              <input type="text" value={form.safety_shoes_size} onChange={e => set("safety_shoes_size", e.target.value)}
                placeholder="예: 250, 270" className={inputCls} />
            </div>
          </div>
        </div>

        {/* 가족 정보 */}
        <div className={sectionCls}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">가족 정보 ({family.length}명)</h2>
            <button type="button"
              onClick={() => setFamily(prev => [...prev, { ...EMPTY_FAMILY }])}
              className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">
              + 가족 추가
            </button>
          </div>
          <div className="space-y-3">
            {family.map((m, i) => (
              <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 bg-gray-50 dark:bg-gray-700/30">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400">가족 #{i + 1}</div>
                  {family.length > 1 && (
                    <button type="button"
                      onClick={() => setFamily(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-[11px] text-red-500 hover:text-red-700">
                      삭제
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
                  <div>
                    <label className={labelCls}>관계</label>
                    <select
                      value={m.relationship}
                      onChange={e => {
                        const rel = e.target.value;
                        // 성별 자동 추정 (부·형제→남, 모·자매→여, 그 외는 유지)
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
                    <label className={labelCls}>성명</label>
                    <input type="text" value={m.name}
                      onChange={e => setFamily(prev => prev.map((f, idx) => idx === i ? { ...f, name: e.target.value } : f))}
                      lang="ko" className={inputCls} />
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
                      onChange={e => {
                        // YYYYMMDD 자동 포맷: 19711212 → 1971-12-12
                        const d = e.target.value.replace(/\D/g, "").slice(0, 8);
                        const v = d.length <= 4
                          ? d
                          : d.length <= 6
                            ? d.slice(0, 4) + "-" + d.slice(4)
                            : d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6);
                        setFamily(prev => prev.map((f, idx) => idx === i ? { ...f, birth_date: v } : f));
                      }}
                      placeholder="YYYYMMDD"
                      inputMode="numeric"
                      maxLength={10}
                      pattern="^\d{4}-\d{2}-\d{2}$"
                      title="YYYY-MM-DD 형식 (8자리 입력 시 자동 포맷)"
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

        {/* 차량 정보 */}
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
                      onChange={e => setVehicles(prev => prev.map((x, idx) => idx === i ? { ...x, vehicle_type: e.target.value as Vehicle["vehicle_type"] } : x))}
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
                    <input type="text" value={v.plate_number}
                      onChange={e => setVehicles(prev => prev.map((x, idx) => idx === i ? { ...x, plate_number: e.target.value } : x))}
                      placeholder="예: 12가 3456" lang="ko" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>차종 <span className="text-red-500">*</span></label>
                    <input type="text" value={v.model}
                      onChange={e => setVehicles(prev => prev.map((x, idx) => idx === i ? { ...x, model: e.target.value } : x))}
                      placeholder="예: 쏘나타, 포터" lang="ko" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>년식</label>
                    <input type="text" value={v.year_made}
                      onChange={e => setVehicles(prev => prev.map((x, idx) => idx === i ? { ...x, year_made: e.target.value.replace(/\D/g, "").slice(0, 4) } : x))}
                      placeholder="예: 2023" inputMode="numeric" maxLength={4} className={inputCls + " font-mono"} />
                  </div>
                  <div>
                    <label className={labelCls}>유종 <span className="text-red-500">*</span></label>
                    <select value={v.fuel_type}
                      onChange={e => setVehicles(prev => prev.map((x, idx) => idx === i ? { ...x, fuel_type: e.target.value as Vehicle["fuel_type"] } : x))}
                      className={inputCls}>
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
                      onChange={e => {
                        const d = e.target.value.replace(/\D/g, "").slice(0, 8);
                        const fmt = d.length <= 4 ? d
                          : d.length <= 6 ? d.slice(0,4) + "-" + d.slice(4)
                          : d.slice(0,4) + "-" + d.slice(4,6) + "-" + d.slice(6);
                        setVehicles(prev => prev.map((x, idx) => idx === i ? { ...x, registration_date: fmt } : x));
                      }}
                      placeholder="YYYYMMDD" inputMode="numeric" maxLength={10}
                      className={inputCls + " font-mono"} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 자격 정보 */}
        <div className={sectionCls}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">자격 정보 ({certs.length}건)</h2>
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
                  <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400">자격 #{i + 1}</div>
                  <button type="button"
                    onClick={() => setCerts(prev => prev.filter((_, idx) => idx !== i))}
                    className="text-[11px] text-red-500 hover:text-red-700">
                    삭제
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
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
                    <label className={labelCls}>교육이수일</label>
                    <input type="text" value={c.edu_completed_date}
                      onChange={e => {
                        const d = e.target.value.replace(/\D/g, "").slice(0, 8);
                        const fmt = d.length <= 4 ? d
                          : d.length <= 6 ? d.slice(0,4) + "-" + d.slice(4)
                          : d.slice(0,4) + "-" + d.slice(4,6) + "-" + d.slice(6);
                        setCerts(prev => prev.map((x, idx) => idx === i ? { ...x, edu_completed_date: fmt } : x));
                      }}
                      placeholder="YYYYMMDD" inputMode="numeric" maxLength={10}
                      className={inputCls + " font-mono"} />
                  </div>
                  <div>
                    <label className={labelCls}>차기 교육이수일</label>
                    <input type="text" value={c.edu_next_date}
                      onChange={e => {
                        const d = e.target.value.replace(/\D/g, "").slice(0, 8);
                        const fmt = d.length <= 4 ? d
                          : d.length <= 6 ? d.slice(0,4) + "-" + d.slice(4)
                          : d.slice(0,4) + "-" + d.slice(4,6) + "-" + d.slice(6);
                        setCerts(prev => prev.map((x, idx) => idx === i ? { ...x, edu_next_date: fmt } : x));
                      }}
                      placeholder="YYYYMMDD" inputMode="numeric" maxLength={10}
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
          <button type="button" onClick={() => { setForm(emptyForm()); setFamily([{ ...EMPTY_FAMILY }]); setVehicles([]); setCerts([]); clearPhoto(); setMessage(null); }}
            className="px-6 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold">
            초기화
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
            {saving ? "등록 중..." : "사원 등록"}
          </button>
        </div>

        <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center">
          ※ 등록 시 초기 비밀번호는 <span className="font-mono font-bold">1234</span> 로 설정됩니다. 사원이 첫 로그인 후 환경설정에서 변경할 수 있습니다.
        </p>
      </form>
    </div>
  );
}
