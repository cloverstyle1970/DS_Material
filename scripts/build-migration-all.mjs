#!/usr/bin/env node
// ============================================================
// ëª¨ë“  migration-*.sql ???˜ì¡´???œì„œ?€ë¡??©ì³ migration-all.sql ?ì„±
// ?¬ìš©: node scripts/build-migration-all.mjs
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ?˜ì¡´???œì„œ?€ë¡?ëª…ì‹œ. ê°?ë§ˆì´ê·¸ë ˆ?´ì…˜?€ idempotent??ì¤‘ë³µ ?¤í–‰ ?ˆì „.
const ORDER = [
  // ?€?€ Phase 0: ?µì‹¬ ?¤í‚¤ë§?ë³´ì • (?¤ë¥¸ ë§ˆì´ê·¸ë ˆ?´ì…˜ë³´ë‹¤ ë¨¼ì? ?¤í–‰) ?€
  "migration-fix-users-id-sequence.sql",          // users.id ?ë™ì±„ë²ˆ ?œí€€??ë³µêµ¬

  // ?€?€ Phase 1: ?…ë¦½ ?Œì´ë¸??€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  "migration-add-dept-rank.sql",                  // departments, ranks
  "migration-add-user-family.sql",                // user_family_members
  "migration-add-user-vehicles.sql",              // user_vehicles
  "migration-add-user-certifications.sql",        // user_certifications + cert-docs bucket
  "migration-add-tbm.sql",                        // TBM ë³¸ì²´
  "migration-add-tbm-storage.sql",                // TBM ?¤í† ë¦¬ì? ë²„í‚·
  "migration-add-tbm-participant-attestation.sql",
  "migration-add-quotes.sql",                     // quotes
  "migration-add-quote-opinion-bucket.sql",
  "migration-material-reference-images.sql",      // materials.reference_image_url1/2 + material-references ë²„í‚·
  "migration-add-uniform-safety-requests.sql",

  // ?€?€ Phase 2: users ì»¬ëŸ¼ ?•ì¥ ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  "migration-add-password.sql",                   // password_hash
  "migration-add-employee-fields.sql",            // photo_url ??+ employee-photos bucket
  "migration-add-user-email.sql",                 // email
  "migration-add-theme.sql",                      // theme

  // ?€?€ Phase 3: family/vehicle ì»¬ëŸ¼ ?•ì¥ ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  "migration-add-user-family-gender.sql",
  "migration-add-vehicle-insurance.sql",
  "migration-add-vehicle-insurance-extra.sql",
  "migration-add-vehicle-history.sql",
  "migration-add-shared-vehicle.sql",

  // ?€?€ Phase 4: ê¶Œí•œ ê·¸ë£¹ + ?¬ì›?±ë¡ ??? ê·œ ì»¬ëŸ¼Â·?Œì´ë¸??€?€?€?€
  "migration-add-permission-groups.sql",
  "migration-add-employee-tabs.sql",              // gender, blood_type, ê²½ë ¥, ?ë²Œ
  "migration-add-user-status-history.sql",        // ?´ì§, ?¬ì…?? ?´ì§ ???íƒœ?´ë ¥
  "migration-add-manuals.sql",                    // ?„ì?ë§?ë§¤ë‰´???¼í„° ?Œì´ë¸?ë°??°ì´??  "migration-add-manual-pdf.sql",                 // ë§¤ë‰´??PDF ?…ë¡œ??pdf_url + manual-docs ë²„í‚·)
  "migration-add-manual-claim.sql",               // ê²¬ì  ë°??ì¬ì²?µ¬ ?±ë¡ ?¬ìš©??ë§¤ë‰´??


  // ?€?€ Phase 5: ?ì¬ ?œë¦¬???Œìˆ˜/?¤í¬???€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  "migration-add-serial-tracking.sql",
  "migration-serial-optional.sql",
  "migration-serial-partial.sql",
  "migration-add-return-tracking.sql",
  "migration-add-unused-return.sql",
  "migration-scrap-unit-rpc.sql",
  "migration-fix-company-type.sql",
  "migration-add-po-ship-info.sql",               // purchase_orders ë°œì†¡ì§€/?©í’ˆ ê¸°ë¡?€
  "migration-add-transaction-batch.sql",          // transactions.batch_id ì»¬ëŸ¼ ë°?RPC ë¬¶ìŒê¸°ëŠ¥
  "migration-add-transaction-price.sql",          // transactions.unit_price ì»¬ëŸ¼ ë°??¨ê? ê¸°ë¡ RPC

  // ?€?€ Phase 6: material_units RLS ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  "migration-disable-rls-material-units.sql",
  "migration-material-units-rls-policies.sql",
];

const banner = (title) =>
  `\n-- ${"=".repeat(60)}\n-- ${title}\n-- ${"=".repeat(60)}\n`;

// CREATE POLICY ì§ì „???™ì¼??DROP POLICY IF EXISTS ê°€ ?†ìœ¼ë©??ë™ ?½ì….
// (?ë³¸ ë§ˆì´ê·¸ë ˆ?´ì…˜ ?¼ë?ê°€ ë¹?idempotent ???µí•© ?¤í–‰ ??ì¶©ëŒ ë°©ì?)
// CREATE POLICY ... ON ???¬ëŸ¬ ì¤„ì— ê±¸ì¹œ ì¼€?´ìŠ¤??ì²˜ë¦¬.
function makePoliciesIdempotent(sql) {
  const dropped = new Set(); // "?•ì±…ëª?|?Œì´ë¸”ëª…"
  let injected = 0;

  // DROP POLICY IF EXISTS ë¨¼ì? ?˜ì§‘ (ë©€?°ë¼???ˆìš©)
  const dropRe = /DROP\s+POLICY\s+IF\s+EXISTS\s+"([^"]+)"\s+ON\s+([\w."]+)/gi;
  let m;
  while ((m = dropRe.exec(sql)) !== null) {
    dropped.add(`${m[1]}||${m[2]}`);
  }

  // CREATE POLICY "name" [ê°œí–‰/ê³µë°± ...] ON <table> ë§¤ì¹­ ?? ì¤??œì‘ ?„ì¹˜??DROP ?½ì…
  const createRe = /(^|\n)([ \t]*)CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+([\w."]+)/gi;
  const result = sql.replace(createRe, (full, lead, indent, name, table) => {
    const key = `${name}||${table}`;
    if (dropped.has(key)) return full;
    dropped.add(key);
    injected++;
    return `${lead}${indent}DROP POLICY IF EXISTS "${name}" ON ${table};\n${indent}CREATE POLICY "${name}" ON ${table}`;
  });

  return { sql: result, injected };
}

let out = `SET client_encoding = 'UTF8';
-- ============================================================
-- ?µí•© ë§ˆì´ê·¸ë ˆ?´ì…˜ ??ëª¨ë“  migration-*.sql ????ë²ˆì— ?¤í–‰
-- ------------------------------------------------------------
-- ?ë™ ?ì„±: scripts/build-migration-all.mjs
-- ëª¨ë“  ë§ˆì´ê·¸ë ˆ?´ì…˜?€ idempotent (IF NOT EXISTS) ???¬ì‹¤???ˆì „.
-- Supabase Dashboard ??SQL Editor ???µì§¸ ë¶™ì—¬?£ê³  Run.
-- ============================================================
`;

let included = 0;
let missing = [];
let totalInjected = 0;

for (const name of ORDER) {
  const filePath = path.join(__dirname, name);
  if (!fs.existsSync(filePath)) {
    missing.push(name);
    continue;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const { sql: body, injected } = makePoliciesIdempotent(raw);
  if (injected > 0) {
    console.log(`  Â· ${name}: DROP POLICY IF EXISTS ${injected}ê±??ë™ ?½ì…`);
  }
  totalInjected += injected;
  out += banner(name);
  out += body.trimEnd() + "\n";
  included++;
}

if (missing.length > 0) {
  console.warn(`[ê²½ê³ ] ?„ë½???Œì¼ ${missing.length}ê°?`);
  for (const m of missing) console.warn("  - " + m);
}

const outPath = path.join(__dirname, "migration-all.sql");
fs.writeFileSync(outPath, out, "utf8");
console.log(`??${included}ê°?ë§ˆì´ê·¸ë ˆ?´ì…˜ ê²°í•© ?„ë£Œ ??${outPath}`);
console.log(`   ?¬ê¸°: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
if (totalInjected > 0) {
  console.log(`   idempotent ë³´ê°•: DROP POLICY IF EXISTS ${totalInjected}ê±??ë™ ?½ì…`);
}
