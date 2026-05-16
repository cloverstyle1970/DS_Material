"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

// ============================================================
// 타입
// ============================================================

interface QuoteHeader {
  id: number;
  quote_no: string;
  site_name: string | null;
  elevator_name: string | null;
  work_title: string | null;
  status: "작성중" | "발행" | "승인" | "취소";
  progress_state: "미시작" | "자재신청" | "자재출고" | "세금계산서발급" | "입금완료" | "종료";
  charge_type: "유상" | "무상";
  total_amount: number;
}

interface MaterialReqRow {
  id: number;
  status: "신청" | "처리중" | "완료" | "취소";
  site_name: string | null;
  items: ReqItem[];
  note: string | null;
  request_type: string | null;
  requested_at: string;
  processed_at: string | null;
  processor_name: string | null;
}

interface ReqItem {
  materialId: string;
  materialName: string;
  qty: number;
  elevatorName: string | null;
}

interface MaterialStock {
  id: string;
  name: string;
  stock_qty: number;
  unit: string | null;
  track_serial: boolean;
}

interface RowStatus {
  // key = `${materialId}|${elevatorName ?? ""}`
  key: string;
  it: ReqItem;
  stock: number;
  trackSerial: boolean;
  outbound: number;     // 이번 신청에 대해 이미 출고된 수량 (이번 페이지에서 출고된 누적)
  unitLabel: string;
}

// ============================================================

export default function QuoteOutboundClient() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-sm text-gray-500">로딩 중...</div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useSearchParams();
  const quoteIdStr = params.get("quoteId");
  const quoteId = quoteIdStr ? Number(quoteIdStr) : NaN;
  const { user } = useAuth();
  const admin = user ? isAdmin(user) : false;

  const [quote, setQuote]         = useState<QuoteHeader | null>(null);
  const [req, setReq]             = useState<MaterialReqRow | null>(null);
  const [stocks, setStocks]       = useState<Map<string, MaterialStock>>(new Map());
  const [outboundMap, setOutboundMap] = useState<Record<string, number>>({});
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [message, setMessage]     = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function load() {
    if (!Number.isFinite(quoteId)) { setError("잘못된 견적 ID"); setLoading(false); return; }
    setLoading(true);
    setMessage(null);
    const [q, mr] = await Promise.all([
      supabase.from("quotes").select("id, quote_no, site_name, elevator_name, work_title, status, progress_state, charge_type, total_amount").eq("id", quoteId).maybeSingle(),
      supabase.from("material_requests")
        .select("id, status, site_name, items, note, request_type, requested_at, processed_at, processor_name")
        .eq("quote_id", quoteId)
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (q.error || !q.data) { setError(`견적 로드 실패: ${q.error?.message ?? "not found"}`); setLoading(false); return; }
    setQuote(q.data as QuoteHeader);
    const reqRow = (mr.data ?? null) as MaterialReqRow | null;
    setReq(reqRow);

    if (reqRow && Array.isArray(reqRow.items) && reqRow.items.length > 0) {
      const ids = Array.from(new Set(reqRow.items.map(i => i.materialId).filter(Boolean)));
      if (ids.length > 0) {
        const { data: mats } = await supabase.from("materials")
          .select("id, name, stock_qty, unit, track_serial")
          .in("id", ids);
        const map = new Map<string, MaterialStock>();
        (mats ?? []).forEach((m: { id: string; name: string; stock_qty: number; unit: string | null; track_serial: boolean }) => map.set(m.id, m));
        setStocks(map);
      }
    }
    setLoading(false);
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [quoteId]);

  const rows: RowStatus[] = useMemo(() => {
    if (!req) return [];
    return req.items.map(it => {
      const key = `${it.materialId}|${it.elevatorName ?? ""}`;
      const m = stocks.get(it.materialId);
      return {
        key,
        it,
        stock:       m?.stock_qty ?? 0,
        trackSerial: m?.track_serial ?? false,
        outbound:    outboundMap[key] ?? 0,
        unitLabel:   m?.unit ?? "EA",
      };
    });
  }, [req, stocks, outboundMap]);

  const allOutbound = rows.length > 0 && rows.every(r => r.outbound >= r.it.qty);

  // ============================================================
  // 액션
  // ============================================================

  async function issueOne(row: RowStatus) {
    if (!quote || !req || !user) return;
    const remainNeed = row.it.qty - row.outbound;
    const issueQty = Math.min(row.stock, remainNeed);
    if (issueQty <= 0) { setMessage({ type: "error", text: "재고가 부족하거나 이미 모두 출고되었습니다." }); return; }
    if (row.trackSerial) {
      setMessage({ type: "error", text: "S/N 추적 자재는 [출고 관리] 메뉴에서 시리얼을 입력해 처리해 주세요." });
      return;
    }
    setActionKey(row.key);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc("add_transaction", {
        p_type:            "출고",
        p_material_id:     row.it.materialId,
        p_material_name:   row.it.materialName,
        p_qty:             issueQty,
        p_site_name:       req.site_name ?? quote.site_name ?? "",
        p_note:            `견적 ${quote.quote_no} 자동출고`,
        p_user_id:         user.id,
        p_user_name:       user.name,
        p_elevator_name:   row.it.elevatorName ?? quote.elevator_name ?? null,
        p_serial_nos:      null,
        p_requires_return: false,
      });
      if (error) throw error;
      // RPC 가 {error: ...} 반환 시
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((data as any)?.error) throw new Error((data as any).error);
      // 누적 출고량 + 재고 차감 UI 반영
      setOutboundMap(prev => ({ ...prev, [row.key]: (prev[row.key] ?? 0) + issueQty }));
      setStocks(prev => {
        const next = new Map(prev);
        const m = next.get(row.it.materialId);
        if (m) next.set(row.it.materialId, { ...m, stock_qty: m.stock_qty - issueQty });
        return next;
      });
      setMessage({ type: "success", text: `${row.it.materialName} ${issueQty}${row.unitLabel} 출고 처리됨.` });
    } catch (e) {
      setMessage({ type: "error", text: `출고 실패: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setActionKey(null);
    }
  }

  async function issueAllInStock() {
    if (!quote || !req || !user) return;
    const targets = rows.filter(r => !r.trackSerial && r.stock > 0 && r.outbound < r.it.qty);
    if (targets.length === 0) { setMessage({ type: "error", text: "출고 가능한 자재가 없습니다." }); return; }
    if (!confirm(`재고 보유 자재 ${targets.length}건을 모두 출고 처리합니다. 계속하시겠습니까?`)) return;
    setActionKey("__bulk__");
    setMessage(null);
    let ok = 0, fail = 0;
    for (const row of targets) {
      const remainNeed = row.it.qty - row.outbound;
      const issueQty = Math.min(row.stock, remainNeed);
      if (issueQty <= 0) continue;
      try {
        const { data, error } = await supabase.rpc("add_transaction", {
          p_type:            "출고",
          p_material_id:     row.it.materialId,
          p_material_name:   row.it.materialName,
          p_qty:             issueQty,
          p_site_name:       req.site_name ?? quote.site_name ?? "",
          p_note:            `견적 ${quote.quote_no} 일괄출고`,
          p_user_id:         user.id,
          p_user_name:       user.name,
          p_elevator_name:   row.it.elevatorName ?? quote.elevator_name ?? null,
          p_serial_nos:      null,
          p_requires_return: false,
        });
        if (error) throw error;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((data as any)?.error) throw new Error((data as any).error);
        setOutboundMap(prev => ({ ...prev, [row.key]: (prev[row.key] ?? 0) + issueQty }));
        setStocks(prev => {
          const next = new Map(prev);
          const m = next.get(row.it.materialId);
          if (m) next.set(row.it.materialId, { ...m, stock_qty: m.stock_qty - issueQty });
          return next;
        });
        ok++;
      } catch { fail++; }
    }
    setActionKey(null);
    setMessage({
      type: fail > 0 ? "error" : "success",
      text: `일괄 출고 완료: 성공 ${ok}건${fail > 0 ? ` / 실패 ${fail}건` : ""}`,
    });
  }

  async function finalize() {
    if (!quote || !req) return;
    if (!allOutbound) { setMessage({ type: "error", text: "아직 출고되지 않은 자재가 있습니다." }); return; }
    setActionKey("__finalize__");
    setMessage(null);
    try {
      // snapshot 직전 호출
      if (user) {
        await supabase.rpc("snapshot_quote", {
          p_quote_id:  quote.id,
          p_summary:   `진행상태: ${quote.progress_state} → 자재출고 (전 라인 출고 완료)`,
          p_user_id:   user.id,
          p_user_name: user.name,
        });
      }
      const [a, b] = await Promise.all([
        supabase.from("material_requests")
          .update({
            status: "완료",
            processed_at: new Date().toISOString(),
            processor_id: user?.id ?? null,
            processor_name: user?.name ?? null,
          })
          .eq("id", req.id),
        supabase.from("quotes")
          .update({ progress_state: "자재출고", updated_at: new Date().toISOString() })
          .eq("id", quote.id),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      setQuote({ ...quote, progress_state: "자재출고" });
      setReq({ ...req, status: "완료" });
      setMessage({ type: "success", text: "출고 완료 처리됨. 견적 진행상태가 [자재출고] 로 갱신되었습니다." });
    } catch (e) {
      setMessage({ type: "error", text: `완료 처리 실패: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setActionKey(null);
    }
  }

  // ============================================================
  // 렌더
  // ============================================================

  if (loading) return <div className="p-12 text-center text-sm text-gray-500">로딩 중...</div>;
  if (error)   return <div className="p-12 text-center text-sm text-red-500">{error}</div>;
  if (!quote)  return <div className="p-12 text-center text-sm text-red-500">견적을 찾을 수 없습니다.</div>;

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900 p-6">
      {/* 헤더 */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-4">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <Link href={`/quotes/detail?id=${quote.id}`}
            className="text-xs text-gray-500 hover:text-blue-600">← 견적서</Link>
          <span className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400">{quote.quote_no}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
            quote.status === "승인" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
            : "bg-gray-100 text-gray-500"
          }`}>결재: {quote.status}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            진행: {quote.progress_state}
          </span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
            quote.charge_type === "무상" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
          }`}>{quote.charge_type}</span>
        </div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">📦 견적 출고 관리</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">
          {quote.site_name ?? "-"}
          {quote.elevator_name && <span className="ml-2 text-gray-400">({quote.elevator_name})</span>}
          {quote.work_title && <span className="ml-3">· {quote.work_title}</span>}
        </p>
      </div>

      {/* 자재신청 없음 */}
      {!req ? (
        <div className="bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 rounded-xl p-6 text-center">
          <div className="text-3xl mb-2">📋</div>
          <div className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">자재신청이 아직 생성되지 않았습니다.</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            견적 상세 화면에서 [📦 자재신청 생성] 버튼을 먼저 눌러 주세요.
          </div>
        </div>
      ) : (
        <>
          {/* 자재신청 정보 */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-4 flex flex-wrap items-center gap-3 text-xs">
            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">자재신청 #{req.id}</span>
            <span className={`px-2 py-0.5 rounded-full font-bold ${
              req.status === "완료" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
              : req.status === "취소" ? "bg-gray-100 text-gray-500"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            }`}>{req.status}</span>
            {req.request_type && <span className="text-gray-500">유형: {req.request_type}</span>}
            <span className="text-gray-400 ml-auto font-mono">접수: {req.requested_at.slice(0, 16).replace("T", " ")}</span>
            {req.processed_at && <span className="text-gray-400">완료: {req.processed_at.slice(0, 16).replace("T", " ")} ({req.processor_name ?? "-"})</span>}
          </div>

          {/* 라인 표 */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">자재 라인 ({rows.length}건)</h2>
              {admin && req.status !== "완료" && (
                <div className="flex gap-2">
                  <button type="button" onClick={issueAllInStock} disabled={actionKey !== null}
                    className="px-3 py-1.5 text-xs font-semibold rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                    📤 재고 보유 자재 일괄 출고
                  </button>
                  <button type="button" onClick={finalize} disabled={!allOutbound || actionKey !== null}
                    className={`px-3 py-1.5 text-xs font-semibold rounded ${
                      allOutbound
                        ? "bg-emerald-600 text-white hover:bg-emerald-700"
                        : "bg-gray-200 text-gray-400 cursor-not-allowed"
                    }`}>
                    ✅ 출고 완료 처리
                  </button>
                </div>
              )}
            </div>

            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr className="text-left text-[11px] font-bold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="px-3 py-2 w-10">NO</th>
                  <th className="px-3 py-2 w-20">호기</th>
                  <th className="px-3 py-2">자재</th>
                  <th className="px-3 py-2 w-16 text-right">신청수량</th>
                  <th className="px-3 py-2 w-16 text-right">출고완료</th>
                  <th className="px-3 py-2 w-16 text-right">잔여</th>
                  <th className="px-3 py-2 w-20 text-right">현재고</th>
                  <th className="px-3 py-2 w-44 text-center">조치</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rows.map((r, i) => {
                  const remain = r.it.qty - r.outbound;
                  const canIssue = remain > 0 && r.stock > 0 && !r.trackSerial;
                  const status =
                    remain <= 0 ? { txt: "출고완료", cls: "text-emerald-600 dark:text-emerald-400 font-bold" }
                    : r.stock <= 0 ? { txt: "재고없음→발주", cls: "text-rose-600 dark:text-rose-400 font-bold" }
                    : r.stock < remain ? { txt: "부분 가능", cls: "text-amber-600 dark:text-amber-400 font-bold" }
                    : { txt: "출고 가능", cls: "text-blue-600 dark:text-blue-400 font-bold" };
                  return (
                    <tr key={r.key} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-3 py-2 text-center text-gray-500">{i + 1}</td>
                      <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-300">{r.it.elevatorName ?? "-"}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-800 dark:text-gray-100">{r.it.materialName}</div>
                        <div className="text-[10px] font-mono text-gray-400">{r.it.materialId}</div>
                        {r.trackSerial && (
                          <div className="text-[10px] text-purple-600 dark:text-purple-300 mt-0.5">⚠️ S/N 추적 자재 — [출고 관리]에서 처리</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-800 dark:text-gray-100 font-medium">{r.it.qty}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-bold">{r.outbound}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-bold ${remain > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400"}`}>{remain}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.stock <= 0 ? "text-rose-500" : "text-gray-700 dark:text-gray-200"}`}>{r.stock}</td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className={`text-[10px] ${status.cls}`}>{status.txt}</span>
                          {admin && req.status !== "완료" && canIssue && (
                            <button type="button" onClick={() => issueOne(r)} disabled={actionKey !== null}
                              className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                              출고{r.stock < remain ? ` ${r.stock}` : ""}
                            </button>
                          )}
                          {admin && req.status !== "완료" && r.stock <= 0 && (
                            <Link href={`/purchase-orders?material=${encodeURIComponent(r.it.materialId)}`}
                              className="px-2 py-0.5 text-[10px] font-bold rounded bg-rose-500 text-white hover:bg-rose-600">
                              발주
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {message && (
            <div className={`mt-4 text-sm px-4 py-3 rounded ${
              message.type === "success" ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                         : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
            }`}>{message.text}</div>
          )}
        </>
      )}
    </div>
  );
}
