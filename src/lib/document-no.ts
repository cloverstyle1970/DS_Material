import { supabase } from "./supabase";

/**
 * 문서번호 자동 채번 — `?-YY-MM-NNN` (월 단위) · 견적은 `Q-YYYY-NNNN` (연 단위).
 *
 *   B = 발주(purchase_orders.order_no)
 *   I = 입고 · O = 출고 (transactions.transaction_no, type 컬럼으로 구분)
 *   Q = 견적(quotes.quote_no)
 *
 * 채번은 DB 함수 `next_doc_no(prefix, date)` 가 advisory_xact_lock + doc_seq
 * 카운터 테이블로 직렬화한다. 동시 호출 race 없음.
 */

export type DocPrefix = "B" | "I" | "O" | "Q";

export async function generateDocNo(prefix: DocPrefix, date: Date | string = new Date()): Promise<string> {
  const d = typeof date === "string" ? date.slice(0, 10) : date.toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc("next_doc_no", { p_prefix: prefix, p_date: d });
  if (error) throw new Error(`문서번호 채번 실패: ${error.message}`);
  if (typeof data !== "string") throw new Error("문서번호 채번 응답 형식 오류");
  return data;
}
