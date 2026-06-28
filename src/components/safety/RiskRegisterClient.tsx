"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { useAuth, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import { ASSESS_TYPES, type RiskCategory, type HazardSurvey, type HazardSurveyItem } from "@/lib/risk";
import { printRiskSheet } from "@/components/safety/riskSheetPrint";

const HREF = "/safety/risk-register";

const inputCls =
  "px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-rose-400";

type Row = HazardSurvey & {
  _cat?: string;
  _doc?: string;
  _sub?: string;
  _yes?: number;
  _ok?: number;   // 적정
  _fix?: number;  // 보완
};

export default function RiskRegisterClient() {
  const { user } = useAuth();

  const [categories, setCategories] = useState<RiskCategory[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const [fCat, setFCat] = useState<number | "all">("all");
  const [fType, setFType] = useState<string>("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [kw, setKw] = useState("");

  const [detail, setDetail] = useState<Row | null>(null);

  const loadCats = useCallback(async () => {
    const { data } = await supabase.from("risk_categories").select("*").order("sort_order");
    setCategories((data ?? []) as RiskCategory[]);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("hazard_surveys")
      .select("*, risk_categories(name, doc_no, sub_process), hazard_survey_items(present, result)")
      .eq("status", "assessed")
      .order("id", { ascending: false })
      .limit(500);
    if (fCat !== "all") q = q.eq("category_id", fCat);
    if (fType !== "all") q = q.eq("assess_type", fType);
    if (fFrom) q = q.gte("survey_date", fFrom);
    if (fTo) q = q.lte("survey_date", fTo);
    const { data } = await q;
    const list = (data ?? []).map((r: any) => {
      const its = (r.hazard_survey_items ?? []).filter((i: any) => i.present);
      return {
        ...r,
        _cat: r.risk_categories?.name,
        _doc: r.risk_categories?.doc_no,
        _sub: r.risk_categories?.sub_process,
        _yes: its.length,
        _ok: its.filter((i: any) => i.result === "적정").length,
        _fix: its.filter((i: any) => i.result === "보완").length,
      };
    }) as Row[];
    setRows(list);
    setLoading(false);
  }, [fCat, fType, fFrom, fTo]);

  useEffect(() => {
    void loadCats();
  }, [loadCats]);
  useEffect(() => {
    void load();
  }, [load]);
  useReloadOnActivate(() => {
    void loadCats();
    void load();
  });

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  if (!hasMenuPermission(user, HREF, "read")) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
      </div>
    );
  }
  const canManage = hasMenuPermission(user, HREF, "update");

  const kwLc = kw.trim().toLowerCase();
  const view = kwLc
    ? rows.filter(
        (r) =>
          (r.site_name ?? "").toLowerCase().includes(kwLc) ||
          (r.assessor ?? "").toLowerCase().includes(kwLc) ||
          (r._cat ?? "").toLowerCase().includes(kwLc)
      )
    : rows;

  async function revert(r: Row) {
    if (!confirm(`[${r._doc}] ${r._cat} / ${r.survey_date} 위험성평가를 취소(제출 상태로 되돌리기)할까요?\n입력한 확인결과·개선대책은 유지되며, '위험성평가 등록'에서 다시 수정할 수 있습니다.`)) return;
    const { error } = await supabase.from("hazard_surveys").update({ status: "submitted" }).eq("id", r.id);
    if (error) return alert("처리 실패: " + error.message);
    void load();
  }

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">위험성평가대장</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          위험성평가가 완료(등록)된 내역을 조회·상세보기·인쇄·평가취소로 관리합니다.
        </p>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        {/* 필터 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">대분류</span>
            <select className={inputCls} value={fCat} onChange={(e) => setFCat(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">전체</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">종류</span>
            <select className={inputCls} value={fType} onChange={(e) => setFType(e.target.value)}>
              <option value="all">전체</option>
              {ASSESS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">작성일(부터)</span>
            <input type="date" className={inputCls} value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">작성일(까지)</span>
            <input type="date" className={inputCls} value={fTo} onChange={(e) => setFTo(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">검색(현장·평가자·대분류)</span>
            <input className={inputCls} value={kw} onChange={(e) => setKw(e.target.value)} placeholder="키워드" />
          </label>
          {(fCat !== "all" || fType !== "all" || fFrom || fTo || kw) && (
            <button
              type="button"
              onClick={() => {
                setFCat("all");
                setFType("all");
                setFFrom("");
                setFTo("");
                setKw("");
              }}
              className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-semibold hover:bg-gray-200"
            >
              초기화
            </button>
          )}
        </div>

        {/* 목록 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center">
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">평가 완료 내역</span>
            <span className="ml-2 text-xs text-gray-400">{view.length}건</span>
            {loading && <span className="ml-auto text-xs text-gray-400">불러오는 중…</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/40 text-gray-600 dark:text-gray-300">
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-20">문서번호</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-14">종류</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-left">대분류</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-left">현장명</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-20">평가자</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-24">작성일</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-16">평가건수</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-24">적정/보완</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-28">관리</th>
                </tr>
              </thead>
              <tbody>
                {view.map((r) => (
                  <tr key={r.id} className="text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center font-mono text-[11px] text-gray-500">{r._doc}</td>
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">
                        {r.assess_type ?? "-"}
                      </span>
                    </td>
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2">{r._cat}</td>
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2">{r.site_name ?? "-"}</td>
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center">{r.assessor ?? "-"}</td>
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center whitespace-nowrap">{r.survey_date}</td>
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center font-bold text-rose-600 dark:text-rose-400">{r._yes}</td>
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center whitespace-nowrap">
                      <span className="text-green-600 dark:text-green-400 font-semibold">{r._ok}</span>
                      <span className="text-gray-400"> / </span>
                      <span className="text-amber-600 dark:text-amber-400 font-semibold">{r._fix}</span>
                    </td>
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2">
                      <div className="flex gap-1 justify-center">
                        <button
                          type="button"
                          onClick={() => setDetail(r)}
                          className="px-1.5 py-0.5 text-[11px] rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                        >
                          상세
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => revert(r)}
                            className="px-1.5 py-0.5 text-[11px] rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                          >
                            평가취소
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {view.length === 0 && !loading && (
                  <tr>
                    <td colSpan={9} className="border border-gray-200 dark:border-gray-700 px-2 py-10 text-center text-gray-400">
                      평가 완료된 내역이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {detail && <DetailModal row={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

// 상세 모달 — 위험성평가표(읽기 전용, '유' 항목)
function DetailModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const [items, setItems] = useState<HazardSurveyItem[]>([]);
  const [cat, setCat] = useState<RiskCategory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: its } = await supabase
        .from("hazard_survey_items")
        .select("*")
        .eq("survey_id", row.id)
        .eq("present", true)
        .order("sort_order");
      setItems((its ?? []) as HazardSurveyItem[]);
      const { data: c } = await supabase.from("risk_categories").select("*").eq("id", row.category_id).single();
      setCat((c ?? null) as RiskCategory | null);
      setLoading(false);
    })();
  }, [row.id, row.category_id]);

  const groups: { gubun: string; items: HazardSurveyItem[] }[] = [];
  for (const it of items) {
    const g = it.gubun ?? "";
    const last = groups[groups.length - 1];
    if (last && last.gubun === g) last.items.push(it);
    else groups.push({ gubun: g, items: [it] });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 w-full max-w-5xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">위험성평가표 상세</h3>
          <span className="text-xs font-mono text-gray-400">{row._doc}</span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={!cat}
              onClick={() => cat && printRiskSheet(cat, row, items)}
              className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold hover:bg-gray-200 disabled:opacity-50"
            >
              🖨 인쇄
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold hover:bg-gray-200"
            >
              닫기
            </button>
          </div>
        </div>

        <div className="px-5 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700/60 flex flex-wrap gap-x-4 gap-y-1">
          <span>대분류: {row._cat}</span>
          <span>종류: {row.assess_type ?? "-"}</span>
          <span>현장명: {row.site_name ?? "-"}</span>
          <span>작성팀: {row.team ?? "-"}</span>
          <span>평가자: {row.assessor ?? "-"}</span>
          <span>작성일: {row.survey_date}</span>
        </div>

        <div className="overflow-auto p-4">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">불러오는 중…</div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-300">
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-left">안전보건 유해·위험요인</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-16">재해형태</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-16">확인결과</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-left w-56">개선 대책</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-24">개선 완료일</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-20">담당자</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, gi) => (
                  <Fragment key={gi}>
                    <tr className="bg-blue-50/60 dark:bg-blue-900/20">
                      <td colSpan={6} className="border border-gray-200 dark:border-gray-700 px-2 py-1.5">
                        <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{g.gubun || "(구분 미지정)"}</span>
                        <span className="text-[11px] text-gray-400"> ({g.items.length})</span>
                      </td>
                    </tr>
                    {g.items.map((it) => (
                      <tr key={it.id} className="align-top text-gray-800 dark:text-gray-100">
                        <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 pl-6">{it.hazard}</td>
                        <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center whitespace-nowrap">{it.accident_type || "-"}</td>
                        <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center whitespace-nowrap">
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                              it.result === "적정"
                                ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                                : it.result === "보완"
                                ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                                : "bg-gray-100 dark:bg-gray-700 text-gray-400"
                            }`}
                          >
                            {it.result || "-"}
                          </span>
                        </td>
                        <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 whitespace-pre-wrap">{it.improvement || "-"}</td>
                        <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center whitespace-nowrap">{it.improve_done_date || "-"}</td>
                        <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center">{it.manager || "-"}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
