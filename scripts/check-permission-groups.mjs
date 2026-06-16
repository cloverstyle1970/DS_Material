// 일회성 점검: permission_groups 7개 시드 이름·구조 확인
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const { data, error, count } = await sb.from('permission_groups').select('*', { count: 'exact' }).order('id');
if (error) { console.error('ERROR:', error); process.exit(1); }
console.log('count=', count, 'rows=', data?.length);
console.dir(data?.slice(0, 3), { depth: 3 });
