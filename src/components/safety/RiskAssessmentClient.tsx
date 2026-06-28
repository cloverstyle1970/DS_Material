"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import { useAuth, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import {
  RESULT_OPTIONS,
  type RiskCategory,
  type HazardSurvey,
  type HazardSurveyItem,
} from "@/lib/risk";
import { printRiskSheet } from "@/components/safety/riskSheetPrint";

const HREF = "/safety/risk-assessment";

const inputCls =
  "px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-rose-400";

type EditRow = {
  result: string;
  improvement: string;
  improve_done_date: string;
  manager: string;
};

export default function RiskAssessmentClient() {
  const { user } = useAuth();

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  if (!hasMenuPermission(user, HREF, "read")) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
      </div>
    );
  }
  const canWrite =
    hasMenuPermission(user, HREF, "create") || hasMenuPermission(user, HREF, "update");

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">위험성평가 등록</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          유해요인조사에서 ‘유’로 평가된 항목만 위험성평가표로 작성·인쇄합니다. (대분류·항목 마스터는 유해요인조사표에서 관리)
        </p>
      </div>

      <div className="px-4 sm:px-6 py-4">
        <AssessTab canWrite={canWrite} />
      </div>
    </div>
  );
}

// ============================================================
// 위험성평가표 ('유' 항목만)
// ============================================================

function AssessTab({ canWrite }: { canWrite: boolean }) {
  const [categories, setCategories] = useState<RiskCategory[]>([]);
  const [filterCat, setFilterCat] = useState<number | "all">("all");
  const [surveys, setSurveys] = useState<(HazardSurvey & { _cat?: string; _doc?: string; _sub?: string; _yes?: number })[]>([]);
  const [selId, setSelId] = useState<number | null>(null);

  const [survey, setSurvey] = useState<HazardSurvey | null>(null);
  const [selCat, setSelCat] = useState<RiskCategory | null>(null);
  const [rows, setRows] = useState<HazardSurveyItem[]>([]);
  const [edit, setEdit] = useState<Record<number, EditRow>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const loadCats = useCallback(async () => {
    const { data } = await supabase.from("risk_categories").select("*").order("sort_order");
    setCategories((data ?? []) as RiskCategory[]);
  }, []);

  const loadSurveys = useCallback(async () => {
    let q = supabase
      .from("hazard_surveys")
      .select("*, risk_categories(name, doc_no, sub_process), hazard_survey_items(present)")
      .order("id", { ascending: false })
      .limit(200);
    if (filterCat !== "all") q = q.eq("category_id", filterCat);
    const { data } = await q;
    const list = (data ?? []).map((r: any) => ({
      ...r,
      _cat: r.risk_categories?.name,
      _doc: r.risk_categories?.doc_no,
      _sub: r.risk_categories?.sub_process,
      _yes: (r.hazard_survey_items ?? []).filter((i: any) => i.present).length,
    }));
    setSurveys(list);
  }, [filterCat]);

  useEffect(() => {
    void loadCats();
  }, [loadCats]);
  useEffect(() => {
    void loadSurveys();
  }, [loadSurveys]);
  useReloadOnActivate(() => {
    void loadCats();
    void loadSurveys();
  });

  // 선택 조사 상세 로드 ('유' 항목만)
  useEffect(() => {
    if (selId == null) {
      setSurvey(null);
      setRows([]);
      return;
    }
    (async () => {
      const { data: sv } = await supabase.from("hazard_surveys").select("*").eq("id", selId).single();
      setSurvey((sv ?? null) as HazardSurvey | null);
      if (sv) {
        const { data: c } = await supabase.from("risk_categories").select("*").eq("id", sv.category_id).single();
        setSelCat((c ?? null) as RiskCategory | null);
      }
      const { data: its } = await supabase
        .from("hazard_survey_items")
        .select("*")
        .eq("survey_id", selId)
        .eq("present", true)
        .order("sort_order");
      const list = (its ?? []) as HazardSurveyItem[];
      setRows(list);
      setExpandedGroups(new Set()); // 기본 접기
      const e: Record<number, EditRow> = {};
      for (const r of list)
        e[r.id] = {
          result: r.result ?? "",
          improvement: r.improvement ?? r.current_measure ?? "",
          improve_done_date: r.improve_done_date ?? "",
          manager: r.manager ?? "",
        };
      setEdit(e);
    })();
  }, [selId]);

  async function save() {
    if (!survey) return;
    setSaving(true);
    try {
      for (const r of rows) {
        const e = edit[r.id];
        const { error } = await supabase
          .from("hazard_survey_items")
          .update({
            result: e.result || null,
            improvement: e.improvement || null,
            improve_done_date: e.improve_done_date || null,
            manager: e.manager || null,
          })
          .eq("id", r.id);
        if (error) throw error;
      }
      await supabase.from("hazard_surveys").update({ status: "assessed" }).eq("id", survey.id);
      alert("위험성평가표가 저장되었습니다.");
      void loadSurveys();
    } catch (e: any) {
      alert("저장 실패: " + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  function print() {
    if (!survey || !selCat) return;
    const merged = rows.map((r) => ({ ...r, ...edit[r.id] }));
    printRiskSheet(selCat, survey, merged);
  }

  function toggleGroup(g: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  // 구분(중분류)별 그룹
  const rowGroups: { gubun: string; items: HazardSurveyItem[] }[] = [];
  for (const r of rows) {
    const g = r.gubun ?? "";
    const last = rowGroups[rowGroups.length - 1];
    if (last && last.gubun === g) last.items.push(r);
    else rowGroups.push({ gubun: g, items: [r] });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 상: 조사 목록 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">제출된 조사</span>
          <select
            className={`${inputCls} ml-auto`}
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">전체</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="max-h-[32vh] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/60">
          {surveys.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-400">조사 내역이 없습니다.</div>
          ) : (
            surveys.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelId(s.id)}
                className={`w-full text-left px-3 py-2.5 transition-colors ${
                  selId === s.id ? "bg-rose-50 dark:bg-rose-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-700/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-gray-400">{s._doc}</span>
                  {s.assess_type && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">
                      {s.assess_type}
                    </span>
                  )}
                  <span className="flex-1 truncate text-sm text-gray-800 dark:text-gray-100">{s._cat}</span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      s.status === "assessed"
                        ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                        : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                    }`}
                  >
                    {s.status === "assessed" ? "완료" : "제출"}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                  {s.site_name && <span className="truncate max-w-[120px]">📍{s.site_name}</span>}
                  <span>{s.survey_date}</span>
                  <span>· {s.assessor ?? "-"}</span>
                  <span className="ml-auto text-rose-600 dark:text-rose-400 font-semibold">유 {s._yes}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 하: 위험성평가표 작성 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {!survey || !selCat ? (
          <div className="p-12 text-center text-sm text-gray-400">좌측에서 조사를 선택하세요.</div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-sm font-bold text-gray-900 dark:text-white">위험성평가표</span>
              <span className="text-xs font-mono text-gray-500 dark:text-gray-400">문서번호 {selCat.doc_no}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">대분류: {selCat.name}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">중분류: {selCat.sub_process ?? "-"}</span>
              <div className="ml-auto flex gap-2">
                {rowGroups.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedGroups((prev) =>
                        prev.size === rowGroups.length ? new Set() : new Set(rowGroups.map((g) => g.gubun))
                      )
                    }
                    className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold hover:bg-gray-200"
                  >
                    {expandedGroups.size === rowGroups.length ? "전체 접기" : "전체 펼치기"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={print}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold hover:bg-gray-200"
                >
                  🖨 인쇄
                </button>
                {canWrite && (
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-50"
                  >
                    {saving ? "저장 중…" : "저장"}
                  </button>
                )}
              </div>
            </div>

            <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700/60 flex flex-wrap gap-x-4 gap-y-1">
              <span>현장명: {survey.site_name ?? "-"}</span>
              <span>종류: {survey.assess_type ?? "-"}</span>
              <span>작성팀: {survey.team ?? "-"}</span>
              <span>평가자: {survey.assessor ?? "-"}</span>
              <span>작성일: {survey.survey_date}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900/40 text-gray-600 dark:text-gray-300">
                    <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-left">안전보건 유해·위험요인</th>
                    <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-16">재해형태</th>
                    <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-left w-44">현 안전조치</th>
                    <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-40">위험성 확인결과</th>
                    <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-left w-56">개선 대책</th>
                    <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-28">개선 완료일</th>
                    <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-24">담당자</th>
                  </tr>
                </thead>
                <tbody>
                  {rowGroups.map((g, gi) => {
                    const open = expandedGroups.has(g.gubun);
                    return (
                    <Fragment key={gi}>
                      <tr
                        className="cursor-pointer bg-blue-50/60 dark:bg-blue-900/20 hover:bg-blue-100/60 dark:hover:bg-blue-900/30"
                        onClick={() => toggleGroup(g.gubun)}
                      >
                        <td colSpan={7} className="border border-gray-200 dark:border-gray-700 px-2 py-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-blue-400 text-xs transition-transform duration-200 ${open ? "rotate-0" : "-rotate-90"}`}>▾</span>
                            <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{g.gubun || "(구분 미지정)"}</span>
                            <span className="text-[11px] text-gray-400">({g.items.length})</span>
                          </div>
                        </td>
                      </tr>
                      {open && g.items.map((r) => {
                    const e =
                      edit[r.id] ?? { result: "", improvement: "", improve_done_date: "", manager: "" };
                    return (
                      <tr key={r.id} className="align-top text-gray-800 dark:text-gray-100">
                        <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 pl-6">{r.hazard}</td>
                        <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center whitespace-nowrap">{r.accident_type}</td>
                        <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 whitespace-pre-wrap">{r.current_measure}</td>
                        <td className="border border-gray-200 dark:border-gray-700 px-2 py-2">
                          <div className="flex flex-col gap-1">
                            {RESULT_OPTIONS.map((opt) => (
                              <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`result-${r.id}`}
                                  checked={e.result === opt}
                                  disabled={!canWrite}
                                  onChange={() => setEdit((p) => ({ ...p, [r.id]: { ...p[r.id], result: opt } }))}
                                />
                                <span>{opt}</span>
                              </label>
                            ))}
                          </div>
                        </td>
                        <td className="border border-gray-200 dark:border-gray-700 px-1 py-1">
                          <textarea
                            className={`${inputCls} w-full min-h-[64px] resize-y`}
                            value={e.improvement}
                            disabled={!canWrite}
                            onChange={(ev) => setEdit((p) => ({ ...p, [r.id]: { ...p[r.id], improvement: ev.target.value } }))}
                          />
                        </td>
                        <td className="border border-gray-200 dark:border-gray-700 px-1 py-1">
                          <input
                            type="date"
                            className={`${inputCls} w-full`}
                            value={e.improve_done_date}
                            disabled={!canWrite}
                            onChange={(ev) => setEdit((p) => ({ ...p, [r.id]: { ...p[r.id], improve_done_date: ev.target.value } }))}
                          />
                        </td>
                        <td className="border border-gray-200 dark:border-gray-700 px-1 py-1">
                          <input
                            className={`${inputCls} w-full`}
                            value={e.manager}
                            disabled={!canWrite}
                            onChange={(ev) => setEdit((p) => ({ ...p, [r.id]: { ...p[r.id], manager: ev.target.value } }))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                    </Fragment>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="border border-gray-200 dark:border-gray-700 px-2 py-8 text-center text-gray-400">
                        ‘유’로 평가된 항목이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
