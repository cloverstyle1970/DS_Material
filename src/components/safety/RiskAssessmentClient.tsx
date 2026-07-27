"use client";

import { Fragment, useEffect, useRef, useState, useCallback } from "react";
import { useAuth, hasMenuPermission, isAdmin } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { useViewMode } from "@/context/ViewModeContext";
import { supabase } from "@/lib/supabase";
import {
  ASSESS_TYPES,
  RESULT_OPTIONS,
  type RiskCategory,
  type RiskHazardItem,
  type HazardSurvey,
  type HazardSurveyItem,
  type HazardSurveyParticipant,
} from "@/lib/risk";
import { printRiskSheet } from "@/components/safety/riskSheetPrint";
import SignaturePad, { type SignaturePadHandle } from "@/components/tbm/SignaturePad";
import { insertNotification } from "@/lib/notify";

// 서명 이미지는 기존 tbm-photos 버킷 재활용 (risk/ 접두사로 구분)
const SIGN_BUCKET = "tbm-photos";
const SIGN_PATH_PREFIX = "risk";

interface UserMini {
  id: number;
  name: string | null;
  dept: string | null;
}

type ParticipantDraft = UserMini;

const HREF = "/safety/risk-assessment";

const inputCls =
  "px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-rose-400";

const modalInputCls =
  "px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-rose-400";

function todayStr() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

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
        <AssessTab canWrite={canWrite} currentUserId={user.id} currentUserName={user.name} isUserAdmin={isAdmin(user)} />
      </div>
    </div>
  );
}

// ============================================================
// 위험성평가표 ('유' 항목만)
// ============================================================

function AssessTab({
  canWrite,
  currentUserId,
  currentUserName,
  isUserAdmin,
}: {
  canWrite: boolean;
  currentUserId: number;
  currentUserName: string;
  isUserAdmin: boolean;
}) {
  const [categories, setCategories] = useState<RiskCategory[]>([]);
  const [filterCat, setFilterCat] = useState<number | "all">("all");
  const [surveys, setSurveys] = useState<(HazardSurvey & {
    _cat?: string;
    _doc?: string;
    _sub?: string;
    _yes?: number;
    _isParticipant?: boolean;
    _mySigned?: boolean;
  })[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [signingSurveyId, setSigningSurveyId] = useState<number | null>(null);

  const [survey, setSurvey] = useState<HazardSurvey | null>(null);
  const [selCat, setSelCat] = useState<RiskCategory | null>(null);
  const [rows, setRows] = useState<HazardSurveyItem[]>([]);
  const [sheetParts, setSheetParts] = useState<HazardSurveyParticipant[]>([]);
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
      .select(
        "*, risk_categories(name, doc_no, sub_process), hazard_survey_items(present), hazard_survey_participants(user_id, signature_url)"
      )
      .order("id", { ascending: false })
      .limit(200);
    if (filterCat !== "all") q = q.eq("category_id", filterCat);
    const { data } = await q;
    const list = (data ?? []).map((r: any) => {
      const myPart = (r.hazard_survey_participants ?? []).find((p: any) => p.user_id === currentUserId);
      return {
        ...r,
        _cat: r.risk_categories?.name,
        _doc: r.risk_categories?.doc_no,
        _sub: r.risk_categories?.sub_process,
        _yes: (r.hazard_survey_items ?? []).filter((i: any) => i.present).length,
        _isParticipant: !!myPart,
        _mySigned: !!myPart?.signature_url,
      };
    });
    setSurveys(list);
  }, [filterCat, currentUserId]);

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

  // 선택 조사의 참가자·서명 현황. 서명 직후에도 다시 불러 최신 상태를 반영한다.
  const loadSheetParts = useCallback(async (surveyId: number) => {
    const { data } = await supabase
      .from("hazard_survey_participants")
      .select("*")
      .eq("survey_id", surveyId)
      .order("created_at");
    setSheetParts((data ?? []) as HazardSurveyParticipant[]);
  }, []);

  // 선택 조사 상세 로드 ('유' 항목만)
  useEffect(() => {
    if (selId == null) {
      setSurvey(null);
      setRows([]);
      setSheetParts([]);
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
      void loadSheetParts(selId);
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
  }, [selId, loadSheetParts]);

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
    printRiskSheet(selCat, survey, merged, sheetParts);
  }

  function toggleGroup(g: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  async function uploadMySignature(dataUrl: string): Promise<string> {
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${SIGN_PATH_PREFIX}/${currentUserId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const { error: upErr } = await supabase.storage.from(SIGN_BUCKET).upload(path, blob, {
      cacheControl: "3600",
      upsert: false,
      contentType: "image/png",
    });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(SIGN_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function saveMySignature(surveyId: number, dataUrl: string) {
    try {
      const url = await uploadMySignature(dataUrl);
      const { error } = await supabase
        .from("hazard_survey_participants")
        .update({ signature_url: url, signed_at: new Date().toISOString() })
        .eq("survey_id", surveyId)
        .eq("user_id", currentUserId);
      if (error) throw error;
      setSigningSurveyId(null);
      void loadSurveys();
      if (selId === surveyId) void loadSheetParts(surveyId);
    } catch (e: any) {
      alert("서명 저장 실패: " + (e?.message ?? e));
    }
  }

  async function deleteSurvey(s: HazardSurvey & { _cat?: string; _doc?: string }) {
    if (!confirm(`[${s._doc}] ${s._cat} / ${s.survey_date} 위험성평가를 삭제할까요?\n관련 유해요인 항목·참가자·서명이 모두 함께 삭제됩니다. 되돌릴 수 없습니다.`)) return;
    const { error } = await supabase.from("hazard_surveys").delete().eq("id", s.id);
    if (error) {
      alert("삭제 실패: " + error.message);
      return;
    }
    if (selId === s.id) setSelId(null);
    void loadSurveys();
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
          {canWrite && (
            <button
              type="button"
              onClick={() => setShowNewModal(true)}
              className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700"
            >
              + 신규 등록
            </button>
          )}
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
            surveys.map((s) => {
              const canDelete = isUserAdmin || s.user_id === currentUserId;
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelId(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelId(s.id);
                    }
                  }}
                  className={`w-full text-left px-3 py-2.5 transition-colors cursor-pointer ${
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
                    {s._isParticipant && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSigningSurveyId(s.id);
                        }}
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          s._mySigned
                            ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200"
                            : "bg-rose-600 text-white hover:bg-rose-700 animate-pulse"
                        }`}
                        title={s._mySigned ? "이미 서명함 — 재서명" : "참가자로 지정됨 — 서명 필요"}
                      >
                        {s._mySigned ? "✔ 서명됨" : "✍️ 서명"}
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteSurvey(s);
                        }}
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60"
                        title={isUserAdmin ? "관리자 권한으로 삭제" : "본인 제출 자료 삭제"}
                      >
                        삭제
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                    {s.site_name && <span className="truncate max-w-[120px]">📍{s.site_name}</span>}
                    <span>{s.survey_date}</span>
                    <span>· {s.assessor ?? "-"}</span>
                    <span className="ml-auto text-rose-600 dark:text-rose-400 font-semibold">유 {s._yes}</span>
                  </div>
                </div>
              );
            })
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

            {sheetParts.length > 0 && (
              <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700/60">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                    👷 평가 참가자 ({sheetParts.length}명)
                  </span>
                  <span className="text-[11px] text-gray-400">
                    서명 {sheetParts.filter((p) => p.signature_url).length}/{sheetParts.length}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {sheetParts.map((p) => (
                    <div
                      key={p.user_id}
                      className="flex items-center gap-2 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40"
                    >
                      <span className="text-xs font-medium text-gray-800 dark:text-gray-100">{p.user_name}</span>
                      {p.signature_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.signature_url}
                          alt={`${p.user_name} 서명`}
                          className="h-7 w-auto max-w-[90px] object-contain bg-white rounded"
                        />
                      ) : (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400">서명 대기</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

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

      {showNewModal && (
        <NewSurveyModal
          categories={categories}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          onClose={() => setShowNewModal(false)}
          onCreated={(newId) => {
            setShowNewModal(false);
            void loadSurveys();
            setSelId(newId);
          }}
        />
      )}

      {signingSurveyId != null && (
        <SignatureModal
          participant={{ id: currentUserId, name: currentUserName, dept: null }}
          onClose={() => setSigningSurveyId(null)}
          onSigned={(dataUrl) => void saveMySignature(signingSurveyId, dataUrl)}
        />
      )}
    </div>
  );
}

// ============================================================
// 신규 등록 모달 — 대분류 선택 + 항목 유/무 → hazard_surveys + items 생성
// 저장 후 자동으로 상위에서 selId 세팅 → 평가표 화면으로 진입
// ============================================================

function NewSurveyModal({
  categories,
  currentUserId,
  currentUserName,
  onClose,
  onCreated,
}: {
  categories: RiskCategory[];
  currentUserId: number;
  currentUserName: string;
  onClose: () => void;
  onCreated: (newSurveyId: number) => void;
}) {
  const { viewMode } = useViewMode();
  const isMobile = viewMode === "mobile";

  const [catId, setCatId] = useState<number | null>(categories[0]?.id ?? null);
  const [siteName, setSiteName] = useState("");
  const [assessType, setAssessType] = useState<string>("정기");
  const [team, setTeam] = useState("");
  const [assessor, setAssessor] = useState(currentUserName);
  const [surveyDate, setSurveyDate] = useState(todayStr());
  const [items, setItems] = useState<RiskHazardItem[]>([]);
  const [present, setPresent] = useState<Record<number, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // 참가자 상태 (서명은 등록 시엔 하지 않음 — 알림 후 각자 서명)
  const [users, setUsers] = useState<UserMini[]>([]);
  const [participants, setParticipants] = useState<ParticipantDraft[]>([]);
  const [showAddParticipantsModal, setShowAddParticipantsModal] = useState(false);

  const cat = categories.find((c) => c.id === catId) ?? null;

  // 사원 목록 로드 (참가자 검색용)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("accounts")
        .select("id, name:username, dept")
        .eq("status", "재직")
        .order("username");
      setUsers((data ?? []) as UserMini[]);
    })();
  }, []);

  // 대분류 변경 시 항목 로드 + 기본 유/무 세팅
  useEffect(() => {
    if (catId == null) {
      setItems([]);
      setPresent({});
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
      const init: Record<number, boolean> = {};
      for (const it of list) init[it.id] = !!it.default_present;
      setPresent(init);
      setExpandedGroups(new Set());
    })();
  }, [catId]);

  // 구분별 그룹
  const groups: { gubun: string; items: RiskHazardItem[] }[] = [];
  for (const it of items) {
    const g = it.gubun ?? "";
    const last = groups[groups.length - 1];
    if (last && last.gubun === g) last.items.push(it);
    else groups.push({ gubun: g, items: [it] });
  }

  const yesCount = items.filter((i) => present[i.id]).length;

  function toggleGroup(g: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  async function submit() {
    if (!cat) {
      alert("대분류를 선택하세요.");
      return;
    }
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
          user_id: currentUserId,
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
      if (rows.length > 0) {
        const { error: e2 } = await supabase.from("hazard_survey_items").insert(rows);
        if (e2) throw e2;
      }

      if (participants.length > 0) {
        const { error: e3 } = await supabase.from("hazard_survey_participants").insert(
          participants.map((p) => ({
            survey_id: sv.id,
            user_id: p.id,
            user_name: p.name ?? "",
            signature_url: null,
            signed_at: null,
          }))
        );
        if (e3) throw e3;

        // 참가자 알림 발송 (본인 제외, 실패해도 저장은 성공 처리)
        const notifyTargets = participants.filter((p) => p.id !== currentUserId);
        if (notifyTargets.length > 0) {
          const titleParts = [cat.doc_no, cat.name].filter(Boolean).join(" ");
          const sitePart = siteName.trim() ? ` · ${siteName.trim()}` : "";
          void (async () => {
            await Promise.all(
              notifyTargets.map((p) =>
                insertNotification({
                  userId: p.id,
                  type: "risk_participant",
                  title: "위험성평가 참가자로 지정되었습니다 — 서명이 필요합니다",
                  message: `[${titleParts}]${sitePart} / ${surveyDate}`,
                  link: "/safety/risk-assessment",
                  refType: "hazard_survey",
                  refId: sv.id,
                })
              )
            );
          })().catch((e) => console.warn("[notify] 위험성평가 참가자 알림 실패:", e));
        }
      }

      onCreated(sv.id);
    } catch (e: any) {
      alert("등록 실패: " + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex bg-black/50 ${isMobile ? "" : "items-center justify-center p-4"}`}
      onClick={onClose}
    >
      <div
        className={
          isMobile
            ? "bg-white dark:bg-gray-800 w-full h-full flex flex-col"
            : "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 w-full max-w-3xl max-h-[90vh] flex flex-col"
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 ${isMobile ? "sticky top-0 bg-white dark:bg-gray-800 z-10" : ""}`}>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">신규 위험성평가 등록</h3>
          {!isMobile && (
            <span className="text-xs text-gray-400">대분류·현장·평가자·항목 유/무 입력 → 저장 시 위험성평가표 작성으로 진입</span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className={`overflow-y-auto space-y-4 ${isMobile ? "flex-1 p-4" : "p-5"}`}>
          {/* 기본 정보 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">대분류 공정 <span className="text-red-500">*</span></span>
              <select
                className={modalInputCls}
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
              <input className={`${modalInputCls} bg-gray-50 dark:bg-gray-900/40`} value={cat?.sub_process ?? ""} readOnly />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">현장명</span>
              <input className={modalInputCls} value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="예) ○○빌딩" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">종류</span>
              <select className={modalInputCls} value={assessType} onChange={(e) => setAssessType(e.target.value)}>
                {ASSESS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">작성팀</span>
              <input className={modalInputCls} value={team} onChange={(e) => setTeam(e.target.value)} placeholder="예) 보수1팀" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">평가자</span>
              <input className={modalInputCls} value={assessor} onChange={(e) => setAssessor(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">작성일 <span className="text-red-500">*</span></span>
              <input type="date" className={modalInputCls} value={surveyDate} onChange={(e) => setSurveyDate(e.target.value)} />
            </label>
          </div>

          {/* 평가 참가자 */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">👷 평가 참가자 ({participants.length}명)</span>
              <button
                type="button"
                onClick={() => setShowAddParticipantsModal(true)}
                className="px-2.5 py-1 rounded text-[11px] font-bold bg-rose-600 text-white hover:bg-rose-700"
              >
                + 참가자 추가
              </button>
              <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-auto">
                등록 후 지정된 참가자에게 서명 요청 알림이 발송됩니다.
              </span>
            </div>
            <div className="p-4">
              {participants.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400">
                  아직 참가자가 없습니다. <b>+ 참가자 추가</b> 버튼으로 여러 명을 한 번에 지정할 수 있습니다.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {participants.map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-[11px] font-semibold border border-rose-200 dark:border-rose-800"
                    >
                      {p.name}
                      {p.dept && <span className="text-[10px] text-rose-500/70 dark:text-rose-400/70">· {p.dept}</span>}
                      <button
                        type="button"
                        onClick={() => setParticipants((prev) => prev.filter((x) => x.id !== p.id))}
                        className="ml-1 hover:text-red-600"
                        aria-label="참가자 제거"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 항목 유/무 */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">유해·위험요인 유/무</span>
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
              <div className="p-6 text-center text-xs text-gray-400">선택된 대분류에 등록된 유해요인 항목이 없습니다.</div>
            ) : (
              <div className="max-h-[40vh] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/60">
                {groups.map((g, gi) => {
                  const open = expandedGroups.has(g.gubun);
                  const groupYes = g.items.filter((it) => present[it.id]).length;
                  return (
                    <div key={gi}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(g.gubun)}
                        className="w-full flex items-center gap-2 px-4 py-2 sticky top-0 z-10 bg-gray-100 dark:bg-gray-900 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                      >
                        <span className={`text-blue-400 text-xs transition-transform duration-200 ${open ? "rotate-0" : "-rotate-90"}`}>▾</span>
                        <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{g.gubun || "(구분 미지정)"}</span>
                        <span className="text-[11px] text-gray-400">({g.items.length})</span>
                        <span className="ml-auto text-[11px] font-semibold text-rose-600 dark:text-rose-400">유 {groupYes}</span>
                      </button>
                      {open &&
                        g.items.map((it) => {
                          const on = !!present[it.id];
                          return (
                            <div key={it.id} className="px-4 py-2.5 flex items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-900 dark:text-gray-100">{it.hazard}</p>
                                {it.accident_type && (
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">재해형태: {it.accident_type}</p>
                                )}
                              </div>
                              <div className="flex gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setPresent((p) => ({ ...p, [it.id]: true }))}
                                  className={`min-w-[40px] px-2.5 py-1.5 rounded text-xs font-bold transition-colors ${
                                    on
                                      ? "bg-rose-600 text-white"
                                      : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-rose-100 dark:hover:bg-rose-900/30"
                                  }`}
                                >
                                  유
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPresent((p) => ({ ...p, [it.id]: false }))}
                                  className={`min-w-[40px] px-2.5 py-1.5 rounded text-xs font-bold transition-colors ${
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
          </div>
        </div>

        <div className={`border-t border-gray-200 dark:border-gray-700 flex gap-2 ${isMobile ? "sticky bottom-0 bg-white dark:bg-gray-800 p-3" : "px-5 py-3 justify-end"}`}>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold hover:bg-gray-200 ${isMobile ? "flex-1 py-3 text-sm" : "px-4 py-2 text-xs"}`}
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !catId || items.length === 0}
            className={`rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:opacity-50 ${isMobile ? "flex-[2] py-3 text-sm" : "px-4 py-2 text-xs"}`}
          >
            {saving ? "등록 중…" : "등록 후 평가표 작성"}
          </button>
        </div>
      </div>

      {showAddParticipantsModal && (
        <AddParticipantsModal
          users={users}
          existing={participants}
          onClose={() => setShowAddParticipantsModal(false)}
          onAdd={(list) => {
            setParticipants((prev) => {
              const existingIds = new Set(prev.map((p) => p.id));
              const additions = list.filter((u) => !existingIds.has(u.id));
              return [...prev, ...additions];
            });
            setShowAddParticipantsModal(false);
          }}
        />
      )}
    </div>
  );
}

// 참가자 다중 선택 모달 — 이름·부서 검색 + 체크박스 다중 선택 → 일괄 추가
function AddParticipantsModal({
  users,
  existing,
  onClose,
  onAdd,
}: {
  users: UserMini[];
  existing: UserMini[];
  onClose: () => void;
  onAdd: (list: UserMini[]) => void;
}) {
  const { viewMode } = useViewMode();
  const isMobile = viewMode === "mobile";
  const [kw, setKw] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const existingIds = new Set(existing.map((p) => p.id));
  const kwLc = kw.trim().toLowerCase();
  const filtered = users
    .filter((u) => !existingIds.has(u.id))
    .filter((u) =>
      kwLc ? (u.name ?? "").toLowerCase().includes(kwLc) || (u.dept ?? "").toLowerCase().includes(kwLc) : true
    );

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((u) => u.id)));
  }

  function confirm() {
    if (selected.size === 0) {
      alert("추가할 참가자를 1명 이상 선택하세요.");
      return;
    }
    const list = users.filter((u) => selected.has(u.id));
    onAdd(list);
  }

  return (
    <div
      className={`fixed inset-0 z-[60] flex bg-black/60 ${isMobile ? "" : "items-center justify-center p-4"}`}
      onClick={onClose}
    >
      <div
        className={
          isMobile
            ? "bg-white dark:bg-gray-800 w-full h-full flex flex-col"
            : "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 w-full max-w-md flex flex-col max-h-[85vh]"
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 ${isMobile ? "sticky top-0 bg-white dark:bg-gray-800 z-10" : ""}`}>
          <h4 className="text-sm font-bold text-gray-900 dark:text-white">참가자 추가</h4>
          <span className="text-[11px] text-gray-400">{selected.size}명 선택</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-3 border-b border-gray-100 dark:border-gray-700/60 space-y-2">
          <input
            type="text"
            lang="ko"
            autoComplete="off"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="이름 또는 부서 검색"
            className={modalInputCls + " w-full"}
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleAll}
              disabled={filtered.length === 0}
              className="text-[11px] font-semibold px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 disabled:opacity-40"
            >
              {selected.size === filtered.length && filtered.length > 0 ? "전체 해제" : "전체 선택"}
            </button>
            <span className="text-[11px] text-gray-400">검색결과 {filtered.length}명</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/60">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400">
              {kw ? "일치하는 사원이 없습니다." : "추가 가능한 사원이 없습니다. (이미 모두 등록됨)"}
            </div>
          ) : (
            filtered.map((u) => {
              const on = selected.has(u.id);
              return (
                <label
                  key={u.id}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                    on ? "bg-rose-50 dark:bg-rose-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-700/40"
                  }`}
                >
                  <input type="checkbox" checked={on} onChange={() => toggle(u.id)} className="accent-rose-600" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{u.name ?? "-"}</div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{u.dept ?? "-"}</div>
                  </div>
                </label>
              );
            })
          )}
        </div>

        <div className={`border-t border-gray-200 dark:border-gray-700 flex gap-2 ${isMobile ? "sticky bottom-0 bg-white dark:bg-gray-800 p-3" : "px-5 py-3 justify-end"}`}>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold hover:bg-gray-200 ${isMobile ? "flex-1 py-3 text-sm" : "px-4 py-2 text-xs"}`}
          >
            취소
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={selected.size === 0}
            className={`rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:opacity-50 ${isMobile ? "flex-[2] py-3 text-sm" : "px-4 py-2 text-xs"}`}
          >
            {selected.size > 0 ? `${selected.size}명 추가` : "추가"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 서명 팝업 — 참가자별 서명 캔버스. 확정 시 dataURL을 상위로 전달.
function SignatureModal({
  participant,
  onClose,
  onSigned,
}: {
  participant: ParticipantDraft;
  onClose: () => void;
  onSigned: (dataUrl: string) => void;
}) {
  const { viewMode } = useViewMode();
  const isMobile = viewMode === "mobile";
  const padRef = useRef<SignaturePadHandle>(null);

  function confirm() {
    if (padRef.current?.isEmpty()) {
      alert("서명을 먼저 그려주세요.");
      return;
    }
    const dataUrl = padRef.current?.getDataURL();
    if (!dataUrl) return;
    onSigned(dataUrl);
  }

  return (
    <div
      className={`fixed inset-0 z-[60] flex bg-black/60 ${isMobile ? "items-end" : "items-center justify-center p-4"}`}
      onClick={onClose}
    >
      <div
        className={
          isMobile
            ? "bg-white dark:bg-gray-800 rounded-t-xl w-full"
            : "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 w-full max-w-md"
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <h4 className="text-sm font-bold text-gray-900 dark:text-white">✍️ {participant.name} 서명</h4>
          <span className="text-[11px] text-gray-400">{participant.dept ?? ""}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-4">
          <SignaturePad ref={padRef} />
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
            빈 영역에 손가락·마우스로 서명한 후 확인을 눌러주세요.
          </p>
        </div>
        <div className={`border-t border-gray-200 dark:border-gray-700 flex gap-2 ${isMobile ? "p-3" : "px-5 py-3 justify-end"}`}>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold hover:bg-gray-200 ${isMobile ? "flex-1 py-3 text-sm" : "px-4 py-2 text-xs"}`}
          >
            취소
          </button>
          <button
            type="button"
            onClick={confirm}
            className={`rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 ${isMobile ? "flex-[2] py-3 text-sm" : "px-4 py-2 text-xs"}`}
          >
            서명 확정
          </button>
        </div>
      </div>
    </div>
  );
}
