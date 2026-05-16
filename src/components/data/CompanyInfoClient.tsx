"use client";

import { useEffect, useState } from "react";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { formatPhone } from "@/lib/input-format";

const MENU_HREF = "/data/company-info";

interface CompanyInfo {
  company_name: string;
  company_biz_no: string;
  company_address: string;
  company_phone: string;
  company_email: string;
  company_ceo: string;
}

const EMPTY: CompanyInfo = {
  company_name: "",
  company_biz_no: "",
  company_address: "",
  company_phone: "",
  company_email: "",
  company_ceo: "",
};

export default function CompanyInfoClient() {
  const { user } = useAuth();
  const [info, setInfo] = useState<CompanyInfo>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("quote_settings")
        .select("company_name, company_biz_no, company_address, company_phone, company_email, company_ceo")
        .eq("id", 1).single();
      if (data) {
        setInfo({
          company_name:    data.company_name    ?? "",
          company_biz_no:  data.company_biz_no  ?? "",
          company_address: data.company_address ?? "",
          company_phone:   data.company_phone   ?? "",
          company_email:   data.company_email   ?? "",
          company_ceo:     data.company_ceo     ?? "",
        });
      } else if (error) {
        setMessage({ type: "error", text: `로드 실패: ${error.message}` });
      }
      setLoaded(true);
    })();
  }, []);

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  const admin = isAdmin(user);
  const canRead   = admin || hasMenuPermission(user, MENU_HREF, "read");
  const canUpdate = admin || hasMenuPermission(user, MENU_HREF, "update");
  if (!canRead) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
      </div>
    );
  }

  function patch(p: Partial<CompanyInfo>) {
    setInfo(prev => ({ ...prev, ...p }));
  }

  async function save() {
    setMessage(null);
    if (!canUpdate) { setMessage({ type: "error", text: "수정 권한이 없습니다." }); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("quote_settings").update({
        company_name:    info.company_name    || null,
        company_biz_no:  info.company_biz_no  || null,
        company_address: info.company_address || null,
        company_phone:   info.company_phone   || null,
        company_email:   info.company_email   || null,
        company_ceo:     info.company_ceo     || null,
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
      if (error) throw error;
      setMessage({ type: "success", text: "회사 정보가 저장되었습니다." });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  const sectionCls = "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5";
  const labelCls   = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1";
  const inputCls   = "w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100";

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">회사 정보 관리</h1>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">견적서·계약서 등에 표시되는 회사 정보 (마스터 데이터)</p>
      </div>

      <div className="p-6 space-y-4 max-w-3xl">
        {!loaded ? (
          <div className="text-center py-12 text-sm text-gray-500">로딩 중...</div>
        ) : (
          <>
            <div className={sectionCls}>
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">🏢 회사 정보</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>회사명</label>
                  <input type="text" lang="ko" value={info.company_name}
                    onChange={e => patch({ company_name: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>사업자등록번호</label>
                  <input type="text" value={info.company_biz_no}
                    onChange={e => patch({ company_biz_no: e.target.value })}
                    placeholder="000-00-00000" className={inputCls + " font-mono"} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>주소</label>
                  <input type="text" lang="ko" value={info.company_address}
                    onChange={e => patch({ company_address: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>전화번호</label>
                  <input type="tel" value={info.company_phone}
                    onChange={e => patch({ company_phone: formatPhone(e.target.value) })}
                    placeholder="02-000-0000 또는 010-0000-0000" inputMode="tel" maxLength={14}
                    className={inputCls + " font-mono"} />
                </div>
                <div>
                  <label className={labelCls}>이메일</label>
                  <input type="email" value={info.company_email}
                    onChange={e => patch({ company_email: e.target.value })} className={inputCls + " font-mono"} />
                </div>
                <div>
                  <label className={labelCls}>대표자명</label>
                  <input type="text" lang="ko" value={info.company_ceo}
                    onChange={e => patch({ company_ceo: e.target.value })} className={inputCls} />
                </div>
              </div>
            </div>

            <div className={sectionCls}>
              {message && (
                <div className={`mb-3 text-xs px-3 py-2 rounded ${
                  message.type === "success" ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                             : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                }`}>{message.text}</div>
              )}
              <div className="flex justify-end">
                <button type="button" onClick={save} disabled={saving || !canUpdate}
                  className="px-5 py-2 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                  {saving ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
