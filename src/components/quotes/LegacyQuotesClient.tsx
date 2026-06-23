"use client";

import { useState, useEffect, useMemo, useCallback, useRef, Fragment, DragEvent, ChangeEvent } from "react";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { useViewMode } from "@/context/ViewModeContext";
import { supabase } from "@/lib/supabase";

const MENU_HREF = "/quotes/legacy";
const LEGACY_QUOTE_BUCKET = "legacy-quote-docs";

interface LegacyQuote {
  id: number;
  pdf_filename: string;
  pdf_url: string;
  pdf_path: string | null;
  quote_date: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  created_at: string;
}

// 파일명 끝의 _YY.MM.DD 패턴에서 견적작성일 추출
// 예: "OTIS(...)-25년_25.11.19.pdf" → "2025-11-19"
function parseQuoteDate(filename: string): string | null {
  const m = filename.match(/_(\d{2})\.(\d{2})\.(\d{2})(?:\.pdf)?$/i);
  if (!m) return null;
  const [, yy, mm, dd] = m;
  const year = Number(yy) >= 70 ? `19${yy}` : `20${yy}`;
  return `${year}-${mm}-${dd}`;
}

// 파일 size 사람 친화 표기
function fmtFileSize(bytes: number | null): string {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

interface PendingUpload {
  file: File;
  filename: string;
  quote_date: string | null;
  size: number;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
}

export default function LegacyQuotesClient() {
  const { user } = useAuth();

  const [rows, setRows] = useState<LegacyQuote[]>([]);
  const [loading, setLoading] = useState(true);

  // 필터
  const [keyword, setKeyword] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<"quote_date" | "created_at" | "pdf_filename">("quote_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // 업로드 모달
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const admin = user ? isAdmin(user) : false;
  const canRead = !!user && (admin || hasMenuPermission(user, MENU_HREF, "read"));
  const { viewMode } = useViewMode();
  const isMobile = viewMode === "mobile";
  const canCreate = !!user && (admin || hasMenuPermission(user, MENU_HREF, "create"));
  const canDelete = admin;

  const load = useCallback(async () => {
    setLoading(true);
    // PostgREST 기본 max-rows(1000) 때문에 단일 조회는 1000건에서 잘림 → range로 전량 페이징
    const PAGE = 1000;
    const all: LegacyQuote[] = [];
    let failed = false;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("legacy_quotes")
        .select("id, pdf_filename, pdf_url, pdf_path, quote_date, file_size, uploaded_by, created_at")
        .order("quote_date", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) {
        console.error("[legacy_quotes] load failed", error);
        failed = true;
        break;
      }
      const batch = (data ?? []) as LegacyQuote[];
      all.push(...batch);
      if (batch.length < PAGE) break;
    }
    setRows(failed ? [] : all);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, load]);
  useReloadOnActivate(() => { if (canRead) void load(); });

  const filtered = useMemo(() => {
    let list = rows;
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      list = list.filter(r => r.pdf_filename.toLowerCase().includes(kw));
    }
    if (dateFrom) list = list.filter(r => (r.quote_date ?? "") >= dateFrom);
    if (dateTo)   list = list.filter(r => (r.quote_date ?? "9999-12-31") <= dateTo);
    list = [...list].sort((a, b) => {
      const va = (a[sortKey] ?? "") as string;
      const vb = (b[sortKey] ?? "") as string;
      if (va === vb) return 0;
      const cmp = va < vb ? -1 : 1;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [rows, keyword, dateFrom, dateTo, sortKey, sortDir]);

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    const pdfs = list.filter(f => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) {
      alert("PDF 파일만 업로드할 수 있습니다.");
      return;
    }
    const next: PendingUpload[] = pdfs.map(f => ({
      file: f,
      filename: f.name,
      quote_date: parseQuoteDate(f.name),
      size: f.size,
      status: "pending",
    }));
    setPending(prev => [...prev, ...next]);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }

  function onFilePick(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) addFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePending(idx: number) {
    setPending(p => p.filter((_, i) => i !== idx));
  }

  function updatePending(idx: number, patch: Partial<PendingUpload>) {
    setPending(p => p.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  function openUpload() {
    setPending([]);
    setUploadOpen(true);
  }
  function closeUpload() {
    if (uploading) return;
    setUploadOpen(false);
    setPending([]);
  }

  async function submitUpload() {
    if (pending.length === 0) {
      alert("등록할 PDF 파일을 추가해주세요.");
      return;
    }
    setUploading(true);
    const todo = [...pending];
    for (let i = 0; i < todo.length; i++) {
      const row = todo[i];
      if (row.status === "success") continue;
      updatePending(i, { status: "uploading", error: undefined });
      try {
        // Storage 경로: ASCII 안전 식별자만 사용 (Supabase Storage 키는 한글·공백·괄호 거부).
        // 원본 파일명은 DB의 pdf_filename 컬럼에서 보관하고, 다운로드 시 download 속성으로 노출.
        const path = `legacy_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.pdf`;

        const { error: upErr } = await supabase.storage
          .from(LEGACY_QUOTE_BUCKET)
          .upload(path, row.file, { cacheControl: "3600", upsert: false, contentType: "application/pdf" });
        if (upErr) throw upErr;

        const { data: pub } = supabase.storage.from(LEGACY_QUOTE_BUCKET).getPublicUrl(path);

        const { error: insErr } = await supabase.from("legacy_quotes").insert({
          pdf_filename: row.filename,
          pdf_url: pub.publicUrl,
          pdf_path: path,
          quote_date: row.quote_date,
          file_size: row.size,
          uploaded_by: user?.name ?? null,
        });
        if (insErr) throw insErr;

        updatePending(i, { status: "success" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : (typeof e === "object" ? JSON.stringify(e) : String(e));
        console.error("[legacy_quotes] upload failed:", row.filename, e);
        updatePending(i, { status: "error", error: msg });
      }
    }
    setUploading(false);
    await load();
  }

  async function handleDelete(row: LegacyQuote) {
    if (!canDelete) return;
    if (!confirm(`"${row.pdf_filename}" 파일을 삭제하시겠습니까?\n(Storage 파일과 DB 기록이 모두 삭제됩니다.)`)) return;
    if (row.pdf_path) {
      const { error: stErr } = await supabase.storage.from(LEGACY_QUOTE_BUCKET).remove([row.pdf_path]);
      if (stErr) {
        console.warn("[legacy_quotes] storage remove failed", stErr);
      }
    }
    const { error: dbErr } = await supabase.from("legacy_quotes").delete().eq("id", row.id);
    if (dbErr) {
      alert(`삭제 실패: ${dbErr.message}`);
      return;
    }
    await load();
  }

  if (!user) {
    return <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">로그인이 필요합니다.</div>;
  }

  if (!canRead) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* 헤더 */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white">구 견적조회</h1>
          <p className="text-sm text-gray-500 dark:text-gray-300 mt-0.5">과거 견적 PDF 아카이브 · 파일명 기반 검색 / 다운로드</p>
        </div>
        {canCreate && !isMobile && (
          <button
            type="button"
            onClick={openUpload}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white shadow-sm transition-colors"
          >
            <span>📤</span>
            <span>PDF 등록</span>
          </button>
        )}
      </div>

      {/* 필터바 */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">파일명 검색</label>
          <input
            type="text"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="예: OTIS, 의정부, 로프파단"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">견적작성일 (From)</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">견적작성일 (To)</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>
        <button
          type="button"
          onClick={() => { setKeyword(""); setDateFrom(""); setDateTo(""); }}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          초기화
        </button>
        <div className="ml-auto text-xs text-gray-500 dark:text-gray-400">
          총 <span className="font-semibold text-gray-700 dark:text-gray-200">{filtered.length}</span>건
          {filtered.length !== rows.length && <> / 전체 {rows.length}건</>}
        </div>
      </div>

      {/* 목록 */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        {isMobile ? (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading ? (
              <div className="px-3 py-10 text-center text-sm text-gray-500 dark:text-gray-400">불러오는 중...</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                {rows.length === 0 ? "등록된 PDF가 없습니다. [PDF 등록]으로 추가하세요." : "조건에 맞는 결과가 없습니다."}
              </div>
            ) : filtered.map(row => (
              <div key={row.id} className="p-4">
                <p className="font-medium text-gray-800 dark:text-gray-100 break-all">{row.pdf_filename}</p>
                <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                  <span className="text-gray-400">견적작성 </span>{row.quote_date ?? "-"}
                </div>
                <div className="flex gap-1 mt-2 flex-wrap">
                  <a href={row.pdf_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">👁 보기</a>
                  <a href={row.pdf_url} download={row.pdf_filename}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">⬇ 다운로드</a>
                </div>
              </div>
            ))}
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th
                  className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 cursor-pointer hover:text-yellow-600 dark:hover:text-yellow-400 w-32"
                  onClick={() => toggleSort("quote_date")}
                >
                  견적작성일 {sortKey === "quote_date" && (sortDir === "asc" ? "▲" : "▼")}
                </th>
                <th
                  className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 cursor-pointer hover:text-yellow-600 dark:hover:text-yellow-400"
                  onClick={() => toggleSort("pdf_filename")}
                >
                  파일명 {sortKey === "pdf_filename" && (sortDir === "asc" ? "▲" : "▼")}
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-300 w-24">크기</th>
                <th
                  className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 cursor-pointer hover:text-yellow-600 dark:hover:text-yellow-400 w-36"
                  onClick={() => toggleSort("created_at")}
                >
                  업로드일 {sortKey === "created_at" && (sortDir === "asc" ? "▲" : "▼")}
                </th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 w-40">동작</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-gray-500 dark:text-gray-400">불러오는 중...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                  {rows.length === 0 ? "등록된 PDF가 없습니다. 우측 상단의 [PDF 등록] 버튼으로 추가하세요." : "조건에 맞는 결과가 없습니다."}
                </td></tr>
              ) : filtered.map(row => (
                <tr key={row.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-yellow-50/50 dark:hover:bg-yellow-900/10">
                  <td className="px-3 py-2 text-gray-800 dark:text-gray-100 font-mono text-xs">
                    {row.quote_date ?? <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-800 dark:text-gray-100 break-all">
                    {row.pdf_filename}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300 text-xs font-mono">
                    {fmtFileSize(row.file_size)}
                  </td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">
                    {row.created_at.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    <a
                      href={row.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 mr-1"
                    >
                      👁 보기
                    </a>
                    <a
                      href={row.pdf_url}
                      download={row.pdf_filename}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 mr-1"
                    >
                      ⬇
                    </a>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(row)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        🗑
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* 업로드 모달 */}
      {uploadOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">PDF 등록</h2>
              <button
                type="button"
                onClick={closeUpload}
                disabled={uploading}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {/* 드래그앤드롭 영역 */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragOver
                    ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20"
                    : "border-gray-300 dark:border-gray-600"
                }`}
              >
                <div className="text-4xl mb-2">📄</div>
                <div className="text-sm text-gray-700 dark:text-gray-200 mb-1">
                  PDF 파일을 이곳에 끌어다 놓으세요
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  파일명 끝의 <code className="px-1 bg-gray-100 dark:bg-gray-900 rounded">_YY.MM.DD</code> 패턴에서 견적작성일이 자동 추출됩니다.
                </div>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                  >
                    파일 선택
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  onChange={onFilePick}
                  className="hidden"
                />
              </div>

              {/* 미리보기 테이블 */}
              {pending.length > 0 && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 dark:bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 flex items-center justify-between">
                    <span>등록 대기 ({pending.length}건)</span>
                    <span className="text-gray-500">
                      ✅ {pending.filter(p => p.status === "success").length} · ❌ {pending.filter(p => p.status === "error").length} · ⏳ {pending.filter(p => p.status === "pending" || p.status === "uploading").length}
                    </span>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-white dark:bg-gray-800 sticky top-0">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium text-gray-600 dark:text-gray-300">파일명</th>
                          <th className="px-2 py-1.5 text-left font-medium text-gray-600 dark:text-gray-300 w-32">견적작성일</th>
                          <th className="px-2 py-1.5 text-right font-medium text-gray-600 dark:text-gray-300 w-20">크기</th>
                          <th className="px-2 py-1.5 text-center font-medium text-gray-600 dark:text-gray-300 w-16">상태</th>
                          <th className="w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pending.map((row, idx) => (
                          <Fragment key={idx}>
                          <tr className="border-t border-gray-100 dark:border-gray-700">
                            <td className="px-2 py-1.5 text-gray-800 dark:text-gray-100 break-all">{row.filename}</td>
                            <td className="px-2 py-1.5">
                              <input
                                type="date"
                                value={row.quote_date ?? ""}
                                onChange={e => updatePending(idx, { quote_date: e.target.value || null })}
                                disabled={uploading || row.status === "success"}
                                className={`w-full px-1.5 py-0.5 text-xs border rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 ${
                                  row.quote_date ? "border-gray-300 dark:border-gray-600" : "border-red-300 dark:border-red-700"
                                }`}
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono text-gray-500 dark:text-gray-400">{fmtFileSize(row.size)}</td>
                            <td className="px-2 py-1.5 text-center">
                              {row.status === "pending" && <span className="text-gray-400">대기</span>}
                              {row.status === "uploading" && <span className="text-blue-500">업로드중</span>}
                              {row.status === "success" && <span className="text-green-600">✅</span>}
                              {row.status === "error" && <span className="text-red-500">❌</span>}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              {row.status !== "success" && !uploading && (
                                <button
                                  type="button"
                                  onClick={() => removePending(idx)}
                                  className="text-gray-400 hover:text-red-500"
                                >✕</button>
                              )}
                            </td>
                          </tr>
                          {row.status === "error" && row.error && (
                            <tr>
                              <td colSpan={5} className="px-2 py-1 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-xs break-all">
                                ⚠ {row.error}
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeUpload}
                disabled={uploading}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={submitUpload}
                disabled={uploading || pending.length === 0 || pending.every(p => p.status === "success")}
                className="px-4 py-1.5 text-sm font-medium rounded-md bg-yellow-500 hover:bg-yellow-600 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {uploading ? "업로드 중..." : `일괄 등록 (${pending.filter(p => p.status !== "success").length}건)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
