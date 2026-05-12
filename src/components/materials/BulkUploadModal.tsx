"use client";

import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { api, getErrorMessage } from "@/lib/api-client";
import { CategoryStore } from "@/lib/mock-categories";

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

const TEMPLATE_HEADERS = [
  "자재구분",
  "자재코드",
  "부품명",
  "별칭",
  "규격",
  "단위",
  "대분류코드",
  "중분류코드",
  "소분류코드",
  "수리품",
  "구매단가",
  "판매단가",
  "보관장소",
  "초기재고",
] as const;

const UNITS = ["EA", "ST", "M", "BOX", "SET"];

interface RawRow {
  자재구분?: string;
  자재코드?: string;
  부품명?: string;
  별칭?: string;
  규격?: string;
  단위?: string;
  대분류코드?: string;
  중분류코드?: string;
  소분류코드?: string;
  수리품?: string;
  구매단가?: string | number;
  판매단가?: string | number;
  보관장소?: string;
  초기재고?: string | number;
}

interface ParsedRow {
  rowNo: number; // 1-base, 헤더 제외한 실제 데이터 행
  raw: RawRow;
  isDs: boolean;
  directId: string;
  name: string;
  alias: string;
  modelNo: string;
  unit: string;
  major: string;
  mid: string;
  sub: string;
  isRepair: boolean;
  buyPrice: string;
  sellPrice: string;
  storageLoc: string;
  stockQty: number;
  errors: string[];
  status: "pending" | "ok" | "fail";
  message?: string;
}

function pad2(v: string | number | undefined): string {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (!/^\d{1,2}$/.test(s)) return s; // 비숫자는 그대로 반환 — 검증 단계에서 에러 처리
  return s.padStart(2, "0");
}

function asString(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function asNumberOrEmpty(v: unknown): string {
  if (v == null || v === "") return "";
  const s = String(v).replace(/,/g, "").trim();
  if (s === "") return "";
  if (!Number.isFinite(Number(s))) return s; // 검증에서 처리
  return s;
}

function downloadTemplate(cats: CategoryStore | null) {
  const sample: Record<string, string | number> = {
    자재구분: "DS",
    자재코드: "",
    부품명: "예시 부품",
    별칭: "",
    규격: "DC-200A",
    단위: "EA",
    대분류코드: "01",
    중분류코드: "01",
    소분류코드: "01",
    수리품: "N",
    구매단가: 0,
    판매단가: 0,
    보관장소: "A-01",
    초기재고: 0,
  };
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([sample], { header: [...TEMPLATE_HEADERS] });
  XLSX.utils.book_append_sheet(wb, ws, "자재등록양식");

  // 분류코드표 시트 — 사용자가 코드를 찾아 입력할 수 있도록 전체 분류 펼침
  if (cats) {
    const catRows: Record<string, string>[] = [];
    cats.major.forEach(M => {
      const midList = cats.mid[M.code] ?? [];
      if (midList.length === 0) {
        catRows.push({ 대분류코드: M.code, 대분류명: M.label, 중분류코드: "", 중분류명: "", 소분류코드: "", 소분류명: "" });
        return;
      }
      midList.forEach(Mi => {
        const subList = cats.sub[`${M.code}${Mi.code}`] ?? [];
        if (subList.length === 0) {
          catRows.push({ 대분류코드: M.code, 대분류명: M.label, 중분류코드: Mi.code, 중분류명: Mi.label, 소분류코드: "", 소분류명: "" });
          return;
        }
        subList.forEach(S => {
          catRows.push({ 대분류코드: M.code, 대분류명: M.label, 중분류코드: Mi.code, 중분류명: Mi.label, 소분류코드: S.code, 소분류명: S.label });
        });
      });
    });
    const wsCats = XLSX.utils.json_to_sheet(catRows, {
      header: ["대분류코드", "대분류명", "중분류코드", "중분류명", "소분류코드", "소분류명"],
    });
    XLSX.utils.book_append_sheet(wb, wsCats, "분류코드표");
  }

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "자재일괄등록_양식.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

export default function BulkUploadModal({ onClose, onSaved }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [cats, setCats] = useState<CategoryStore | null>(null);
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [c, m] = await Promise.all([
          api.get<CategoryStore>("/api/categories"),
          api.get<{ id: string }[]>("/api/materials"),
        ]);
        setCats(c);
        setExistingIds(new Set(m.map(x => x.id)));
      } catch (e) {
        alert(getErrorMessage(e));
      }
    })();
  }, []);

  function validateRow(p: ParsedRow, idsInBatch: Set<string>) {
    const errs: string[] = [];
    if (!p.raw.자재구분 || (p.raw.자재구분 !== "DS" && p.raw.자재구분 !== "TK")) {
      errs.push("자재구분은 DS 또는 TK");
    }
    if (!p.name) errs.push("부품명 필수");
    if (!p.major || !p.mid || !p.sub) errs.push("분류코드 필수");
    else if (cats) {
      const midList = cats.mid[p.major];
      const subList = cats.sub[`${p.major}${p.mid}`];
      if (!cats.major.some(x => x.code === p.major)) errs.push(`대분류 ${p.major} 없음`);
      else if (!midList?.some(x => x.code === p.mid)) errs.push(`중분류 ${p.mid} 없음`);
      else if (!subList?.some(x => x.code === p.sub)) errs.push(`소분류 ${p.sub} 없음`);
    }
    if (p.unit && !UNITS.includes(p.unit)) errs.push(`단위는 ${UNITS.join("/")} 중 하나`);
    if (p.raw.수리품 && !["Y", "N", ""].includes(String(p.raw.수리품).trim().toUpperCase())) {
      errs.push("수리품은 Y/N");
    }
    if (p.buyPrice !== "" && !Number.isFinite(Number(p.buyPrice))) errs.push("구매단가 숫자");
    if (p.sellPrice !== "" && !Number.isFinite(Number(p.sellPrice))) errs.push("판매단가 숫자");
    if (!Number.isFinite(p.stockQty) || p.stockQty < 0) errs.push("초기재고 0 이상 숫자");

    // 자재코드 직접 입력 시 규칙
    if (p.directId) {
      if (p.isDs && !p.directId.startsWith("D")) errs.push("DS 코드는 D로 시작");
      if (existingIds.has(p.directId)) errs.push("이미 존재하는 자재코드");
      else if (idsInBatch.has(p.directId)) errs.push("엑셀 내 중복 자재코드");
      else idsInBatch.add(p.directId);
    } else {
      // TK는 자동 채번 불가
      if (!p.isDs && p.raw.자재구분 === "TK") errs.push("TK는 자재코드 직접 입력 필수");
    }

    p.errors = errs;
  }

  async function handleFile(file: File) {
    setDone(false);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: "" });

    const idsInBatch = new Set<string>();
    const parsed: ParsedRow[] = json.map((r, i) => {
      const isDs = asString(r.자재구분).toUpperCase() === "DS";
      const directId = asString(r.자재코드).toUpperCase();
      const repairFlag = asString(r.수리품).toUpperCase();
      const computedRepairFromId = directId
        ? (isDs ? directId.endsWith("R") : directId.startsWith("A"))
        : false;
      const row: ParsedRow = {
        rowNo: i + 1,
        raw: r,
        isDs,
        directId,
        name: asString(r.부품명),
        alias: asString(r.별칭),
        modelNo: asString(r.규격),
        unit: asString(r.단위) || "EA",
        major: pad2(r.대분류코드),
        mid: pad2(r.중분류코드),
        sub: pad2(r.소분류코드),
        isRepair: directId ? computedRepairFromId : repairFlag === "Y",
        buyPrice: asNumberOrEmpty(r.구매단가),
        sellPrice: asNumberOrEmpty(r.판매단가),
        storageLoc: asString(r.보관장소),
        stockQty: Number(asNumberOrEmpty(r.초기재고) || 0),
        errors: [],
        status: "pending",
      };
      validateRow(row, idsInBatch);
      return row;
    });

    setRows(parsed);
    setFileName(file.name);
    setProgress(0);
  }

  async function startUpload() {
    const targets = rows.filter(r => r.errors.length === 0);
    if (targets.length === 0) return;
    setUploading(true);
    setProgress(0);
    const updated = [...rows];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const idx = updated.findIndex(r => r.rowNo === t.rowNo);
      const payload = t.directId
        ? { directId: t.directId, major: t.major, mid: t.mid, sub: t.sub, isRepair: t.isRepair, name: t.name, alias: t.alias, modelNo: t.modelNo, unit: t.unit, buyPrice: t.buyPrice, sellPrice: t.sellPrice, storageLoc: t.storageLoc, stockQty: t.stockQty }
        : { isDs: t.isDs, major: t.major, mid: t.mid, sub: t.sub, isRepair: t.isRepair, name: t.name, alias: t.alias, modelNo: t.modelNo, unit: t.unit, buyPrice: t.buyPrice, sellPrice: t.sellPrice, storageLoc: t.storageLoc, stockQty: t.stockQty };
      try {
        await api.post("/api/materials", payload);
        updated[idx] = { ...updated[idx], status: "ok" };
      } catch (e) {
        updated[idx] = { ...updated[idx], status: "fail", message: getErrorMessage(e) };
      }
      setProgress(i + 1);
      setRows([...updated]);
    }
    setUploading(false);
    setDone(true);
  }

  const validCount = rows.filter(r => r.errors.length === 0).length;
  const errorCount = rows.length - validCount;
  const okCount = rows.filter(r => r.status === "ok").length;
  const failCount = rows.filter(r => r.status === "fail").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-[1400px] h-[92vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">자재 일괄 등록 (엑셀 업로드)</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">×</button>
        </div>

        {/* 상단 컨트롤 (고정) */}
        <div className="px-6 py-4 space-y-3 flex-shrink-0 border-b border-gray-100 dark:border-gray-700">
          <div className="rounded-lg bg-slate-50 dark:bg-slate-700/50 px-4 py-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="font-semibold text-slate-700 dark:text-slate-200">엑셀 양식</span>
              <button onClick={() => downloadTemplate(cats)} className="text-xs text-blue-600 hover:text-blue-800 underline">양식 다운로드</button>
            </div>
            <p>· 필수: 자재구분(DS/TK), 부품명, 대/중/소 분류코드 — DS는 자재코드 비우면 자동 채번, TK는 자재코드 필수</p>
            <p>· 수리품: Y/N (코드 직접 입력 시 자동 판정 — DS는 끝 R, TK는 첫 글자 A) · 분류코드는 양식 파일 [분류코드표] 시트 참고</p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              className="text-xs text-slate-600 dark:text-slate-300"
            />
            {fileName && <span className="text-xs text-slate-500">{fileName} — 총 {rows.length}행</span>}
            {rows.length > 0 && (
              <div className="flex items-center gap-2 text-xs ml-auto">
                <span className="px-2 py-1 rounded bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300">정상 {validCount}</span>
                {errorCount > 0 && (
                  <span className="px-2 py-1 rounded bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300">오류 {errorCount}</span>
                )}
                {done && (
                  <>
                    <span className="px-2 py-1 rounded bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">성공 {okCount}</span>
                    {failCount > 0 && (
                      <span className="px-2 py-1 rounded bg-orange-50 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">실패 {failCount}</span>
                    )}
                  </>
                )}
                {uploading && <span className="text-slate-500">진행 {progress} / {validCount}</span>}
              </div>
            )}
          </div>
        </div>

        {/* 미리보기 테이블 — 남은 공간 모두 차지 */}
        <div className="flex-1 min-h-0 px-6 py-4 overflow-hidden flex flex-col">
          {rows.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400 dark:text-slate-500 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
              위에서 엑셀 파일을 선택하면 미리보기가 표시됩니다
            </div>
          ) : (
            <div className="flex-1 min-h-0 border border-gray-200 dark:border-gray-700 rounded-lg overflow-auto">
              <table className="w-full text-xs table-fixed">
                <colgroup>
                  <col style={{ width: "48px" }} />
                  <col style={{ width: "56px" }} />
                  <col style={{ width: "72px" }} />
                  <col style={{ width: "130px" }} />
                  <col style={{ width: "200px" }} />
                  <col style={{ width: "300px" }} />
                  <col style={{ width: "160px" }} />
                  <col style={{ width: "140px" }} />
                  <col />
                </colgroup>
                <thead className="bg-slate-100 dark:bg-slate-700 sticky top-0 z-10">
                  <tr className="text-slate-700 dark:text-slate-100">
                    <th className="px-2 py-2 text-center font-semibold">행</th>
                    <th className="px-2 py-2 text-center font-semibold">상태</th>
                    <th className="px-2 py-2 text-center font-semibold">구분</th>
                    <th className="px-2 py-2 text-left font-semibold">자재코드</th>
                    <th className="px-2 py-2 text-left font-semibold">부품명</th>
                    <th className="px-2 py-2 text-left font-semibold">분류(코드/명)</th>
                    <th className="px-2 py-2 text-left font-semibold">규격 / 단위</th>
                    <th className="px-2 py-2 text-right font-semibold">구매 / 판매</th>
                    <th className="px-2 py-2 text-left font-semibold">메모 / 오류</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {rows.map(r => {
                    const rowCls =
                      r.status === "ok" ? "bg-green-50 dark:bg-green-900/20"
                      : r.status === "fail" ? "bg-red-50 dark:bg-red-900/20"
                      : r.errors.length > 0 ? "bg-orange-50 dark:bg-orange-900/20"
                      : "bg-white dark:bg-gray-800";
                    const majorLabel = cats?.major.find(x => x.code === r.major)?.label;
                    const midLabel = cats?.mid[r.major]?.find(x => x.code === r.mid)?.label;
                    const subLabel = cats?.sub[`${r.major}${r.mid}`]?.find(x => x.code === r.sub)?.label;
                    const catLabel = [majorLabel, midLabel, subLabel].filter(Boolean).join(" › ");
                    return (
                      <tr key={r.rowNo} className={`${rowCls} align-top`}>
                        <td className="px-2 py-2 text-center text-slate-400">{r.rowNo + 1}</td>
                        <td className="px-2 py-2 text-center">
                          {r.status === "ok" ? <span className="text-green-700 font-bold">✓</span>
                            : r.status === "fail" ? <span className="text-red-700 font-bold">✗</span>
                            : r.errors.length > 0 ? <span className="text-orange-600 font-bold">!</span>
                            : <span className="text-slate-400">·</span>}
                        </td>
                        <td className="px-2 py-2 text-center">{r.raw.자재구분 || "-"}</td>
                        <td className="px-2 py-2 font-mono break-all">{r.directId || <span className="text-slate-400 font-sans">자동</span>}</td>
                        <td className="px-2 py-2 break-words">{r.name || <span className="text-slate-400">-</span>}</td>
                        <td className="px-2 py-2">
                          <div className="font-mono">{r.major}/{r.mid}/{r.sub}</div>
                          {catLabel && <div className="text-slate-500 text-[11px] mt-0.5">{catLabel}</div>}
                        </td>
                        <td className="px-2 py-2 break-words">
                          <div>{r.modelNo || "-"}</div>
                          <div className="text-slate-500 text-[11px]">{r.unit}</div>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          <div>{r.buyPrice || "-"}</div>
                          <div className="text-slate-500 text-[11px]">{r.sellPrice || "-"}</div>
                        </td>
                        <td className="px-2 py-2 text-red-600 dark:text-red-400 break-words whitespace-normal">
                          {r.message || r.errors.join(", ")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
          <button
            type="button"
            onClick={() => { if (done) onSaved(); else onClose(); }}
            className="flex-1 rounded-lg border border-gray-200 dark:border-gray-600 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {done ? "닫기" : "취소"}
          </button>
          <button
            type="button"
            disabled={uploading || done || validCount === 0}
            onClick={startUpload}
            className="flex-1 rounded-lg bg-slate-700 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {uploading ? `등록 중 ${progress}/${validCount}` : done ? "완료" : `${validCount}건 등록`}
          </button>
        </div>
      </div>
    </div>
  );
}
