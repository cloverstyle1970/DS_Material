"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

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

interface UserRow {
  id: number;
  name: string;
  ssn: string | null;
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
  edu_completed_date: string;
  edu_next_date: string;
  cert_doc_url: string | null;
  doc_file: File | null;     // 새로 업로드할 파일
  doc_preview: string;       // 표시용 (filename or 기존 URL)
}

const EMPTY_FAMILY: FamilyMember = { relationship: "", name: "", gender: "", birth_date: "", occupation: "", cohabiting: true };
const EMPTY_VEHICLE: Vehicle = { vehicle_type: "", plate_number: "", model: "", year_made: "", fuel_type: "", registration_date: "" };
const EMPTY_CERT: Certification = { cert_name: "", cert_number: "", edu_completed_date: "", edu_next_date: "", cert_doc_url: null, doc_file: null, doc_preview: "" };

export default function MyProfileClient() {
  const { user } = useAuth();

  // 기본 정보
  const [loaded, setLoaded] = useState(false);
  const [row, setRow] = useState<UserRow | null>(null);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [emergency, setEmergency] = useState("");
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

  // 회사차량 목록 (회사차량 구분 선택 시 lazy load)
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

  // UX
  const [daumReady, setDaumReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 다음 우편번호 스크립트
  useEffect(() => {
    if (window.daum?.Postcode) { setDaumReady(true); return; }
    const existing = document.querySelector(`script[src="${DAUM_SCRIPT_SRC}"]`) as HTMLScriptElement | null;
    if (existing) { existing.addEventListener("load", () => setDaumReady(true)); return; }
    const s = document.createElement("script");
    s.src = DAUM_SCRIPT_SRC; s.async = true;
    s.onload = () => setDaumReady(true);
    document.body.appendChild(s);
  }, []);

  // 데이터 로드
  useEffect(() => {
    if (!user) return;
    (async () => {
      const [u, fam, veh, cert] = await Promise.all([
        supabase.from("users").select("*").eq("id", user.id).single(),
        supabase.from("user_family_members").select("*").eq("user_id", user.id).order("sort_order"),
        supabase.from("user_vehicles").select("*").eq("user_id", user.id).order("sort_order"),
        supabase.from("user_certifications").select("*").eq("user_id", user.id).order("sort_order"),
      ]);
      const r = u.data as UserRow | null;
      if (r) {
        setRow(r);
        setPhone(r.phone ?? "");
        setEmail(r.email ?? "");
        setEmergency(r.emergency_contact ?? "");
        setPostalCode(r.postal_code ?? "");
        // address: 기본 주소만 분리 시도가 어려우므로 기본주소에 통째 표시, 상세주소는 빈값
        setAddressBasic(r.address ?? "");
        setAddressDetail("");
        setTopSize(r.uniform_top_size ?? "");
        setBottomSize(r.uniform_bottom_size ?? "");
        setShoesSize(r.safety_shoes_size ?? "");
        setPhotoUrl(r.photo_url ?? null);
      }
      setFamily(((fam.data ?? []) as FamilyMember[]).map(f => ({ ...f, gender: (f.gender ?? "") as "M" | "F" | "" })));
      const vehData = (veh.data ?? []) as Vehicle[];
      setVehicles(vehData);
      // 회사차량이 등록되어 있으면 드롭다운 옵션을 미리 로드해 차량번호가 즉시 표시되도록 함
      if (vehData.some(v => v.vehicle_type === "회사차량")) {
        void loadCompanyVehicles();
      }
      setCerts(((cert.data ?? []) as Array<Omit<Certification, "doc_file" | "doc_preview">>).map(c => ({
        ...c,
        doc_file: null,
        doc_preview: c.cert_doc_url ? "기존 파일" : "",
      })));
      setLoaded(true);
    })();
  }, [user]);

  if (!user) {
    return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  }

  // ======= 헬퍼 =======
  function formatPhone(value: string): string {
    const d = value.replace(/\D/g, "").slice(0, 11);
    if (d.length < 4) return d;
    if (d.length < 8) return d.slice(0, 3) + "-" + d.slice(3);
    if (d.length === 10) return d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6);
    return d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
  }
  function formatYmd(value: string): string {
    const d = value.replace(/\D/g, "").slice(0, 8);
    if (d.length <= 4) return d;
    if (d.length <= 6) return d.slice(0, 4) + "-" + d.slice(4);
    return d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6);
  }
  function displaySsn(ssn: string | null | undefined): string {
    if (!ssn) return "";
    const d = ssn.replace(/\D/g, "");
    if (d.length <= 6) return d;
    return d.slice(0, 6) + "-" + d.slice(6, 13);
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
    const path = `${user!.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { cacheControl: "3600", upsert: false });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  // ======= 저장 =======
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user || !row) return;
    setMessage(null);

    // 차량/자격 필수필드 검증
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v.vehicle_type || !v.plate_number.trim() || !v.model.trim() || !v.fuel_type) {
        setMessage({ type: "error", text: `차량 #${i + 1}의 필수 항목(구분/차량번호/차종/유종)을 모두 입력하세요.` });
        return;
      }
    }
    for (let i = 0; i < certs.length; i++) {
      if (!certs[i].cert_name.trim()) {
        setMessage({ type: "error", text: `자격 #${i + 1}의 자격명을 입력하세요.` });
        return;
      }
    }

    setSaving(true);
    try {
      // 1. 새 사진 업로드 (선택 시)
      let newPhotoUrl: string | null = photoUrl;
      if (photoFile) {
        const ext = photoFile.name.split(".").pop()?.toLowerCase() || "jpg";
        newPhotoUrl = await uploadFile(PHOTO_BUCKET, photoFile, ext);
      }

      // 2. 주소 결합
      const fullAddress = [addressBasic, addressDetail].filter(Boolean).join(" ").trim();

      // 3. users UPDATE (제한 필드 hire_date/dept/rank/status는 제외)
      const { error: uErr } = await supabase.from("users").update({
        phone: phone || null,
        email: email || null,
        emergency_contact: emergency || null,
        postal_code: postalCode || null,
        address: fullAddress || null,
        photo_url: newPhotoUrl,
        uniform_top_size: topSize || null,
        uniform_bottom_size: bottomSize || null,
        safety_shoes_size: shoesSize || null,
      }).eq("id", user.id);
      if (uErr) throw uErr;

      // 4. 가족: 전체 삭제 + 재삽입
      await supabase.from("user_family_members").delete().eq("user_id", user.id);
      const validFam = family.filter(m => m.relationship.trim() && m.name.trim());
      if (validFam.length > 0) {
        const { error: fErr } = await supabase.from("user_family_members").insert(
          validFam.map((m, i) => ({
            user_id: user.id,
            relationship: m.relationship,
            name: m.name.trim(),
            gender: m.gender || null,
            birth_date: m.birth_date || null,
            occupation: m.occupation || null,
            cohabiting: m.cohabiting,
            sort_order: (i + 1) * 10,
          }))
        );
        if (fErr) throw fErr;
      }

      // 5. 차량: 회사차량 행은 관리자(회사차량관리)가 관리하므로 보존.
      //    개인이 입력하는 자차/렌트/기타 행만 삭제 후 재삽입.
      await supabase.from("user_vehicles").delete().eq("user_id", user.id).neq("vehicle_type", "회사차량");
      const editableVehicles = vehicles.filter(v => v.vehicle_type !== "회사차량");
      if (editableVehicles.length > 0) {
        const { error: vErr } = await supabase.from("user_vehicles").insert(
          editableVehicles.map((v, i) => ({
            user_id: user.id,
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

      // 6. 자격: 전체 삭제 + 재삽입 (새 파일은 업로드, 기존 파일 URL은 유지)
      await supabase.from("user_certifications").delete().eq("user_id", user.id);
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
            user_id: user.id,
            cert_name: c.cert_name.trim(),
            cert_number: c.cert_number || null,
            edu_completed_date: c.edu_completed_date || null,
            edu_next_date: c.edu_next_date || null,
            cert_doc_url: docUrl,
            sort_order: (i + 1) * 10,
          });
        }
        const { error: cErr } = await supabase.from("user_certifications").insert(certRows);
        if (cErr) throw cErr;
      }

      // 성공: state 동기화
      if (newPhotoUrl !== photoUrl) {
        setPhotoUrl(newPhotoUrl);
        setPhotoFile(null);
        setPhotoPreview("");
      }
      setMessage({ type: "success", text: "개인정보가 저장되었습니다." });
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
  const lockedCls = inputCls + " bg-gray-100 dark:bg-gray-900/40 text-gray-500 cursor-not-allowed";
  const labelCls = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1";
  const sectionCls = "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5";

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">개인정보수정</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          본인의 정보만 수정할 수 있습니다 · 입사일·부서·직급·재직상태는 관리자만 변경 가능
        </p>
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

        {/* 사진 + 기본 정보 (사진은 좌, 정보는 우) */}
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

          {/* 우측 영역: 기본정보 + (연락처 좌·주소 우) */}
          <div className="flex flex-col gap-4">
            <div className={sectionCls}>
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">기본 정보</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>성명</label>
                  <input type="text" value={row.name} readOnly className={lockedCls} />
                </div>
                <div>
                  <label className={labelCls}>주민등록번호</label>
                  <input type="text" value={displaySsn(row.ssn)} readOnly className={lockedCls + " font-mono"} />
                </div>
                <div>
                  <label className={labelCls}>입사일 🔒</label>
                  <input type="text" value={row.hire_date ?? ""} readOnly className={lockedCls} />
                </div>
                <div>
                  <label className={labelCls}>부서 🔒</label>
                  <input type="text" value={row.dept ?? ""} readOnly className={lockedCls} />
                </div>
                <div>
                  <label className={labelCls}>직급 🔒</label>
                  <input type="text" value={row.rank ?? ""} readOnly className={lockedCls} />
                </div>
                <div>
                  <label className={labelCls}>재직상태 🔒</label>
                  <input type="text" value={row.status ?? ""} readOnly className={lockedCls} />
                </div>
              </div>
            </div>

            {/* 연락처(좌) + 주소(우) — 우측 영역 안에서 2열 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={sectionCls}>
                <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">연락처</h2>
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>휴대폰</label>
                    <input type="tel" value={phone}
                      onChange={e => setPhone(formatPhone(e.target.value))}
                      placeholder="010-0000-0000" inputMode="numeric" maxLength={13}
                      className={inputCls + " font-mono"} />
                  </div>
                  <div>
                    <label className={labelCls}>긴급연락처</label>
                    <input type="text" value={emergency}
                      onChange={e => setEmergency(e.target.value)}
                      placeholder="예: 배우자 010-1234-5678 / 부친 02-123-4567"
                      lang="ko" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>이메일</label>
                    <input type="email" value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="user@example.com" className={inputCls} />
                  </div>
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

        {/* 근무복 */}
        <div className={sectionCls}>
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">근무복 사이즈</h2>
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

        {/* 가족 정보 */}
        <div className={sectionCls}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">가족 정보 ({family.length}명)</h2>
            <button type="button" onClick={() => setFamily(p => [...p, { ...EMPTY_FAMILY }])}
              className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">+ 가족 추가</button>
          </div>
          {family.length === 0 && <div className="text-center py-4 text-xs text-gray-400">등록된 가족 없음</div>}
          <div className="space-y-3">
            {family.map((m, i) => (
              <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 bg-gray-50 dark:bg-gray-700/30">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-bold text-gray-500">가족 #{i + 1}</div>
                  <button type="button" onClick={() => setFamily(p => p.filter((_, idx) => idx !== i))} className="text-[11px] text-red-500">삭제</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
                  <div>
                    <label className={labelCls}>관계</label>
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
                    <label className={labelCls}>성명</label>
                    <input type="text" value={m.name} onChange={e => setFamily(p => p.map((f, idx) => idx === i ? { ...f, name: e.target.value } : f))} lang="ko" className={inputCls} />
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

        {/* 차량 정보 */}
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
                      {/* '회사차량' 구분은 회사차량관리(관리자)에서만 신규 등록 가능. 기존 행 표시용으로만 유지. */}
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
                    <input type="text" value={v.registration_date}
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

        {/* 자격 정보 */}
        <div className={sectionCls}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">자격 정보 ({certs.length}건)</h2>
            <button type="button" onClick={() => setCerts(p => [...p, { ...EMPTY_CERT }])}
              className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">+ 자격 추가</button>
          </div>
          {certs.length === 0 && <div className="text-center py-4 text-xs text-gray-400">등록된 자격 없음</div>}
          <div className="space-y-3">
            {certs.map((c, i) => (
              <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 bg-gray-50 dark:bg-gray-700/30">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-bold text-gray-500">자격 #{i + 1}</div>
                  <button type="button" onClick={() => setCerts(p => p.filter((_, idx) => idx !== i))} className="text-[11px] text-red-500">삭제</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
                  <div>
                    <label className={labelCls}>자격명 *</label>
                    <input type="text" value={c.cert_name} onChange={e => setCerts(p => p.map((x, idx) => idx === i ? { ...x, cert_name: e.target.value } : x))} lang="ko" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>자격번호</label>
                    <input type="text" value={c.cert_number} onChange={e => setCerts(p => p.map((x, idx) => idx === i ? { ...x, cert_number: e.target.value } : x))} className={inputCls + " font-mono"} />
                  </div>
                  <div>
                    <label className={labelCls}>교육이수일</label>
                    <input type="text" value={c.edu_completed_date}
                      onChange={e => setCerts(p => p.map((x, idx) => idx === i ? { ...x, edu_completed_date: formatYmd(e.target.value) } : x))}
                      placeholder="YYYYMMDD" inputMode="numeric" maxLength={10} className={inputCls + " font-mono"} />
                  </div>
                  <div>
                    <label className={labelCls}>차기 교육이수일</label>
                    <input type="text" value={c.edu_next_date}
                      onChange={e => setCerts(p => p.map((x, idx) => idx === i ? { ...x, edu_next_date: formatYmd(e.target.value) } : x))}
                      placeholder="YYYYMMDD" inputMode="numeric" maxLength={10} className={inputCls + " font-mono"} />
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
