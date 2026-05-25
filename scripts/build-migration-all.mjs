#!/usr/bin/env node
// ============================================================
// 모든 migration-*.sql 을 의존성 순서대로 합쳐 migration-all.sql 생성
// 사용: node scripts/build-migration-all.mjs
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 의존성 순서대로 명시. 각 마이그레이션은 idempotent라 중복 실행 안전.
const ORDER = [
  // ── Phase 0: 핵심 스키마 보정 (다른 마이그레이션보다 먼저 실행) ─
  "migration-fix-users-id-sequence.sql",          // users.id 자동채번 시퀀스 복구

  // ── Phase 1: 독립 테이블 ─────────────────────────────────
  "migration-add-dept-rank.sql",                  // departments, ranks
  "migration-add-user-family.sql",                // user_family_members
  "migration-add-user-vehicles.sql",              // user_vehicles
  "migration-add-user-certifications.sql",        // user_certifications + cert-docs bucket
  "migration-add-tbm.sql",                        // TBM 본체
  "migration-add-tbm-storage.sql",                // TBM 스토리지 버킷
  "migration-add-tbm-participant-attestation.sql",
  "migration-add-quotes.sql",                     // quotes
  "migration-add-quote-opinion-bucket.sql",
  "migration-add-uniform-safety-requests.sql",

  // ── Phase 2: users 컬럼 확장 ─────────────────────────────
  "migration-add-password.sql",                   // password_hash
  "migration-add-employee-fields.sql",            // photo_url 등 + employee-photos bucket
  "migration-add-user-email.sql",                 // email
  "migration-add-theme.sql",                      // theme

  // ── Phase 3: family/vehicle 컬럼 확장 ────────────────────
  "migration-add-user-family-gender.sql",
  "migration-add-vehicle-insurance.sql",
  "migration-add-vehicle-insurance-extra.sql",
  "migration-add-vehicle-history.sql",
  "migration-add-shared-vehicle.sql",

  // ── Phase 4: 권한 그룹 + 사원등록 탭 신규 컬럼·테이블 ────
  "migration-add-permission-groups.sql",
  "migration-add-employee-tabs.sql",              // gender, blood_type, 경력, 상벌
  "migration-add-user-status-history.sql",        // 퇴직, 재입사, 휴직 등 상태이력
  "migration-add-manuals.sql",                    // 도움말/매뉴얼 센터 테이블 및 데이터



  // ── Phase 5: 자재 시리얼/회수/스크랩 ────────────────────
  "migration-add-serial-tracking.sql",
  "migration-serial-optional.sql",
  "migration-serial-partial.sql",
  "migration-add-return-tracking.sql",
  "migration-add-unused-return.sql",
  "migration-scrap-unit-rpc.sql",
  "migration-fix-company-type.sql",

  // ── Phase 6: material_units RLS ─────────────────────────
  "migration-disable-rls-material-units.sql",
  "migration-material-units-rls-policies.sql",
];

const banner = (title) =>
  `\n-- ${"=".repeat(60)}\n-- ${title}\n-- ${"=".repeat(60)}\n`;

// CREATE POLICY 직전에 동일한 DROP POLICY IF EXISTS 가 없으면 자동 삽입.
// (원본 마이그레이션 일부가 비-idempotent — 통합 실행 시 충돌 방지)
// CREATE POLICY ... ON 이 여러 줄에 걸친 케이스도 처리.
function makePoliciesIdempotent(sql) {
  const dropped = new Set(); // "정책명||테이블명"
  let injected = 0;

  // DROP POLICY IF EXISTS 먼저 수집 (멀티라인 허용)
  const dropRe = /DROP\s+POLICY\s+IF\s+EXISTS\s+"([^"]+)"\s+ON\s+([\w."]+)/gi;
  let m;
  while ((m = dropRe.exec(sql)) !== null) {
    dropped.add(`${m[1]}||${m[2]}`);
  }

  // CREATE POLICY "name" [개행/공백 ...] ON <table> 매칭 후, 줄 시작 위치에 DROP 삽입
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

let out = `-- ============================================================
-- 통합 마이그레이션 — 모든 migration-*.sql 을 한 번에 실행
-- ------------------------------------------------------------
-- 자동 생성: scripts/build-migration-all.mjs
-- 모든 마이그레이션은 idempotent (IF NOT EXISTS) — 재실행 안전.
-- Supabase Dashboard → SQL Editor 에 통째 붙여넣고 Run.
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
    console.log(`  · ${name}: DROP POLICY IF EXISTS ${injected}건 자동 삽입`);
  }
  totalInjected += injected;
  out += banner(name);
  out += body.trimEnd() + "\n";
  included++;
}

if (missing.length > 0) {
  console.warn(`[경고] 누락된 파일 ${missing.length}개:`);
  for (const m of missing) console.warn("  - " + m);
}

const outPath = path.join(__dirname, "migration-all.sql");
fs.writeFileSync(outPath, out, "utf8");
console.log(`✅ ${included}개 마이그레이션 결합 완료 → ${outPath}`);
console.log(`   크기: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
if (totalInjected > 0) {
  console.log(`   idempotent 보강: DROP POLICY IF EXISTS ${totalInjected}건 자동 삽입`);
}
