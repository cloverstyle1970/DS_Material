// 점검: accounts.permissions 분포 — admin/그외 카운트 확인
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const { data, error } = await sb.from('accounts').select('id,permissions');
if (error) { console.error(error); process.exit(1); }
let admin=0, nonAdminWithPerms=0, empty=0;
const sample = [];
for (const r of data) {
  const p = r.permissions ?? [];
  if (p.includes('admin')) admin++;
  else if (p.length > 0) { nonAdminWithPerms++; if (sample.length < 3) sample.push({id:r.id,perms:p.slice(0,5),total:p.length}); }
  else empty++;
}
console.log('total=', data.length, 'admin=', admin, 'non-admin-w-perms=', nonAdminWithPerms, 'empty=', empty);
console.dir(sample, { depth: 3 });
