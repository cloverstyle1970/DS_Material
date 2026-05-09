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
  emergency_contact: string;
  postal_code: string;
  address_basic: string;
  address_detail: string;
  uniform_top_size: string;
  uniform_bottom_size: string;
  safety_shoes_size: string;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyForm(): Form {
  return {
    name: "", ssn: "", hireDate: todayStr(), dept: "", rank: "", status: "재직",
    phone: "", emergency_contact: "",
    postal_code: "", address_basic: "", address_detail: "",
    uniform_top_size: "", uniform_bottom_size: "", safety_shoes_size: "",
  };
}

export default function EmployeeRegisterClient() {
  const { user } = useAuth();
  const [form, setForm] = useState<Form>(emptyForm());
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [daumReady, setDaumReady] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

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
    if (!form.hireDate) { setMessage({ type: "error", text: "입사일을 입력하세요." }); return; }

    // 동일 이름 + 주민번호 중복 체크 (간단)
    if (form.ssn) {
      const { data: dup } = await supabase.from("users").select("id").eq("ssn", form.ssn).maybeSingle();
      if (dup) { setMessage({ type: "error", text: "이미 등록된 주민등록번호입니다." }); return; }
    }

    setSaving(true);
    try {
      // 1. 사진 업로드
      const photoUrl = await uploadPhoto();

      // 2. 다음 사원 ID = max+1
      const { data: maxRow } = await supabase.from("users").select("id").order("id", { ascending: false }).limit(1).maybeSingle();
      const nextId = ((maxRow?.id as number | undefined) ?? 0) + 1;

      // 3. 주소 결합
      const fullAddress = [form.address_basic, form.address_detail].filter(Boolean).join(" ").trim();

      // 4. 초기 비밀번호 = "1234"
      const initialPwHash = await hashPassword("1234");

      const { error: insErr } = await supabase.from("users").insert({
        id: nextId,
        name: form.name.trim(),
        ssn: form.ssn || null,
        hire_date: form.hireDate,
        dept: form.dept || null,
        rank: form.rank || null,
        status: form.status,
        phone: form.phone || null,
        emergency_contact: form.emergency_contact || null,
        postal_code: form.postal_code || null,
        address: fullAddress || null,
        photo_url: photoUrl,
        uniform_top_size: form.uniform_top_size || null,
        uniform_bottom_size: form.uniform_bottom_size || null,
        safety_shoes_size: form.safety_shoes_size || null,
        permissions: [],
        password_hash: initialPwHash,
      });
      if (insErr) throw insErr;

      setMessage({ type: "success", text: `사원 등록 완료 (ID: ${nextId}, 초기 비밀번호: 1234)` });
      setForm(emptyForm());
      clearPhoto();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
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

      <form onSubmit={handleSubmit} className="p-4 lg:p-6 max-w-6xl mx-auto space-y-4">
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
                  <label className={labelCls}>주민등록번호</label>
                  <input type="text" value={form.ssn}
                    onChange={e => set("ssn", formatSsn(e.target.value))}
                    placeholder="000000-0000000" inputMode="numeric" maxLength={14}
                    className={inputCls + " font-mono"} />
                </div>
                <div>
                  <label className={labelCls}>입사일 <span className="text-red-500">*</span></label>
                  <input type="date" value={form.hireDate} onChange={e => set("hireDate", e.target.value)} required className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>부서</label>
                  <input type="text" value={form.dept} onChange={e => set("dept", e.target.value)} placeholder="예: 본사, 보수1팀" lang="ko" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>직급</label>
                  <input type="text" value={form.rank} onChange={e => set("rank", e.target.value)} placeholder="예: 대리, 과장" lang="ko" className={inputCls} />
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
                    <label className={labelCls}>휴대폰</label>
                    <input type="tel" value={form.phone}
                      onChange={e => set("phone", formatPhone(e.target.value))}
                      placeholder="010-0000-0000" inputMode="numeric" maxLength={13}
                      className={inputCls + " font-mono"} />
                  </div>
                  <div>
                    <label className={labelCls}>긴급연락처</label>
                    <input type="text" value={form.emergency_contact}
                      onChange={e => set("emergency_contact", e.target.value)}
                      placeholder="예: 배우자 010-0000-0000" lang="ko" className={inputCls} />
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
          <button type="button" onClick={() => { setForm(emptyForm()); clearPhoto(); setMessage(null); }}
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
