import { supabase } from "./supabase";

/**
 * 문서번호 자동 채번 — `?-YY-MM-NNN` 형식 (월 단위 시퀀스 리셋).
 *
 *   B = 발주(purchase_orders.order_no)
 *   I = 입고 · O = 출고 (transactions.transaction_no, type 컬럼으로 구분)
 *
 * 견적(Q-YYYY-NNNN)은 별도 형식·별도 함수로 유지.
 *
 * 동시 입력 시 SELECT MAX + 1 방식이라 race 가능성 존재 — 같은 prefix-YY-MM의
 * 다음 번호를 두 클라이언트가 동시에 가져가면 두 번째 INSERT가 UNIQUE 위반.
 * 호출부는 INSERT 실패 시 1회 재채번 재시도하는 패턴을 권장(현재는 미구현,
 * 견적과 동일한 리스크 수용).
 */

export type DocPrefix = "B" | "I" | "O";

interface ChannelConfig {
  table: "purchase_orders" | "transactions";
  column: "order_no" | "transaction_no";
  /** transactions는 type 컬럼으로 입고/출고 구분이 필요 — prefix 매칭만으로도 충분하지만 인덱스 효율 향상용 */
  typeFilter?: "입고" | "출고";
}

function channelFor(prefix: DocPrefix): ChannelConfig {
  switch (prefix) {
    case "B": return { table: "purchase_orders", column: "order_no" };
    case "I": return { table: "transactions", column: "transaction_no", typeFilter: "입고" };
    case "O": return { table: "transactions", column: "transaction_no", typeFilter: "출고" };
  }
}

function yymmFromDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

/** prefix·일자에 해당하는 다음 채번 문자열을 만든다. */
export async function generateDocNo(prefix: DocPrefix, date: Date | string = new Date()): Promise<string> {
  const yymm = yymmFromDate(date);
  const head = `${prefix}-${yymm}-`;
  const cfg = channelFor(prefix);

  let q = supabase
    .from(cfg.table)
    .select(cfg.column)
    .like(cfg.column, `${head}%`)
    .order(cfg.column, { ascending: false })
    .limit(1);
  if (cfg.typeFilter) q = q.eq("type", cfg.typeFilter);

  const { data } = await q;

  let nextSeq = 1;
  if (data && data.length > 0) {
    const last = (data[0] as Record<string, string>)[cfg.column];
    const m = last?.match(/-(\d+)$/);
    if (m) nextSeq = parseInt(m[1], 10) + 1;
  }
  return `${head}${String(nextSeq).padStart(3, "0")}`;
}
