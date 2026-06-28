"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { useAuth, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import { ASSESS_TYPES, type RiskCategory, type HazardSurvey, type HazardSurveyItem } from "@/lib/risk";

const HREF = "/safety/hazard-register";

const inputCls =
  "px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-rose-400";

type Row = HazardSurvey & {
  _cat?: string;
  _doc?: string;
  _sub?: string;
  _author?: string;
  _total?: number;
  _yes?: number;
};

export default function HazardRegisterClient() {
  const { user } = useAuth();

  const [categories, setCategories] = useState<RiskCategory[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  // 필터
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
      .select("*, risk_categories(name, doc_no, sub_process), accounts(name), hazard_survey_items(present)")
      .order("id", { ascending: false })
      .limit(500);
    if (fCat !== "all") q = q.eq("category_id", fCat);
    if (fType !== "all") q = q.eq("assess_type", fType);
    if (fFrom) q = q.gte("survey_date", fFrom);
    if (fTo) q = q.lte("survey_date", fTo);
    const { data } = await q;
    const list = (data ?? []).map((r: any) => ({
      ...r,
      _cat: r.risk_categories?.name,
      _doc: r.risk_categories?.doc_no,
      _sub: r.risk_categories?.sub_process,
      _author: r.accounts?.name,
      _total: (r.hazard_survey_items ?? []).length,
      _yes: (r.hazard_survey_items ?? []).filter((i: any) => i.present).length,
    })) as Row[];
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
  const canDelete = hasMenuPermission(user, HREF, "update");

  const kwLc = kw.trim().toLowerCase();
  const view = kwLc
    ? rows.filter(
        (r) =>
          (r.site_name ?? "").toLowerCase().includes(kwLc) ||
          (r.assessor ?? "").toLowerCase().includes(kwLc) ||
          (r._author ?? "").toLowerCase().includes(kwLc) ||
          (r._cat ?? "").toLowerCase().includes(kwLc)
      )
    : rows;

  async function del(r: Row) {
    if (!confirm(`[${r._doc}] ${r._cat} / ${r.survey_date} 조사를 삭제할까요?\n(평가 내역도 함께 삭제됩니다)`)) return;
    const { error } = await supabase.from("hazard_surveys").delete().eq("id", r.id);
    if (error) return alert("삭제 실패: " + error.message);
    void load();
  }

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">유해요인조사대장</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          유해요인조사표에서 제출된 조사 내역을 조회·상세보기·인쇄·삭제로 관리합니다.
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
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">검색(현장·평가자·작성자)</span>
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
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">조사 내역</span>
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
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-20">작성팀</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-20">평가자</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-24">작성일</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-20">유/전체</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-16">상태</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-24">관리</th>
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
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center">{r.team ?? "-"}</td>
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center">{r.assessor ?? r._author ?? "-"}</td>
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center whitespace-nowrap">{r.survey_date}</td>
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center">
                      <span className="text-rose-600 dark:text-rose-400 font-bold">{r._yes}</span>
                      <span className="text-gray-400"> / {r._total}</span>
                    </td>
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          r.status === "assessed"
                            ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                            : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                        }`}
                      >
                        {r.status === "assessed" ? "평가완료" : "제출"}
                      </span>
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
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => del(r)}
                            className="px-1.5 py-0.5 text-[11px] rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                          >
                            삭제
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {view.length === 0 && !loading && (
                  <tr>
                    <td colSpan={10} className="border border-gray-200 dark:border-gray-700 px-2 py-10 text-center text-gray-400">
                      조사 내역이 없습니다.
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

// 상세 모달 — 조사 항목 전체(구분별 유/무)
function DetailModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const [items, setItems] = useState<HazardSurveyItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("hazard_survey_items")
        .select("*")
        .eq("survey_id", row.id)
        .order("sort_order");
      setItems((data ?? []) as HazardSurveyItem[]);
      setLoading(false);
    })();
  }, [row.id]);

  // 구분별 그룹
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
        className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 w-full max-w-3xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">유해요인조사표 상세</h3>
          <span className="text-xs font-mono text-gray-400">{row._doc}</span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => printSurveySheet(row, items)}
              className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold hover:bg-gray-200"
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

        <div className="overflow-y-auto p-4">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">불러오는 중…</div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-300">
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-left">안전보건 유해·위험요인</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-16">재해형태</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-12">평가</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, gi) => (
                  <Fragment key={gi}>
                    <tr className="bg-blue-50/60 dark:bg-blue-900/20">
                      <td colSpan={3} className="border border-gray-200 dark:border-gray-700 px-2 py-1.5">
                        <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{g.gubun || "(구분 미지정)"}</span>
                        <span className="text-[11px] text-gray-400"> ({g.items.length})</span>
                      </td>
                    </tr>
                    {g.items.map((it) => (
                      <tr key={it.id} className="text-gray-800 dark:text-gray-100">
                        <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 pl-6">{it.hazard}</td>
                        <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center whitespace-nowrap">{it.accident_type || "-"}</td>
                        <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center">
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                              it.present
                                ? "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300"
                                : "bg-gray-100 dark:bg-gray-700 text-gray-400"
                            }`}
                          >
                            {it.present ? "유" : "무"}
                          </span>
                        </td>
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

// 유해요인조사표 인쇄(새 창)
function printSurveySheet(row: Row, items: HazardSurveyItem[]) {
  const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = items
    .map(
      (it) => `<tr>
      <td>${esc(it.gubun)}</td>
      <td class="l">${esc(it.hazard)}</td>
      <td>${esc(it.accident_type)}</td>
      <td class="c">${it.present ? "●" : ""}</td>
      <td class="c">${it.present ? "" : "●"}</td>
    </tr>`
    )
    .join("");

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>유해요인조사표 ${esc(row._doc)}</title>
  <style>
    *{box-sizing:border-box;font-family:'Malgun Gothic','맑은 고딕',sans-serif;}
    body{margin:16px;color:#111;}
    h1{font-size:20px;text-align:center;margin:0 0 8px;letter-spacing:6px;}
    .meta{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:6px;}
    .meta td{border:1px solid #333;padding:4px 8px;}
    .meta .h{background:#f0f0f0;font-weight:bold;width:90px;}
    table.grid{width:100%;border-collapse:collapse;font-size:11px;}
    table.grid th,table.grid td{border:1px solid #333;padding:4px 6px;text-align:center;vertical-align:top;}
    table.grid th{background:#f0f0f0;}
    .l{text-align:left;}
    .c{text-align:center;font-weight:bold;}
    @media print{body{margin:8mm;}}
  </style></head><body>
  <h1>안전보건 유해·위험요인 조사표</h1>
  <table class="meta">
    <tr><td class="h">문서번호</td><td>${esc(row._doc)}</td><td class="h">종류</td><td>${esc(row.assess_type)}</td></tr>
    <tr><td class="h">대분류 공정</td><td>${esc(row._cat)}</td><td class="h">현장명</td><td>${esc(row.site_name)}</td></tr>
    <tr><td class="h">중분류 공정</td><td>${esc(row._sub)}</td><td class="h">작성팀</td><td>${esc(row.team)}</td></tr>
    <tr><td class="h">평가자</td><td>${esc(row.assessor)}</td><td class="h">작성일</td><td>${esc(row.survey_date)}</td></tr>
  </table>
  <table class="grid">
    <thead><tr>
      <th style="width:16%">구분</th><th>안전보건 유해·위험요인</th><th style="width:8%">재해형태</th>
      <th style="width:6%">유</th><th style="width:6%">무</th>
    </tr></thead>
    <tbody>${body || '<tr><td colspan="5">항목 없음</td></tr>'}</tbody>
  </table>
  <script>window.onload=function(){window.print();}</script>
  </body></html>`;

  const w = window.open("", "_blank", "width=1000,height=800");
  if (!w) {
    alert("팝업이 차단되었습니다. 인쇄를 위해 팝업을 허용해주세요.");
    return;
  }
  w.document.write(html);
  w.document.close();
}
