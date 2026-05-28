// permission_groups 테이블 생성 + 7개 그룹 데이터를 구DB→신DB로 이전
// 실행: node --env-file=.env.local scripts/db-migrate-permission-groups.mjs
import { sourceClient, targetClient } from "./db-conn.mjs";

const src = await sourceClient();
const tgt = await targetClient();

// 1) 테이블 + 트리거 + RLS
await tgt.query(`
  CREATE TABLE IF NOT EXISTS permission_groups (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    description     TEXT,
    color           TEXT NOT NULL DEFAULT 'slate',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_system_role  BOOLEAN NOT NULL DEFAULT FALSE,
    permissions     TEXT[] NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);
await tgt.query(`CREATE INDEX IF NOT EXISTS idx_permission_groups_sort ON permission_groups(sort_order);`);
await tgt.query(`ALTER TABLE permission_groups ENABLE ROW LEVEL SECURITY;`);
await tgt.query(`DROP POLICY IF EXISTS allow_all_permission_groups ON permission_groups;`);
await tgt.query(`CREATE POLICY allow_all_permission_groups ON permission_groups FOR ALL USING (TRUE) WITH CHECK (TRUE);`);
await tgt.query(`
  CREATE OR REPLACE FUNCTION trg_permission_groups_updated_at() RETURNS TRIGGER AS $$
  BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
  $$ LANGUAGE plpgsql;`);
await tgt.query(`DROP TRIGGER IF EXISTS permission_groups_updated_at ON permission_groups;`);
await tgt.query(`
  CREATE TRIGGER permission_groups_updated_at
    BEFORE UPDATE ON permission_groups
    FOR EACH ROW EXECUTE FUNCTION trg_permission_groups_updated_at();`);
console.log("✅ permission_groups 테이블 생성/정책/트리거 완료");

// 2) 구DB 그룹 데이터 가져오기
const groups = (await src.query(`select id, name, description, color, sort_order, is_system_role, permissions from permission_groups order by id`)).rows;
console.log(`\n구DB 그룹 ${groups.length}개:`);
for (const g of groups) console.log(`  id=${g.id} ${g.name.padEnd(10)} sort=${g.sort_order} system=${g.is_system_role} perms=${g.permissions?.length ?? 0}`);

// 3) id 보존 INSERT (이미 있으면 스킵)
let inserted = 0;
for (const g of groups) {
  // permissions: PostgreSQL text[] → JS array. pg가 자동 변환.
  const r = await tgt.query(
    `INSERT INTO permission_groups(id, name, description, color, sort_order, is_system_role, permissions)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO NOTHING`,
    [g.id, g.name, g.description, g.color, g.sort_order, g.is_system_role, g.permissions ?? []]
  );
  if (r.rowCount > 0) inserted++;
}
console.log(`\n${inserted}건 신규 삽입 (나머지는 이미 존재)`);

// 4) 시퀀스 동기화
await tgt.query(`SELECT setval(pg_get_serial_sequence('permission_groups','id'), COALESCE((SELECT MAX(id) FROM permission_groups), 1))`);
console.log("✅ id 시퀀스 동기화");

// 5) 검증
const after = (await tgt.query(`select id, name, sort_order, array_length(permissions,1) cnt from permission_groups order by sort_order`)).rows;
console.log("\n신DB permission_groups:");
for (const g of after) console.log(`  id=${g.id} ${g.name.padEnd(10)} sort=${g.sort_order} perms=${g.cnt ?? 0}`);

await src.end(); await tgt.end();
