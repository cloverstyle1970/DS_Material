"use client";

import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { api, getErrorMessage } from "@/lib/api-client";
import { MaterialRecord } from "@/lib/mock-materials";
import { useAuth } from "@/context/AuthContext";

interface Props {
  mode: "입고" | "출고";
  onClose: () => void;
  onSaved: () => void;
}

interface RawRow {
  자재코드?: string;
  수량?: string | number;
  현장명?: string;
  호기?: string;
  S_N목록?: string;
  회수필요?: string;
  비고?: string;
}

interface ParsedRow {
  rowNo: number;
  materialId: string;
  materialName: string;
  qty: number;
  siteName: string;
  elevatorName: string;
  serialNos: string[];
  requiresReturn: boolean;
  note: string;
  errors: string[];
  status: "pending" | "ok" | "fail";
  message?: string;
}

function asString(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}
function asNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}
function parseSerials(v: unknown): string[] {
  const s = asString(v);
  if (!s) return [];
  return s.split(/[,;]\s*|\s*\|\s*/).map(x => x.trim()).filter(Boolean);
}

function downloadTemplate(mode: "입고" | "출고") {
  const inbound: Record<string, string | number> = {
    자재코드: "D0101010001_",
    수량: 5,
    현장명: "예시 현장",
    "S/N목록": "SN001, SN002, SN003",
    비고: "샘플 입고",
  };
  const outbound: Record<string, string | number> = {
    자재코드: "D0101010001_",
    수량: 5,
    현장명: "예시 현장",
    호기: "1호기",
    "S/N목록": "SN001, SN002",
    회수필요: "N",
    비고: "샘플 출고",
  };
  const sample = mode === "입고" ? inbound : outbound;
  const headers = mode === "입고"
    ? ["자재코드", "수량", "현장명", "S/N목록", "비고"]
    : ["자재코드", "수량", "현장명", "호기", "S/N목록", "회수필요", "비고"];
  const ws = XLSX.utils.json_to_sheet([sample], { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${mode}등록양식`);
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${mode}일괄등록_양식.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TransactionBulkUploadModal({ mode, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const isOutbound = mode === "출고";
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [matMap, setMatMap] = useState<Map<string, MaterialRecord>>(new Map());
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get<MaterialRecord[]>("/api/materials")
      .then(list => setMatMap(new Map(list.map(m => [m.id, m]))))
      .catch(e => alert(getErrorMessage(e)));
  }, []);

  async function handleFile(file: File) {
    setDone(false);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    // xlsx sheet_to_json은 "S/N목록" 같은 키를 그대로 보존
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

    const parsed: ParsedRow[] = json.map((r, i) => {
      const materialId = asString(r["자재코드"]);
      const qty = Number(asNumber(r["수량"]) ?? 0);
      const serials = parseSerials(r["S/N목록"]);
      const returnFlag = asString(r["회수필요"]).toUpperCase();
      const mat = matMap.get(materialId);
      const errs: string[] = [];

      if (!materialId) errs.push("자재코드 필수");
      else if (!mat) errs.push("등록되지 않은 자재코드");
      if (!Number.isFinite(qty) || qty <= 0) errs.push("수량 1 이상 숫자");
      if (serials.length > qty) errs.push(`S/N(${serials.length}) > 수량(${qty})`);
      if (isOutbound && returnFlag && !["Y", "N"].includes(returnFlag)) errs.push("회수필요는 Y/N");
      if (isOutbound && mat?.trackSerial && serials.length !== qty) errs.push("S/N 필수(시리얼 추적 자재)");
      if (mode === "출고" && mat && (mat.stockQty ?? 0) < qty) errs.push(`재고 부족 (현재 ${mat.stockQty})`);

      return {
        rowNo: i + 1,
        materialId,
        materialName: mat?.name ?? "",
        qty,
        siteName: asString(r["현장명"]),
        elevatorName: asString(r["호기"]),
        serialNos: serials,
        requiresReturn: isOutbound ? returnFlag === "Y" : false,
        note: asString(r["비고"]),
        errors: errs,
        status: "pending",
      };
    });

    setRows(parsed);
    setFileName(file.name);
    setProgress(0);
  }

  async function startUpload() {
    if (!user) return;
    const targets = rows.filter(r => r.errors.length === 0);
    if (targets.length === 0) return;
    setUploading(true);
    setProgress(0);
    const updated = [...rows];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const idx = updated.findIndex(r => r.rowNo === t.rowNo);
      try {
        await api.post("/api/transactions", {
          type: mode,
          materialId: t.materialId,
          materialName: t.materialName,
          qty: t.qty,
          siteName: t.siteName || null,
          elevatorName: isOutbound ? (t.elevatorName || null) : undefined,
          serialNos: t.serialNos.length > 0 ? t.serialNos : null,
          requiresReturn: isOutbound ? t.requiresReturn : undefined,
          note: t.note || null,
          userId: user.id,
          userName: user.name,
        });
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">{mode} 일괄 등록 (엑셀 업로드)</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-4 space-y-3 flex-shrink-0 border-b border-gray-100 dark:border-gray-700">
          <div className="rounded-lg bg-slate-50 dark:bg-slate-700/50 px-4 py-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="font-semibold text-slate-700 dark:text-slate-200">엑셀 양식</span>
              <button onClick={() => downloadTemplate(mode)} className="text-xs text-blue-600 hover:text-blue-800 underline">양식 다운로드</button>
            </div>
            <p>· 필수: 자재코드(기등록), 수량(1 이상). 한 행 = 한 트랜잭션</p>
            <p>· S/N목록은 한 셀에 쉼표 구분 (예: SN001, SN002, SN003) — 갯수 ≤ 수량</p>
            {isOutbound && <p>· 시리얼 추적 자재는 S/N 필수, 수량과 정확히 일치해야 함. 회수필요는 Y/N (기본 N)</p>}
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
                {errorCount > 0 && <span className="px-2 py-1 rounded bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300">오류 {errorCount}</span>}
                {done && (
                  <>
                    <span className="px-2 py-1 rounded bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">성공 {okCount}</span>
                    {failCount > 0 && <span className="px-2 py-1 rounded bg-orange-50 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">실패 {failCount}</span>}
                  </>
                )}
                {uploading && <span className="text-slate-500">진행 {progress} / {validCount}</span>}
              </div>
            )}
          </div>
        </div>

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
                  <col style={{ width: "140px" }} />
                  <col style={{ width: "200px" }} />
                  <col style={{ width: "70px" }} />
                  <col style={{ width: "160px" }} />
                  <col style={{ width: "220px" }} />
                  {isOutbound && <col style={{ width: "70px" }} />}
                  <col style={{ width: "100px" }} />
                  <col />
                </colgroup>
                <thead className="bg-slate-100 dark:bg-slate-700 sticky top-0 z-10">
                  <tr className="text-slate-700 dark:text-slate-100">
                    <th className="px-2 py-2 text-center font-semibold">행</th>
                    <th className="px-2 py-2 text-center font-semibold">상태</th>
                    <th className="px-2 py-2 text-left font-semibold">자재코드</th>
                    <th className="px-2 py-2 text-left font-semibold">자재명</th>
                    <th className="px-2 py-2 text-right font-semibold">수량</th>
                    <th className="px-2 py-2 text-left font-semibold">{isOutbound ? "현장 / 호기" : "현장"}</th>
                    <th className="px-2 py-2 text-left font-semibold">S/N</th>
                    {isOutbound && <th className="px-2 py-2 text-center font-semibold">회수</th>}
                    <th className="px-2 py-2 text-left font-semibold">비고</th>
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
                    return (
                      <tr key={r.rowNo} className={`${rowCls} align-top`}>
                        <td className="px-2 py-2 text-center text-slate-400">{r.rowNo + 1}</td>
                        <td className="px-2 py-2 text-center">
                          {r.status === "ok" ? <span className="text-green-700 font-bold">✓</span>
                            : r.status === "fail" ? <span className="text-red-700 font-bold">✗</span>
                            : r.errors.length > 0 ? <span className="text-orange-600 font-bold">!</span>
                            : <span className="text-slate-400">·</span>}
                        </td>
                        <td className="px-2 py-2 font-mono break-all">{r.materialId || "-"}</td>
                        <td className="px-2 py-2 break-words">{r.materialName || <span className="text-slate-400">-</span>}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{r.qty || "-"}</td>
                        <td className="px-2 py-2 break-words">
                          <div>{r.siteName || "-"}</div>
                          {isOutbound && <div className="text-slate-500 text-[11px]">{r.elevatorName || ""}</div>}
                        </td>
                        <td className="px-2 py-2 break-words font-mono text-[11px]">
                          {r.serialNos.length > 0 ? r.serialNos.join(", ") : <span className="font-sans text-slate-400">-</span>}
                        </td>
                        {isOutbound && (
                          <td className="px-2 py-2 text-center">{r.requiresReturn ? "Y" : "N"}</td>
                        )}
                        <td className="px-2 py-2 break-words">{r.note || "-"}</td>
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
