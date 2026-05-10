"use client";

import { useEffect, useState } from "react";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

const MENU_HREF = "/quotes/settings";

interface Settings {
  default_direct_labor: number;
  indirect_labor_rate: number;
  overhead_rate: number;
  profit_rate: number;
  company_name: string;
  company_biz_no: string;
  company_address: string;
  company_phone: string;
  company_email: string;
  company_ceo: string;
}

const EMPTY: Settings = {
  default_direct_labor: 0,
  indirect_labor_rate: 8,
  overhead_rate: 10,
  profit_rate: 8,
  company_name: "",
  company_biz_no: "",
  company_address: "",
  company_phone: "",
  company_email: "",
  company_ceo: "",
};

function fmtNum(n: number): string {
  return n.toLocaleString();
}
function parseNum(s: string): number {
  const v = s.replace(/[^0-9-]/g, "");
  return v === "" || v === "-" ? 0 : Number(v);
}

export default function QuoteSettingsClient() {
  const { user } = useAuth();
  const [s, setS] = useState<Settings>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("quote_settings").select("*").eq("id", 1).single();
      if (data) {
        setS({
          default_direct_labor: data.default_direct_labor ?? 0,
          indirect_labor_rate:  Number(data.indirect_labor_rate ?? 8),
          overhead_rate:        Number(data.overhead_rate ?? 10),
          profit_rate:          Number(data.profit_rate ?? 8),
          company_name:    data.company_name ?? "",
          company_biz_no:  data.company_biz_no ?? "",
          company_address: data.company_address ?? "",
          company_phone:   data.company_phone ?? "",
          company_email:   data.company_email ?? "",
          company_ceo:     data.company_ceo ?? "",
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

  function patch(p: Partial<Settings>) {
    setS(prev => ({ ...prev, ...p }));
  }

  async function save() {
    setMessage(null);
    if (!canUpdate) { setMessage({ type: "error", text: "수정 권한이 없습니다." }); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("quote_settings").update({
        default_direct_labor: s.default_direct_labor,
        indirect_labor_rate:  s.indirect_labor_rate,
        overhead_rate:        s.overhead_rate,
        profit_rate:          s.profit_rate,
        company_name:    s.company_name    || null,
        company_biz_no:  s.company_biz_no  || null,
        company_address: s.company_address || null,
        company_phone:   s.company_phone   || null,
        company_email:   s.company_email   || null,
        company_ceo:     s.company_ceo     || null,
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
      if (error) throw error;
      setMessage({ type: "success", text: "설정이 저장되었습니다." });
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
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">견적 기본 설정</h1>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">기본 인건비·요율·회사 정보 (견적서 작성 시 자동 적용)</p>
      </div>

      <div className="p-6 space-y-4 max-w-3xl">
        {!loaded ? (
          <div className="text-center py-12 text-sm text-gray-500">로딩 중...</div>
        ) : (
          <>
            {/* 인건비/요율 */}
            <div className={sectionCls}>
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">💰 인건비 · 요율 기본값</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>기본 직접인건비 (원)</label>
                  <input type="text" inputMode="numeric"
                    value={s.default_direct_labor === 0 ? "" : fmtNum(s.default_direct_labor)}
                    onChange={e => patch({ default_direct_labor: parseNum(e.target.value) })}
                    placeholder="0" className={inputCls + " text-right tabular-nums"} />
                  <div className="text-[11px] text-gray-500 mt-1">견적서 작성 시 직접인건비 칸에 자동 입력</div>
                </div>
                <div></div>
                <div>
                  <label className={labelCls}>간접인건비율 (%)</label>
                  <input type="text" inputMode="decimal" value={s.indirect_labor_rate}
                    onChange={e => {
                      const v = e.target.value.replace(/[^0-9.]/g, "");
                      patch({ indirect_labor_rate: v === "" ? 0 : Number(v) });
                    }}
                    className={inputCls + " text-right tabular-nums"} />
                  <div className="text-[11px] text-gray-500 mt-1">간접 = 직접인건비 × 이 비율</div>
                </div>
                <div>
                  <label className={labelCls}>일반관리비율 (%)</label>
                  <input type="text" inputMode="decimal" value={s.overhead_rate}
                    onChange={e => {
                      const v = e.target.value.replace(/[^0-9.]/g, "");
                      patch({ overhead_rate: v === "" ? 0 : Number(v) });
                    }}
                    className={inputCls + " text-right tabular-nums"} />
                  <div className="text-[11px] text-gray-500 mt-1">(자재비 + 인건비) × 이 비율</div>
                </div>
                <div>
                  <label className={labelCls}>이윤율 (%)</label>
                  <input type="text" inputMode="decimal" value={s.profit_rate}
                    onChange={e => {
                      const v = e.target.value.replace(/[^0-9.]/g, "");
                      patch({ profit_rate: v === "" ? 0 : Number(v) });
                    }}
                    className={inputCls + " text-right tabular-nums"} />
                  <div className="text-[11px] text-gray-500 mt-1">(인건비 + 일반관리비) × 이 비율</div>
                </div>
              </div>
            </div>

            {/* 회사 정보 */}
            <div className={sectionCls}>
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">🏢 회사 정보 (견적서 출력 시 표시)</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>회사명</label>
                  <input type="text" lang="ko" value={s.company_name} onChange={e => patch({ company_name: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>사업자등록번호</label>
                  <input type="text" value={s.company_biz_no} onChange={e => patch({ company_biz_no: e.target.value })} placeholder="000-00-00000" className={inputCls + " font-mono"} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>주소</label>
                  <input type="text" lang="ko" value={s.company_address} onChange={e => patch({ company_address: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>전화번호</label>
                  <input type="text" value={s.company_phone} onChange={e => patch({ company_phone: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>이메일</label>
                  <input type="email" value={s.company_email} onChange={e => patch({ company_email: e.target.value })} className={inputCls + " font-mono"} />
                </div>
                <div>
                  <label className={labelCls}>대표자명</label>
                  <input type="text" lang="ko" value={s.company_ceo} onChange={e => patch({ company_ceo: e.target.value })} className={inputCls} />
                </div>
              </div>
            </div>

            {/* 저장 */}
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
