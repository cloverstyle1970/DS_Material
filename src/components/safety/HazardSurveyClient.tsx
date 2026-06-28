"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import { ASSESS_TYPES, type RiskCategory, type RiskHazardItem, type HazardSurvey } from "@/lib/risk";

const HREF = "/safety/hazard-survey";

const inputCls =
  "px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-rose-400";

function todayStr() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export default function HazardSurveyClient() {
  const { user } = useAuth();

  const [categories, setCategories] = useState<RiskCategory[]>([]);
  const [catId, setCatId] = useState<number | null>(null);
  const [items, setItems] = useState<RiskHazardItem[]>([]);
  const [present, setPresent] = useState<Record<number, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const [siteName, setSiteName] = useState("");
  const [assessType, setAssessType] = useState<string>("정기");
  const [team, setTeam] = useState("");
  const [assessor, setAssessor] = useState("");
  const [surveyDate, setSurveyDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);

  const [myList, setMyList] = useState<(HazardSurvey & { _cat?: string; _doc?: string; _yes?: number })[]>([]);

  const canWrite =
    !!user &&
    (hasMenuPermission(user, HREF, "create") || hasMenuPermission(user, HREF, "update"));

  const loadCategories = useCallback(async () => {
    const { data } = await supabase
      .from("risk_categories")
      .select("*")
      .eq("active", true)
      .order("sort_order");
    const list = (data ?? []) as RiskCategory[];
    setCategories(list);
    setCatId((prev) => prev ?? (list[0]?.id ?? null));
  }, []);

  const loadMyList = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("hazard_surveys")
      .select("*, risk_categories(name, doc_no), hazard_survey_items(present)")
      .eq("user_id", user.id)
      .order("id", { ascending: false })
      .limit(50);
    const rows = (data ?? []).map((r: any) => ({
      ...r,
      _cat: r.risk_categories?.name,
      _doc: r.risk_categories?.doc_no,
      _yes: (r.hazard_survey_items ?? []).filter((i: any) => i.present).length,
    }));
    setMyList(rows);
  }, [user]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);
  useEffect(() => {
    void loadMyList();
  }, [loadMyList]);
  useEffect(() => {
    if (user && !assessor) setAssessor(user.name);
  }, [user, assessor]);
  useReloadOnActivate(() => {
    void loadCategories();
    void loadMyList();
  });

  // 대분류 변경 시 항목 로드
  useEffect(() => {
    if (catId == null) {
      setItems([]);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("risk_hazard_items")
        .select("*")
        .eq("category_id", catId)
        .eq("active", true)
        .order("sort_order");
      const list = (data ?? []) as RiskHazardItem[];
      setItems(list);
      // 마스터의 기본 유/무(default_present)로 초기화 — 기사가 현장에 맞게 조정
      const init: Record<number, boolean> = {};
      for (const it of list) init[it.id] = !!it.default_present;
      setPresent(init);
      // 구분 그룹 전체 접힘으로 초기화(기본 접기)
      setExpandedGroups(new Set());
    })();
  }, [catId]);

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  if (!hasMenuPermission(user, HREF, "read")) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
      </div>
    );
  }

  const cat = categories.find((c) => c.id === catId) ?? null;
  const yesCount = items.filter((i) => present[i.id]).length;

  // 구분별 그룹
  const groups: { gubun: string; items: RiskHazardItem[] }[] = [];
  for (const it of items) {
    const g = it.gubun ?? "";
    const last = groups[groups.length - 1];
    if (last && last.gubun === g) last.items.push(it);
    else groups.push({ gubun: g, items: [it] });
  }

  function toggleGroup(g: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  async function submit() {
    if (!user || !cat) return;
    if (!surveyDate) {
      alert("작성일을 입력하세요.");
      return;
    }
    setSaving(true);
    try {
      const { data: sv, error: e1 } = await supabase
        .from("hazard_surveys")
        .insert({
          category_id: cat.id,
          site_name: siteName || null,
          assess_type: assessType || null,
          team: team || null,
          assessor: assessor || null,
          survey_date: surveyDate,
          user_id: user.id,
          status: "submitted",
        })
        .select("id")
        .single();
      if (e1 || !sv) throw e1 ?? new Error("저장 실패");

      const rows = items.map((it, idx) => ({
        survey_id: sv.id,
        item_id: it.id,
        gubun: it.gubun,
        hazard: it.hazard,
        accident_type: it.accident_type,
        current_measure: it.current_measure,
        present: !!present[it.id],
        improvement: present[it.id] ? it.default_improvement ?? it.current_measure : null,
        sort_order: it.sort_order ?? idx,
      }));
      const { error: e2 } = await supabase.from("hazard_survey_items").insert(rows);
      if (e2) throw e2;

      alert(`제출되었습니다. (유해요인 '유' ${rows.filter((r) => r.present).length}건 → 위험성평가표 반영)`);
      setPresent({});
      void loadMyList();
    } catch (e: any) {
      alert("제출 실패: " + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">유해요인조사표 등록</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          대분류 공정을 선택하고 각 유해·위험요인의 유/무를 평가합니다. ‘유’ 항목은 위험성평가표에 자동 반영됩니다.
        </p>
      </div>

      <div className="p-4 sm:p-6 space-y-4 max-w-3xl mx-auto">
        {/* 작성 정보 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">대분류 공정</span>
              <select
                className={inputCls}
                value={catId ?? ""}
                onChange={(e) => setCatId(Number(e.target.value))}
              >
                {categories.length === 0 && <option value="">(등록된 대분류 없음)</option>}
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.doc_no}] {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">중분류 공정</span>
              <input className={`${inputCls} bg-gray-50 dark:bg-gray-900/40`} value={cat?.sub_process ?? ""} readOnly />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">현장명</span>
              <input className={inputCls} value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="예) ○○빌딩" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">종류</span>
              <select className={inputCls} value={assessType} onChange={(e) => setAssessType(e.target.value)}>
                {ASSESS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">작성팀</span>
              <input className={inputCls} value={team} onChange={(e) => setTeam(e.target.value)} placeholder="예) 보수1팀" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">평가자</span>
              <input className={inputCls} value={assessor} onChange={(e) => setAssessor(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">작성일</span>
              <input type="date" className={inputCls} value={surveyDate} onChange={(e) => setSurveyDate(e.target.value)} />
            </label>
          </div>
        </div>

        {/* 항목 유/무 평가 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">유해·위험요인 평가</span>
            <div className="flex items-center gap-2">
              {groups.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedGroups((prev) =>
                      prev.size === groups.length ? new Set() : new Set(groups.map((g) => g.gubun))
                    )
                  }
                  className="text-[11px] font-semibold px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200"
                >
                  {expandedGroups.size === groups.length ? "전체 접기" : "전체 펼치기"}
                </button>
              )}
              <span className="text-xs text-gray-500 dark:text-gray-400">
                총 {items.length}건 · <span className="text-rose-600 dark:text-rose-400 font-bold">유 {yesCount}</span>건
              </span>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">등록된 유해요인 항목이 없습니다.</div>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/60">
              {groups.map((g, gi) => {
                const open = expandedGroups.has(g.gubun);
                const groupYes = g.items.filter((it) => present[it.id]).length;
                return (
                <div key={gi}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.gubun)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 sticky top-0 z-10 bg-gray-100 dark:bg-gray-900 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                  >
                    <span className={`text-blue-400 text-xs transition-transform duration-200 ${open ? "rotate-0" : "-rotate-90"}`}>▾</span>
                    <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{g.gubun || "(구분 미지정)"}</span>
                    <span className="text-[11px] text-gray-400">({g.items.length})</span>
                    <span className="ml-auto text-[11px] font-semibold text-rose-600 dark:text-rose-400">유 {groupYes}</span>
                  </button>
                  {open && g.items.map((it) => {
                    const on = !!present[it.id];
                    return (
                      <div key={it.id} className="px-4 py-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 dark:text-gray-100">{it.hazard}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            재해형태: {it.accident_type || "-"}
                          </p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={!canWrite}
                            onClick={() => setPresent((p) => ({ ...p, [it.id]: true }))}
                            className={`min-w-[44px] px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                              on
                                ? "bg-rose-600 text-white"
                                : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-rose-100 dark:hover:bg-rose-900/30"
                            }`}
                          >
                            유
                          </button>
                          <button
                            type="button"
                            disabled={!canWrite}
                            onClick={() => setPresent((p) => ({ ...p, [it.id]: false }))}
                            className={`min-w-[44px] px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                              !on
                                ? "bg-gray-700 text-white dark:bg-gray-600"
                                : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-200"
                            }`}
                          >
                            무
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                );
              })}
            </div>
          )}

          {items.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                disabled={!canWrite || saving}
                onClick={submit}
                className="w-full py-3 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-50"
              >
                {saving ? "제출 중…" : "조사표 제출"}
              </button>
            </div>
          )}
        </div>

        {/* 내 제출 이력 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-800 dark:text-gray-100">
            내 제출 이력
          </div>
          {myList.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">제출 이력이 없습니다.</div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {myList.map((s) => (
                <div key={s.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                  <span className="text-xs font-mono text-gray-400">{s._doc}</span>
                  {s.assess_type && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">
                      {s.assess_type}
                    </span>
                  )}
                  <span className="flex-1 min-w-0 truncate text-gray-800 dark:text-gray-100">
                    {s._cat}
                    {s.site_name && <span className="text-gray-400"> · {s.site_name}</span>}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{s.survey_date}</span>
                  <span className="text-xs text-rose-600 dark:text-rose-400 font-semibold">유 {s._yes}</span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      s.status === "assessed"
                        ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                        : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                    }`}
                  >
                    {s.status === "assessed" ? "평가완료" : "제출"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
