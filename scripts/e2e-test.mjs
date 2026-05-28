/**
 * E2E ?ë¦„ ?ŒìŠ¤???¤í¬ë¦½íŠ¸
 * ?¤í–‰: node scripts/e2e-test.mjs
 *
 * ?¤ì œ ?…ë¬´ ?œë‚˜ë¦¬ì˜¤:
 *   1. ë¡œê·¸??(users ?Œì´ë¸?
 *   2. ?ìž¬ ê²€?? *   3. ?ìž¬ ? ì²­ ?ì„± ??status=? ì²­
 *   4. ë°œì£¼ ?±ë¡ ??status=ë°œì£¼
 *   5. ?…ê³ ?„ë£Œ (RPC) ???¬ê³  ì¦ê?, status=?…ê³ ?„ë£Œ
 *   6. ì¶œê³ ì²˜ë¦¬ (RPC) ???¬ê³  ì°¨ê°, ? ì²­ status=?„ë£Œ
 *   7. ?¬ê³  ë¶€ì¡???ì¶œê³  ë°©ì–´ ?•ì¸
 *   8. ?•ë¦¬
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = "https://bbnmxwpacdfqvicybhau.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const B = s => `\x1b[36m${s}\x1b[0m`;
const D = s => `\x1b[90m${s}\x1b[0m`;

let passed = 0, failed = 0;
function ok(label, detail = "")  { passed++; console.log(`  ${G("??)} ${label}${detail ? `  ${D(detail)}` : ""}`); }
function fail(label, detail = "") { failed++; console.log(`  ${R("??)} ${label}${detail ? `  ${R("??"+detail)}` : ""}`); }
function step(n, title)           { console.log(`\n${B(`??STEP ${n}`)} ${title}`); }

async function rpc(name, params) {
  const { data, error } = await sb.rpc(name, params);
  if (error) throw new Error(`RPC ${name}: ${error.message}`);
  return data;
}

const cleanup = { txIds: [], requestId: null, orderId: null, matId: null, originalStock: 0 };

async function main() {
  console.log(B("\n?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•"));
  console.log(B("  DS ?ìž¬ê´€ë¦?E2E ?ŒìŠ¤??));
  console.log(B("?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•"));

  // ?€?€ 1. ë¡œê·¸???€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  step(1, "ë¡œê·¸??);
  const { data: users, error: uErr } = await sb
    .from("users").select("id,name,dept,status,permissions").eq("status","?¬ì§").limit(10);
  if (uErr || !users?.length) { fail("users ì¡°íšŒ ?¤íŒ¨", uErr?.message); return; }
  ok(`?¬ì§ ?¬ìš©??${users.length}ëª??´ìƒ ?•ì¸`);
  const me = users.find(u => (u.permissions??[]).includes("admin")) ?? users[0];
  ok(`ë¡œê·¸?? ${me.name} (${me.dept ?? "ë¶€?œì—†??})`, `id=${me.id}`);

  // ?€?€ 2. ?ìž¬ ê²€???€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  step(2, "?ìž¬ ê²€??);
  const { data: mats, error: mErr } = await sb
    .from("materials").select("id,name,stock_qty").like("id","D%").limit(5);
  if (mErr || !mats?.length) { fail("?ìž¬ ì¡°íšŒ ?¤íŒ¨", mErr?.message); return; }
  const mat = mats[0];
  cleanup.matId = mat.id;
  cleanup.originalStock = mat.stock_qty;
  ok(`?ìž¬ ? íƒ: [${mat.id}] ${mat.name}`, `?„ìž¬?¬ê³ =${mat.stock_qty}`);
  ok(`DS ?ìž¬ ${mats.length}ê±??´ìƒ ì¡°íšŒ`);

  // ?€?€ 3. ?ìž¬ ? ì²­ ?ì„± ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  step(3, "?ìž¬ ? ì²­ ?ì„±");
  const { data: req, error: rErr } = await sb.from("material_requests").insert({
    status: "? ì²­", site_name: "E2E?ŒìŠ¤?¸í˜„??,
    items: [{ materialId: mat.id, materialName: mat.name, qty: 2, elevatorName: "1?¸ê¸°" }],
    note: "[E2E]", requester_id: me.id, requester_name: me.name, requester_dept: me.dept ?? "",
  }).select().single();
  if (rErr) { fail("? ì²­ ?ì„± ?¤íŒ¨", rErr.message); return; }
  cleanup.requestId = req.id;
  ok(`? ì²­ ?ì„± ?„ë£Œ`, `id=${req.id}  status=${req.status}`);

  // ? ì²­ ??ì²˜ë¦¬ì¤??„í™˜
  await sb.from("material_requests").update({ status: "ì²˜ë¦¬ì¤? }).eq("id", req.id);
  ok("? ì²­ status: ? ì²­ ??ì²˜ë¦¬ì¤?);

  // ?€?€ 4. ë°œì£¼ ?±ë¡ (?¬ê³  ë¶€ì¡±ì´ë¯€ë¡? ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  step(4, "ë°œì£¼ ?±ë¡");
  const { data: ord, error: oErr } = await sb.from("purchase_orders").insert({
    status: "ë°œì£¼", material_id: mat.id, material_name: mat.name,
    qty: 10, vendor_name: "E2E?ŒìŠ¤?¸ê±°?˜ì²˜", unit_price: 5000,
    request_id: req.id, site_name: "E2E?ŒìŠ¤?¸í˜„??, note: "[E2E]",
    user_id: me.id, user_name: me.name,
  }).select().single();
  if (oErr) { fail("ë°œì£¼ ?±ë¡ ?¤íŒ¨", oErr.message); return; }
  cleanup.orderId = ord.id;
  ok(`ë°œì£¼ ?±ë¡ ?„ë£Œ`, `id=${ord.id}  qty=10  vendor=E2E?ŒìŠ¤?¸ê±°?˜ì²˜`);

  // ?€?€ 5. ?…ê³ ?„ë£Œ (RPC) ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  step(5, "?…ê³ ?„ë£Œ ???¬ê³  ì¦ê? ?•ì¸");
  let inTx;
  try {
    inTx = await rpc("add_transaction", {
      p_type: "?…ê³ ", p_material_id: mat.id, p_material_name: mat.name,
      p_qty: 10, p_site_name: null, p_note: `ë°œì£¼ #${ord.id} ?…ê³ ?„ë£Œ [E2E]`,
      p_user_id: me.id, p_user_name: me.name,
    });
  } catch (e) { fail("?…ê³  RPC ?¤íŒ¨", e.message); return; }
  if (inTx?.error) { fail("?…ê³  ì²˜ë¦¬ ?¤ë¥˜", inTx.error); return; }
  if (inTx?.record?.id) cleanup.txIds.push(inTx.record.id);
  ok("?…ê³  transaction ?ì„±", `tx.id=${inTx?.record?.id}`);

  const { data: m1 } = await sb.from("materials").select("stock_qty").eq("id",mat.id).single();
  const stockAfterIn = m1?.stock_qty ?? cleanup.originalStock;
  const expectAfterIn = cleanup.originalStock + 10;
  if (stockAfterIn === expectAfterIn)
    ok(`?¬ê³  ?•í•©??, `${cleanup.originalStock} ??${stockAfterIn} (+10)`);
  else
    fail(`?¬ê³  ë¶ˆì¼ì¹?, `?ˆìƒ ${expectAfterIn}, ?¤ì œ ${stockAfterIn}`);

  // ë°œì£¼ status ?…ë°?´íŠ¸
  await sb.from("purchase_orders").update({ status:"?…ê³ ?„ë£Œ", received_at: new Date().toISOString() }).eq("id",ord.id);
  ok("ë°œì£¼ status ???…ê³ ?„ë£Œ");

  // ?€?€ 6. ì¶œê³ ì²˜ë¦¬ (RPC) ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  step(6, "ì¶œê³ ì²˜ë¦¬ ???¬ê³  ì°¨ê° ?•ì¸");
  let outTx;
  try {
    outTx = await rpc("add_transaction", {
      p_type: "ì¶œê³ ", p_material_id: mat.id, p_material_name: mat.name,
      p_qty: 2, p_site_name: "E2E?ŒìŠ¤?¸í˜„??,
      p_note: `? ì²­ #${req.id} ì¶œê³ ì²˜ë¦¬ (1?¸ê¸°) [E2E]`,
      p_user_id: me.id, p_user_name: me.name,
    });
  } catch (e) { fail("ì¶œê³  RPC ?¤íŒ¨", e.message); return; }
  if (outTx?.error) { fail("ì¶œê³  ì²˜ë¦¬ ?¤ë¥˜", outTx.error); return; }
  if (outTx?.record?.id) cleanup.txIds.push(outTx.record.id);
  ok("ì¶œê³  transaction ?ì„±", `tx.id=${outTx?.record?.id}`);

  const { data: m2 } = await sb.from("materials").select("stock_qty").eq("id",mat.id).single();
  const stockAfterOut = m2?.stock_qty ?? stockAfterIn;
  const expectAfterOut = stockAfterIn - 2;
  if (stockAfterOut === expectAfterOut)
    ok(`?¬ê³  ?•í•©??, `${stockAfterIn} ??${stockAfterOut} (??)`);
  else
    fail(`?¬ê³  ë¶ˆì¼ì¹?, `?ˆìƒ ${expectAfterOut}, ?¤ì œ ${stockAfterOut}`);

  // ? ì²­ status ?„ë£Œ
  await sb.from("material_requests")
    .update({ status:"?„ë£Œ", processed_at: new Date().toISOString(), processor_id: me.id, processor_name: me.name })
    .eq("id", req.id);
  ok("? ì²­ status ???„ë£Œ");

  // ?€?€ 7. ?¬ê³  ë¶€ì¡?ë°©ì–´ ?ŒìŠ¤???€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  step(7, "?¬ê³  ë¶€ì¡?ë°©ì–´ ???„ìž¬ ?¬ê³  ì´ˆê³¼ ì¶œê³  ?œë„");
  try {
    const guardTx = await rpc("add_transaction", {
      p_type: "ì¶œê³ ", p_material_id: mat.id, p_material_name: mat.name,
      p_qty: stockAfterOut + 99,  // ë¬´ì¡°ê±??¬ê³  ì´ˆê³¼
      p_site_name: null, p_note: "[E2E ë°©ì–´?ŒìŠ¤??",
      p_user_id: me.id, p_user_name: me.name,
    });
    if (guardTx?.error?.includes("?¬ê³  ë¶€ì¡?)) {
      ok("?¬ê³  ë¶€ì¡???RPCê°€ ?ëŸ¬ ë°˜í™˜ (?•ìƒ ë°©ì–´)", `?„ìž¬?¬ê³ =${stockAfterOut}`);
    } else if (!guardTx?.error) {
      fail("?¬ê³  ë¶€ì¡?ë°©ì–´ ?¤íŒ¨ ???Œìˆ˜ ?¬ê³  ?ˆìš©??);
    }
  } catch (e) {
    ok("?¬ê³  ë¶€ì¡????ˆì™¸ ë°œìƒ (?•ìƒ ë°©ì–´)", e.message);
  }

  // ?€?€ 8. transaction ?´ë ¥ ?•ì¸ ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  step(8, "transaction ?´ë ¥ ?•ì¸");
  const { data: txLogs, error: txErr } = await sb
    .from("transactions").select("id,type,qty,prev_stock,after_stock,note")
    .eq("material_id", mat.id).like("note","%E2E%").order("created_at");
  if (txErr) fail("transactions ì¡°íšŒ ?¤íŒ¨", txErr.message);
  else {
    ok(`E2E transaction ${txLogs.length}ê±?);
    for (const tx of txLogs) {
      const sign = tx.type === "?…ê³ " ? G("+"+tx.qty) : R("-"+tx.qty);
      console.log(`     ${Y(tx.type.padEnd(2))}  ${sign}  ?¬ê³ : ${tx.prev_stock}??{tx.after_stock}  ${D(tx.note)}`);
    }
  }

  // ?€?€ 9. ?°ì´???•ë¦¬ ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  step(9, "?ŒìŠ¤???°ì´???•ë¦¬");

  if (cleanup.txIds.length) {
    await sb.from("transactions").delete().in("id", cleanup.txIds);
    ok(`transaction ${cleanup.txIds.length}ê±??? œ`);
  }
  await sb.from("materials").update({ stock_qty: cleanup.originalStock }).eq("id", cleanup.matId);
  ok(`?¬ê³  ?ë³µ`, `??${cleanup.originalStock}`);
  if (cleanup.requestId) {
    await sb.from("material_requests").delete().eq("id", cleanup.requestId);
    ok(`? ì²­ #${cleanup.requestId} ?? œ`);
  }
  if (cleanup.orderId) {
    await sb.from("purchase_orders").delete().eq("id", cleanup.orderId);
    ok(`ë°œì£¼ #${cleanup.orderId} ?? œ`);
  }

  // ?€?€ ê²°ê³¼ ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  console.log(`\n${B("?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•")}`);
  const result = failed === 0 ? G(`ALL PASSED (${passed})`) : R(`FAILED ${failed} / PASSED ${passed}`);
  console.log(` ê²°ê³¼: ${result}`);
  console.log(B("?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•\n"));

  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error(R("\n[FATAL]"), e.message);

  // ?¤íŒ¨?´ë„ cleanup ?œë„
  if (cleanup.matId && cleanup.originalStock !== undefined) {
    sb.from("materials").update({ stock_qty: cleanup.originalStock }).eq("id", cleanup.matId).then(() => {});
  }
  if (cleanup.requestId) sb.from("material_requests").delete().eq("id", cleanup.requestId).then(() => {});
  if (cleanup.orderId)   sb.from("purchase_orders").delete().eq("id", cleanup.orderId).then(() => {});
  if (cleanup.txIds.length) sb.from("transactions").delete().in("id", cleanup.txIds).then(() => {});

  process.exit(1);
});
