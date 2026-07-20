"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import { insertNotification } from "@/lib/notify";
import {
  ASSESS_TYPES,
  type RiskCategory,
  type RiskHazardItem,
  type HazardSurvey,
} from "@/lib/risk";
import SignaturePad, { type SignaturePadHandle } from "@/components/tbm/SignaturePad";

const HREF = "/safety/risk-assessment";

const SIGN_BUCKET = "tbm-photos";
const SIGN_PATH_PREFIX = "risk";

const inputCls =
  "w-full px-3 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-rose-400 placeholder:text-gray-400 dark:placeholder:text-gray-500";
const labelCls = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5";
const sectionCls = "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4";

interface UserMini {
  id: number;
  name: string | null;
  dept: string | null;
}

function todayStr() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

type Tab = "write" | "sign";

export default function RiskAssessmentMobileClient() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("write");

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  if (!hasMenuPermission(user, HREF, "read")) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
      </div>
    );
  }
  const canWrite = hasMenuPermission(user, HREF, "create") || hasMenuPermission(user, HREF, "update");

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      {/* 헤더 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-gray-900 dark:text-white">위험성평가 등록</h1>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {user.name} · {user.dept ?? "-"}
            </p>
          </div>
        </div>
      </div>

      {/* 서브 탭 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sticky top-[57px] z-10">
        <div className="max-w-2xl mx-auto flex gap-1">
          <SubTabButton active={tab === "write"} onClick={() => setTab("write")}>
            ✍️ 등록
          </SubTabButton>
          <SubTabButton active={tab === "sign"} onClick={() => setTab("sign")}>
            🖊️ 내 서명 대기
          </SubTabButton>
        </div>
      </div>

      {/* 본문 */}
      <div className="max-w-2xl mx-auto p-4 pb-16">
        {tab === "write" && (
          <WriteTab
            canWrite={canWrite}
            currentUserId={user.id}
            currentUserName={user.name}
            onSubmitted={() => setTab("sign")}
          />
        )}
        {tab === "sign" && <MySignTab currentUserId={user.id} currentUserName={user.name} />}
      </div>
    </div>
  );
}

function SubTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
        active
          ? "border-rose-500 text-rose-600 dark:text-rose-400"
          : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

// ============================================================
// 등록 탭
// ============================================================
function WriteTab({
  canWrite,
  currentUserId,
  currentUserName,
  onSubmitted,
}: {
  canWrite: boolean;
  currentUserId: number;
  currentUserName: string;
  onSubmitted: () => void;
}) {
  const [categories, setCategories] = useState<RiskCategory[]>([]);
  const [catId, setCatId] = useState<number | null>(null);
  const [items, setItems] = useState<RiskHazardItem[]>([]);
  const [present, setPresent] = useState<Record<number, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const [siteName, setSiteName] = useState("");
  const [assessType, setAssessType] = useState<string>("정기");
  const [team, setTeam] = useState("");
  const [assessor, setAssessor] = useState(currentUserName);
  const [surveyDate, setSurveyDate] = useState(todayStr());

  const [users, setUsers] = useState<UserMini[]>([]);
  const [participants, setParticipants] = useState<UserMini[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const [cats, us] = await Promise.all([
        supabase.from("risk_categories").select("*").eq("active", true).order("sort_order"),
        supabase.from("accounts").select("id, name:username, dept").eq("status", "재직").order("username"),
      ]);
      const catList = (cats.data ?? []) as RiskCategory[];
      setCategories(catList);
      setCatId((prev) => prev ?? (catList[0]?.id ?? null));
      setUsers((us.data ?? []) as UserMini[]);
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

  const cat = categories.find((c) => c.id === catId) ?? null;
  const yesCount = items.filter((i) => present[i.id]).length;

  // 구분(중분류)별 그룹
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

  function resetForm() {
    setSiteName("");
    setTeam("");
    setParticipants([]);
    setSurveyDate(todayStr());
  }

  async function submit() {
    if (!cat) {
      setError("대분류를 선택하세요.");
      return;
    }
    if (!surveyDate) {
      setError("작성일을 입력하세요.");
      return;
    }
    setSaving(true);
    setError("");
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

        // 참가자 알림 발송 (본인 제외)
        const targets = participants.filter((p) => p.id !== currentUserId);
        if (targets.length > 0) {
          const titleParts = [cat.doc_no, cat.name].filter(Boolean).join(" ");
          const sitePart = siteName.trim() ? ` · ${siteName.trim()}` : "";
          void (async () => {
            await Promise.all(
              targets.map((p) =>
                insertNotification({
                  userId: p.id,
                  type: "risk_participant",
                  title: "위험성평가 참가자로 지정되었습니다 — 서명이 필요합니다",
                  message: `[${titleParts}]${sitePart} / ${surveyDate}`,
                  link: "/safety/risk-assessment/mobile",
                  refType: "hazard_survey",
                  refId: sv.id,
                })
              )
            );
          })().catch((e) => console.warn("[notify] 위험성평가 참가자 알림 실패:", e));
        }
      }

      alert(`제출되었습니다. (유해요인 '유' ${rows.filter((r) => r.present).length}건, 참가자 ${participants.length}명)`);
      resetForm();
      onSubmitted();
    } catch (e: any) {
      setError("등록 실패: " + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* 기본 정보 */}
      <div className={sectionCls}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label>
            <span className={labelCls}>대분류 공정 <span className="text-red-500">*</span></span>
            <select className={inputCls} value={catId ?? ""} onChange={(e) => setCatId(Number(e.target.value))}>
              {categories.length === 0 && <option value="">(등록된 대분류 없음)</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  [{c.doc_no}] {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelCls}>중분류 공정</span>
            <input className={`${inputCls} bg-gray-50 dark:bg-gray-900/40`} value={cat?.sub_process ?? ""} readOnly />
          </label>
          <label>
            <span className={labelCls}>현장명</span>
            <input className={inputCls} value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="예) ○○빌딩" />
          </label>
          <label>
            <span className={labelCls}>종류</span>
            <select className={inputCls} value={assessType} onChange={(e) => setAssessType(e.target.value)}>
              {ASSESS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelCls}>작성팀</span>
            <input className={inputCls} value={team} onChange={(e) => setTeam(e.target.value)} placeholder="예) 보수1팀" />
          </label>
          <label>
            <span className={labelCls}>평가자</span>
            <input className={inputCls} value={assessor} onChange={(e) => setAssessor(e.target.value)} />
          </label>
          <label>
            <span className={labelCls}>작성일 <span className="text-red-500">*</span></span>
            <input type="date" className={inputCls} value={surveyDate} onChange={(e) => setSurveyDate(e.target.value)} />
          </label>
        </div>
      </div>

      {/* 평가 참가자 */}
      <div className={sectionCls}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">👷 평가 참가자 ({participants.length}명)</span>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 text-white hover:bg-rose-700"
          >
            + 참가자 추가
          </button>
        </div>
        {participants.length === 0 ? (
          <div className="py-4 text-center text-xs text-gray-400">등록 후 지정한 참가자에게 서명 요청 알림이 발송됩니다.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {participants.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-xs font-semibold border border-rose-200 dark:border-rose-800"
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

      {/* 항목 유/무 */}
      <div className={sectionCls + " overflow-hidden"}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">유해·위험요인 유/무</span>
          <div className="flex items-center gap-2">
            {groups.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setExpandedGroups((prev) => (prev.size === groups.length ? new Set() : new Set(groups.map((g) => g.gubun))))
                }
                className="text-[11px] font-semibold px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
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
          <div className="py-8 text-center text-xs text-gray-400">선택된 대분류에 등록된 유해요인 항목이 없습니다.</div>
        ) : (
          <div className="max-h-[55vh] -mx-4 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/60">
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
                  {open &&
                    g.items.map((it) => {
                      const on = !!present[it.id];
                      return (
                        <div key={it.id} className="px-4 py-3 flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-900 dark:text-gray-100">{it.hazard}</p>
                            {it.accident_type && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">재해형태: {it.accident_type}</p>
                            )}
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
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 text-xs px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      <button
        type="button"
        disabled={!canWrite || saving || items.length === 0 || !catId}
        onClick={submit}
        className="w-full py-3.5 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-50 sticky bottom-2"
      >
        {saving ? "제출 중…" : "위험성평가 제출"}
      </button>

      {showAdd && (
        <AddParticipantsModal
          users={users}
          existing={participants}
          onClose={() => setShowAdd(false)}
          onAdd={(list) => {
            setParticipants((prev) => {
              const existingIds = new Set(prev.map((p) => p.id));
              return [...prev, ...list.filter((u) => !existingIds.has(u.id))];
            });
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// 내 서명 대기 탭 — 내가 참가자로 지정된 조사 리스트
// ============================================================
type SignRow = HazardSurvey & {
  _cat?: string;
  _doc?: string;
  _mySigned?: boolean;
  _signedAt?: string | null;
};

function MySignTab({ currentUserId, currentUserName }: { currentUserId: number; currentUserName: string }) {
  const [rows, setRows] = useState<SignRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [signingId, setSigningId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("hazard_survey_participants")
      .select("survey_id, signature_url, signed_at, hazard_surveys(*, risk_categories(name, doc_no))")
      .eq("user_id", currentUserId)
      .order("survey_id", { ascending: false })
      .limit(200);
    const list: SignRow[] = (data ?? []).map((r: any) => {
      const s = r.hazard_surveys ?? {};
      return {
        ...s,
        _cat: s.risk_categories?.name,
        _doc: s.risk_categories?.doc_no,
        _mySigned: !!r.signature_url,
        _signedAt: r.signed_at,
      };
    });
    // 미서명 우선 → 서명 완료
    list.sort((a, b) => {
      if (a._mySigned !== b._mySigned) return a._mySigned ? 1 : -1;
      return (b.id ?? 0) - (a.id ?? 0);
    });
    setRows(list);
    setLoading(false);
  }, [currentUserId]);

  useEffect(() => {
    void load();
  }, [load]);
  useReloadOnActivate(() => void load());

  async function uploadSig(dataUrl: string): Promise<string> {
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${SIGN_PATH_PREFIX}/${currentUserId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const { error } = await supabase.storage.from(SIGN_BUCKET).upload(path, blob, {
      cacheControl: "3600",
      upsert: false,
      contentType: "image/png",
    });
    if (error) throw error;
    const { data } = supabase.storage.from(SIGN_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function saveSig(surveyId: number, dataUrl: string) {
    try {
      const url = await uploadSig(dataUrl);
      const { error } = await supabase
        .from("hazard_survey_participants")
        .update({ signature_url: url, signed_at: new Date().toISOString() })
        .eq("survey_id", surveyId)
        .eq("user_id", currentUserId);
      if (error) throw error;
      setSigningId(null);
      void load();
    } catch (e: any) {
      alert("서명 저장 실패: " + (e?.message ?? e));
    }
  }

  const unsigned = rows.filter((r) => !r._mySigned).length;

  return (
    <div className="space-y-3">
      <div className={sectionCls + " flex items-center gap-3"}>
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">서명 대기</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-bold">
          {unsigned}건
        </span>
        <span className="ml-auto text-[11px] text-gray-400">
          총 {rows.length}건
          {loading && " · 로딩 중…"}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className={sectionCls + " text-center text-sm text-gray-400 py-10"}>
          {loading ? "불러오는 중…" : "내가 참가자로 지정된 조사가 없습니다."}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className={sectionCls + " space-y-2"}>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-gray-400">{r._doc}</span>
                {r.assess_type && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">
                    {r.assess_type}
                  </span>
                )}
                <span className="flex-1 text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{r._cat}</span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    r._mySigned
                      ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                      : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                  }`}
                >
                  {r._mySigned ? "✔ 서명완료" : "미서명"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                {r.site_name && <span>📍 {r.site_name}</span>}
                <span>{r.survey_date}</span>
                <span>· 작성자 {r.assessor ?? "-"}</span>
              </div>
              <button
                type="button"
                onClick={() => setSigningId(r.id)}
                className={`w-full py-2.5 rounded-lg text-sm font-bold ${
                  r._mySigned ? "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-200" : "bg-rose-600 text-white hover:bg-rose-700"
                }`}
              >
                {r._mySigned ? "재서명" : "✍️ 서명하기"}
              </button>
            </div>
          ))}
        </div>
      )}

      {signingId != null && (
        <SignaturePopup
          userName={currentUserName}
          onClose={() => setSigningId(null)}
          onSigned={(dataUrl) => void saveSig(signingId, dataUrl)}
        />
      )}
    </div>
  );
}

// ============================================================
// 참가자 다중 선택 모달 (모바일 최적화, 풀스크린)
// ============================================================
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

  function confirm() {
    if (selected.size === 0) {
      alert("추가할 참가자를 1명 이상 선택하세요.");
      return;
    }
    onAdd(users.filter((u) => selected.has(u.id)));
  }

  return (
    <div className="fixed inset-0 z-[60] bg-white dark:bg-gray-900 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 sticky top-0 bg-white dark:bg-gray-900 z-10">
        <h4 className="text-base font-bold text-gray-900 dark:text-white">참가자 추가</h4>
        <span className="text-xs text-gray-400">{selected.size}명 선택</span>
        <button type="button" onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-2xl leading-none">
          ×
        </button>
      </div>

      <div className="p-3 border-b border-gray-100 dark:border-gray-700/60">
        <input
          type="text"
          lang="ko"
          autoComplete="off"
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="이름 또는 부서 검색"
          className={inputCls}
        />
        <div className="flex items-center justify-between mt-2">
          <button
            type="button"
            onClick={() => (selected.size === filtered.length ? setSelected(new Set()) : setSelected(new Set(filtered.map((u) => u.id))))}
            disabled={filtered.length === 0}
            className="text-xs font-semibold px-2.5 py-1.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-40"
          >
            {selected.size === filtered.length && filtered.length > 0 ? "전체 해제" : "전체 선택"}
          </button>
          <span className="text-xs text-gray-400">검색결과 {filtered.length}명</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/60">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-xs text-gray-400">
            {kw ? "일치하는 사원이 없습니다." : "추가 가능한 사원이 없습니다."}
          </div>
        ) : (
          filtered.map((u) => {
            const on = selected.has(u.id);
            return (
              <label
                key={u.id}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${
                  on ? "bg-rose-50 dark:bg-rose-900/20" : ""
                }`}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(u.id)} className="w-5 h-5 accent-rose-600" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{u.name ?? "-"}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{u.dept ?? "-"}</div>
                </div>
              </label>
            );
          })
        )}
      </div>

      <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex gap-2 sticky bottom-0 bg-white dark:bg-gray-900">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-3 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold"
        >
          취소
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={selected.size === 0}
          className="flex-[2] py-3 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-50"
        >
          {selected.size > 0 ? `${selected.size}명 추가` : "추가"}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 서명 팝업 (모바일 최적화)
// ============================================================
function SignaturePopup({
  userName,
  onClose,
  onSigned,
}: {
  userName: string;
  onClose: () => void;
  onSigned: (dataUrl: string) => void;
}) {
  const padRef = useRef<SignaturePadHandle>(null);

  function confirm() {
    if (padRef.current?.isEmpty()) {
      alert("서명을 먼저 그려주세요.");
      return;
    }
    const dataUrl = padRef.current?.getDataURL();
    if (dataUrl) onSigned(dataUrl);
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center p-2" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-t-xl sm:rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <h4 className="text-sm font-bold text-gray-900 dark:text-white">✍️ {userName} 서명</h4>
          <button type="button" onClick={onClose} className="ml-auto text-gray-400 text-2xl leading-none">
            ×
          </button>
        </div>
        <div className="p-4">
          <SignaturePad ref={padRef} />
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">빈 영역에 손가락·펜으로 서명한 후 확인을 눌러주세요.</p>
        </div>
        <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold">
            취소
          </button>
          <button type="button" onClick={confirm} className="flex-[2] py-2.5 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-700">
            서명 확정
          </button>
        </div>
      </div>
    </div>
  );
}
