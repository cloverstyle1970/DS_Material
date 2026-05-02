/**
 * E2E 흐름 테스트 스크립트
 * 실행: node scripts/e2e-test.mjs
 *
 * 실제 업무 시나리오:
 *   1. 로그인 (users 테이블)
 *   2. 자재 검색
 *   3. 자재 신청 생성 → status=신청
 *   4. 발주 등록 → status=발주
 *   5. 입고완료 (RPC) → 재고 증가, status=입고완료
 *   6. 출고처리 (RPC) → 재고 차감, 신청 status=완료
 *   7. 재고 부족 시 출고 방어 확인
 *   8. 정리
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = "https://gwgzzsoknjulwwsmubju.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const B = s => `\x1b[36m${s}\x1b[0m`;
const D = s => `\x1b[90m${s}\x1b[0m`;

let passed = 0, failed = 0;
function ok(label, detail = "")  { passed++; console.log(`  ${G("✓")} ${label}${detail ? `  ${D(detail)}` : ""}`); }
function fail(label, detail = "") { failed++; console.log(`  ${R("✗")} ${label}${detail ? `  ${R("→ "+detail)}` : ""}`); }
function step(n, title)           { console.log(`\n${B(`▶ STEP ${n}`)} ${title}`); }

async function rpc(name, params) {
  const { data, error } = await sb.rpc(name, params);
  if (error) throw new Error(`RPC ${name}: ${error.message}`);
  return data;
}

const cleanup = { txIds: [], requestId: null, orderId: null, matId: null, originalStock: 0 };

async function main() {
  console.log(B("\n══════════════════════════════════════════════"));
  console.log(B("  DS 자재관리 E2E 테스트"));
  console.log(B("══════════════════════════════════════════════"));

  // ── 1. 로그인 ──────────────────────────────────────────────────────────
  step(1, "로그인");
  const { data: users, error: uErr } = await sb
    .from("users").select("id,name,dept,status,permissions").eq("status","재직").limit(10);
  if (uErr || !users?.length) { fail("users 조회 실패", uErr?.message); return; }
  ok(`재직 사용자 ${users.length}명 이상 확인`);
  const me = users.find(u => (u.permissions??[]).includes("admin")) ?? users[0];
  ok(`로그인: ${me.name} (${me.dept ?? "부서없음"})`, `id=${me.id}`);

  // ── 2. 자재 검색 ──────────────────────────────────────────────────────
  step(2, "자재 검색");
  const { data: mats, error: mErr } = await sb
    .from("materials").select("id,name,stock_qty").like("id","D%").limit(5);
  if (mErr || !mats?.length) { fail("자재 조회 실패", mErr?.message); return; }
  const mat = mats[0];
  cleanup.matId = mat.id;
  cleanup.originalStock = mat.stock_qty;
  ok(`자재 선택: [${mat.id}] ${mat.name}`, `현재재고=${mat.stock_qty}`);
  ok(`DS 자재 ${mats.length}건 이상 조회`);

  // ── 3. 자재 신청 생성 ──────────────────────────────────────────────────
  step(3, "자재 신청 생성");
  const { data: req, error: rErr } = await sb.from("material_requests").insert({
    status: "신청", site_name: "E2E테스트현장",
    items: [{ materialId: mat.id, materialName: mat.name, qty: 2, elevatorName: "1호기" }],
    note: "[E2E]", requester_id: me.id, requester_name: me.name, requester_dept: me.dept ?? "",
  }).select().single();
  if (rErr) { fail("신청 생성 실패", rErr.message); return; }
  cleanup.requestId = req.id;
  ok(`신청 생성 완료`, `id=${req.id}  status=${req.status}`);

  // 신청 → 처리중 전환
  await sb.from("material_requests").update({ status: "처리중" }).eq("id", req.id);
  ok("신청 status: 신청 → 처리중");

  // ── 4. 발주 등록 (재고 부족이므로) ─────────────────────────────────────
  step(4, "발주 등록");
  const { data: ord, error: oErr } = await sb.from("purchase_orders").insert({
    status: "발주", material_id: mat.id, material_name: mat.name,
    qty: 10, vendor_name: "E2E테스트거래처", unit_price: 5000,
    request_id: req.id, site_name: "E2E테스트현장", note: "[E2E]",
    user_id: me.id, user_name: me.name,
  }).select().single();
  if (oErr) { fail("발주 등록 실패", oErr.message); return; }
  cleanup.orderId = ord.id;
  ok(`발주 등록 완료`, `id=${ord.id}  qty=10  vendor=E2E테스트거래처`);

  // ── 5. 입고완료 (RPC) ──────────────────────────────────────────────────
  step(5, "입고완료 — 재고 증가 확인");
  let inTx;
  try {
    inTx = await rpc("add_transaction", {
      p_type: "입고", p_material_id: mat.id, p_material_name: mat.name,
      p_qty: 10, p_site_name: null, p_note: `발주 #${ord.id} 입고완료 [E2E]`,
      p_user_id: me.id, p_user_name: me.name,
    });
  } catch (e) { fail("입고 RPC 실패", e.message); return; }
  if (inTx?.error) { fail("입고 처리 오류", inTx.error); return; }
  if (inTx?.record?.id) cleanup.txIds.push(inTx.record.id);
  ok("입고 transaction 생성", `tx.id=${inTx?.record?.id}`);

  const { data: m1 } = await sb.from("materials").select("stock_qty").eq("id",mat.id).single();
  const stockAfterIn = m1?.stock_qty ?? cleanup.originalStock;
  const expectAfterIn = cleanup.originalStock + 10;
  if (stockAfterIn === expectAfterIn)
    ok(`재고 정합성`, `${cleanup.originalStock} → ${stockAfterIn} (+10)`);
  else
    fail(`재고 불일치`, `예상 ${expectAfterIn}, 실제 ${stockAfterIn}`);

  // 발주 status 업데이트
  await sb.from("purchase_orders").update({ status:"입고완료", received_at: new Date().toISOString() }).eq("id",ord.id);
  ok("발주 status → 입고완료");

  // ── 6. 출고처리 (RPC) ──────────────────────────────────────────────────
  step(6, "출고처리 — 재고 차감 확인");
  let outTx;
  try {
    outTx = await rpc("add_transaction", {
      p_type: "출고", p_material_id: mat.id, p_material_name: mat.name,
      p_qty: 2, p_site_name: "E2E테스트현장",
      p_note: `신청 #${req.id} 출고처리 (1호기) [E2E]`,
      p_user_id: me.id, p_user_name: me.name,
    });
  } catch (e) { fail("출고 RPC 실패", e.message); return; }
  if (outTx?.error) { fail("출고 처리 오류", outTx.error); return; }
  if (outTx?.record?.id) cleanup.txIds.push(outTx.record.id);
  ok("출고 transaction 생성", `tx.id=${outTx?.record?.id}`);

  const { data: m2 } = await sb.from("materials").select("stock_qty").eq("id",mat.id).single();
  const stockAfterOut = m2?.stock_qty ?? stockAfterIn;
  const expectAfterOut = stockAfterIn - 2;
  if (stockAfterOut === expectAfterOut)
    ok(`재고 정합성`, `${stockAfterIn} → ${stockAfterOut} (−2)`);
  else
    fail(`재고 불일치`, `예상 ${expectAfterOut}, 실제 ${stockAfterOut}`);

  // 신청 status 완료
  await sb.from("material_requests")
    .update({ status:"완료", processed_at: new Date().toISOString(), processor_id: me.id, processor_name: me.name })
    .eq("id", req.id);
  ok("신청 status → 완료");

  // ── 7. 재고 부족 방어 테스트 ───────────────────────────────────────────
  step(7, "재고 부족 방어 — 현재 재고 초과 출고 시도");
  try {
    const guardTx = await rpc("add_transaction", {
      p_type: "출고", p_material_id: mat.id, p_material_name: mat.name,
      p_qty: stockAfterOut + 99,  // 무조건 재고 초과
      p_site_name: null, p_note: "[E2E 방어테스트]",
      p_user_id: me.id, p_user_name: me.name,
    });
    if (guardTx?.error?.includes("재고 부족")) {
      ok("재고 부족 시 RPC가 에러 반환 (정상 방어)", `현재재고=${stockAfterOut}`);
    } else if (!guardTx?.error) {
      fail("재고 부족 방어 실패 — 음수 재고 허용됨");
    }
  } catch (e) {
    ok("재고 부족 시 예외 발생 (정상 방어)", e.message);
  }

  // ── 8. transaction 이력 확인 ──────────────────────────────────────────
  step(8, "transaction 이력 확인");
  const { data: txLogs, error: txErr } = await sb
    .from("transactions").select("id,type,qty,prev_stock,after_stock,note")
    .eq("material_id", mat.id).like("note","%E2E%").order("created_at");
  if (txErr) fail("transactions 조회 실패", txErr.message);
  else {
    ok(`E2E transaction ${txLogs.length}건`);
    for (const tx of txLogs) {
      const sign = tx.type === "입고" ? G("+"+tx.qty) : R("-"+tx.qty);
      console.log(`     ${Y(tx.type.padEnd(2))}  ${sign}  재고: ${tx.prev_stock}→${tx.after_stock}  ${D(tx.note)}`);
    }
  }

  // ── 9. 데이터 정리 ──────────────────────────────────────────────────────
  step(9, "테스트 데이터 정리");

  if (cleanup.txIds.length) {
    await sb.from("transactions").delete().in("id", cleanup.txIds);
    ok(`transaction ${cleanup.txIds.length}건 삭제`);
  }
  await sb.from("materials").update({ stock_qty: cleanup.originalStock }).eq("id", cleanup.matId);
  ok(`재고 원복`, `→ ${cleanup.originalStock}`);
  if (cleanup.requestId) {
    await sb.from("material_requests").delete().eq("id", cleanup.requestId);
    ok(`신청 #${cleanup.requestId} 삭제`);
  }
  if (cleanup.orderId) {
    await sb.from("purchase_orders").delete().eq("id", cleanup.orderId);
    ok(`발주 #${cleanup.orderId} 삭제`);
  }

  // ── 결과 ──────────────────────────────────────────────────────────────
  console.log(`\n${B("══════════════════════════════════════════════")}`);
  const result = failed === 0 ? G(`ALL PASSED (${passed})`) : R(`FAILED ${failed} / PASSED ${passed}`);
  console.log(` 결과: ${result}`);
  console.log(B("══════════════════════════════════════════════\n"));

  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error(R("\n[FATAL]"), e.message);

  // 실패해도 cleanup 시도
  if (cleanup.matId && cleanup.originalStock !== undefined) {
    sb.from("materials").update({ stock_qty: cleanup.originalStock }).eq("id", cleanup.matId).then(() => {});
  }
  if (cleanup.requestId) sb.from("material_requests").delete().eq("id", cleanup.requestId).then(() => {});
  if (cleanup.orderId)   sb.from("purchase_orders").delete().eq("id", cleanup.orderId).then(() => {});
  if (cleanup.txIds.length) sb.from("transactions").delete().in("id", cleanup.txIds).then(() => {});

  process.exit(1);
});
