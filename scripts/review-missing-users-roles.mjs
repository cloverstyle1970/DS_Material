// 미존재자 role/group_id 매핑 보완 확인
import { sourceClient, targetClient } from "./db-conn.mjs";
const src = await sourceClient(); const tgt = await targetClient();
const acc = new Set((await tgt.query("select username from accounts")).rows.map(r=>r.username));
const r = await src.query(`
  select name, permission_group_id,
    (permissions @> '["admin"]'::jsonb) is_admin,
    jsonb_array_length(coalesce(permissions,'[]'::jsonb)) cnt
  from users order by name`);
const miss = r.rows.filter(u => !acc.has(u.name));
console.log("미존재자 role 매핑 근거:");
for (const u of miss) {
  const g = u.permission_group_id ?? "-";
  console.log(`  ${u.name.padEnd(8)} group=${g} admin=${u.is_admin} perms=${u.cnt}`);
}
const pat = await tgt.query(`
  select role, permission_group_id, count(*)::int n
  from accounts group by role, permission_group_id order by role, permission_group_id`);
console.log("\n기존 accounts (role × group_id):");
for (const x of pat.rows) console.log(`  role=${x.role.padEnd(4)} group=${x.permission_group_id ?? "-"} → ${x.n}명`);
await src.end(); await tgt.end();
