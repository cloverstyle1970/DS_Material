"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtNum } from "@/lib/format";

// ============================================================
// 타입
// ============================================================

interface QuoteRow {
  id: number;
  quote_no: string;
  quote_date: string;
  total_amount: number;
  status: "작성중" | "발행" | "승인" | "취소";
  progress_state: "미시작" | "자재신청" | "자재출고" | "세금계산서발급" | "입금완료" | "종료";
  charge_type: "유상" | "무상";
  created_by_id: number | null;
  created_by_name: string | null;
}

interface PaymentRow {
  quote_id: number;
  amount: number;
  status: "확정" | "취소";
}

type Period = "월" | "분기" | "년";

interface Agg {
  userId: number;
  userName: string;
  count: number;        // 견적 건수
  sales: number;        // 매출 (견적 total_amount 합) - 승인 이상만
  paid: number;         // 입금 합계
  receivable: number;   // 미수금
}

// ============================================================
// 기간 헬퍼
// ============================================================

function todayISO() { return new Date().toISOString().slice(0, 10); }

function periodRange(period: Period, anchor: string): { from: string; to: string; label: string } {
  // anchor 는 YYYY-MM-DD 또는 YYYY-MM 또는 YYYY-Q1 등으로 받음. 단순화: anchor 는 YYYY-MM-DD 로 통일.
  const d = new Date(anchor);
  if (period === "월") {
    const y = d.getFullYear(), m = d.getMonth();
    const from = new Date(y, m, 1);
    const to = new Date(y, m + 1, 0);
    return {
      from: from.toISOString().slice(0, 10),
      to:   to.toISOString().slice(0, 10),
      label: `${y}년 ${m + 1}월`,
    };
  }
  if (period === "분기") {
    const y = d.getFullYear(), q = Math.floor(d.getMonth() / 3);
    const from = new Date(y, q * 3, 1);
    const to = new Date(y, q * 3 + 3, 0);
    return {
      from: from.toISOString().slice(0, 10),
      to:   to.toISOString().slice(0, 10),
      label: `${y}년 ${q + 1}분기`,
    };
  }
  // 년
  const y = d.getFullYear();
  return {
    from: `${y}-01-01`,
    to:   `${y}-12-31`,
    label: `${y}년`,
  };
}

function shiftAnchor(period: Period, anchor: string, dir: -1 | 1): string {
  const d = new Date(anchor);
  if (period === "월") d.setMonth(d.getMonth() + dir);
  else if (period === "분기") d.setMonth(d.getMonth() + dir * 3);
  else d.setFullYear(d.getFullYear() + dir);
  return d.toISOString().slice(0, 10);
}

// ============================================================
// 메인
// ============================================================

export default function PerformanceStatsClient() {
  const [period, setPeriod] = useState<Period>("월");
  const [anchor, setAnchor] = useState<string>(todayISO());
  const [includeMode, setIncludeMode] = useState<"매출확정" | "전체">("매출확정");
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => periodRange(period, anchor), [period, anchor]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: qs } = await supabase.from("quotes")
        .select("id, quote_no, quote_date, total_amount, status, progress_state, charge_type, created_by_id, created_by_name")
        .gte("quote_date", range.from)
        .lte("quote_date", range.to)
        .order("quote_date", { ascending: false });
      const qList = (qs ?? []) as QuoteRow[];
      setQuotes(qList);

      const quoteIds = qList.map(q => q.id);
      if (quoteIds.length === 0) { setPayments([]); setLoading(false); return; }
      const { data: ps } = await supabase.from("payments")
        .select("quote_id, amount, status")
        .in("quote_id", quoteIds);
      setPayments((ps ?? []) as PaymentRow[]);
      setLoading(false);
    })();
  }, [range.from, range.to]);

  // 사원별 집계
  const aggs: Agg[] = useMemo(() => {
    const filtered = quotes.filter(q => {
      if (q.charge_type === "무상") return false;       // 무상은 매출 X
      if (includeMode === "매출확정") {
        // 승인 + 자재출고 이후만 집계 (작성중/발행/취소 제외)
        if (q.status !== "승인") return false;
        return q.progress_state === "자재출고" || q.progress_state === "세금계산서발급" || q.progress_state === "입금완료" || q.progress_state === "종료";
      }
      return q.status !== "취소";
    });

    const paidMap = new Map<number, number>();
    payments.forEach(p => {
      if (p.status !== "확정") return;
      paidMap.set(p.quote_id, (paidMap.get(p.quote_id) ?? 0) + p.amount);
    });

    const map = new Map<number, Agg>();
    filtered.forEach(q => {
      const uid = q.created_by_id ?? 0;
      const uname = q.created_by_name ?? "(미지정)";
      const cur = map.get(uid) ?? { userId: uid, userName: uname, count: 0, sales: 0, paid: 0, receivable: 0 };
      cur.count += 1;
      cur.sales += q.total_amount;
      cur.paid  += paidMap.get(q.id) ?? 0;
      cur.receivable = cur.sales - cur.paid;
      map.set(uid, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
  }, [quotes, payments, includeMode]);

  const totalSales = aggs.reduce((s, a) => s + a.sales, 0);
  const totalCount = aggs.reduce((s, a) => s + a.count, 0);
  const totalPaid  = aggs.reduce((s, a) => s + a.paid, 0);

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900 p-6">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">📈 사원 실적 (매출)</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">견적 작성자 기준 매출 집계. 무상 견적·취소 제외. 견적일자 기준.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 기간 토글 */}
          <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 p-0.5 rounded">
            {(["월", "분기", "년"] as Period[]).map(p => (
              <button key={p} type="button" onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs font-bold rounded transition-colors ${
                  period === p ? "bg-blue-600 text-white"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}>{p}</button>
            ))}
          </div>
          {/* 기간 이동 */}
          <div className="flex items-center gap-1 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
            <button type="button" onClick={() => setAnchor(shiftAnchor(period, anchor, -1))}
              className="text-gray-500 hover:text-blue-600 px-1">◀</button>
            <span className="text-xs font-bold text-gray-700 dark:text-gray-200 min-w-[80px] text-center">{range.label}</span>
            <button type="button" onClick={() => setAnchor(shiftAnchor(period, anchor, 1))}
              className="text-gray-500 hover:text-blue-600 px-1">▶</button>
          </div>
          <button type="button" onClick={() => setAnchor(todayISO())}
            className="text-[11px] px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200">오늘</button>
          {/* 포함 범위 토글 */}
          <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 p-0.5 rounded">
            {(["매출확정", "전체"] as const).map(m => (
              <button key={m} type="button" onClick={() => setIncludeMode(m)}
                title={m === "매출확정" ? "승인 + 자재출고 이후 견적만 (실제 매출)" : "취소 제외 전체 견적"}
                className={`px-3 py-1 text-xs font-bold rounded transition-colors ${
                  includeMode === m ? "bg-emerald-600 text-white"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}>{m}</button>
            ))}
          </div>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Card label="견적 건수" value={fmtNum(totalCount)} sub={`${aggs.length}명`} color="blue" />
        <Card label="매출 합계" value={`${fmtNum(totalSales)}원`} color="emerald" />
        <Card label="입금 합계" value={`${fmtNum(totalPaid)}원`} color="amber" />
        <Card label="미수금" value={`${fmtNum(totalSales - totalPaid)}원`} color="rose" />
      </div>

      {/* 실적 표 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-340px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400">
                <th className="px-3 py-2 w-12 text-center">순위</th>
                <th className="px-3 py-2">사원</th>
                <th className="px-3 py-2 text-right">건수</th>
                <th className="px-3 py-2 text-right">매출</th>
                <th className="px-3 py-2 text-right">입금</th>
                <th className="px-3 py-2 text-right">미수금</th>
                <th className="px-3 py-2 text-right w-32">달성률</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-500">로딩 중...</td></tr>
              ) : aggs.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400">집계할 견적이 없습니다.</td></tr>
              ) : aggs.map((a, i) => {
                const pct = totalSales === 0 ? 0 : Math.round((a.sales / totalSales) * 100);
                return (
                  <tr key={a.userId} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-3 py-2 text-center font-bold">
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (
                        <span className="text-xs text-gray-500">{i + 1}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100">{a.userName}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{fmtNum(a.count)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-600 dark:text-emerald-400">{fmtNum(a.sales)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{fmtNum(a.paid)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${a.receivable > 0 ? "text-rose-500" : "text-gray-400"}`}>{fmtNum(a.receivable)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded bg-gray-100 dark:bg-gray-700 overflow-hidden">
                          <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[11px] font-bold w-10 text-right tabular-nums text-gray-600 dark:text-gray-300">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, sub, color }: { label: string; value: string; sub?: string; color: "blue" | "emerald" | "amber" | "rose" }) {
  const colorCls =
    color === "blue"    ? "border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30" :
    color === "emerald" ? "border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30" :
    color === "amber"   ? "border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30" :
                          "border-rose-200 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/30";
  return (
    <div className={`rounded-xl border p-4 ${colorCls}`}>
      <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">{label}</div>
      <div className="text-xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
