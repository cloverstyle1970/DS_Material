// 앱 스토리지 버킷 8개 생성(public) + storage.objects 정책(anon 업로드/읽기/삭제)
// 실행: node --env-file=.env.local scripts/db-create-buckets.mjs
import { targetClient } from "./db-conn.mjs";
const c = await targetClient();

const BUCKETS = [
  "material-references", "material-opinions", "employee-photos", "cert-docs",
  "vehicle-docs", "manual-docs", "tbm-photos", "company-assets",
];

// 1) 버킷 생성 (public=true), 이미 있으면 public 보장
for (const b of BUCKETS) {
  await c.query(
    `INSERT INTO storage.buckets(id, name, public) VALUES($1,$1,true)
     ON CONFLICT (id) DO UPDATE SET public = true`, [b]);
}
console.log(`✅ 버킷 ${BUCKETS.length}개 생성/보장 (public)`);

// 2) storage.objects 정책 — 앱 버킷에 대해 public(anon 포함) 전체 허용
const list = BUCKETS.map(b => `'${b}'`).join(",");
const policies = [
  ["app_buckets_select", "SELECT", `USING (bucket_id IN (${list}))`],
  ["app_buckets_insert", "INSERT", `WITH CHECK (bucket_id IN (${list}))`],
  ["app_buckets_update", "UPDATE", `USING (bucket_id IN (${list})) WITH CHECK (bucket_id IN (${list}))`],
  ["app_buckets_delete", "DELETE", `USING (bucket_id IN (${list}))`],
];
for (const [name, cmd, clause] of policies) {
  await c.query(`DROP POLICY IF EXISTS ${name} ON storage.objects`);
  await c.query(`CREATE POLICY ${name} ON storage.objects FOR ${cmd} TO public ${clause}`);
}
console.log("✅ storage.objects 정책 4종(SELECT/INSERT/UPDATE/DELETE) 생성");

// 3) 검증
const b = await c.query(`select id, public from storage.buckets where id = ANY($1) order by id`, [BUCKETS]);
console.log("\n신DB 버킷:");
for (const x of b.rows) console.log(`  ${x.id.padEnd(20)} public=${x.public}`);

await c.end();
