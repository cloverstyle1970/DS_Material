// 일회성 진단: push_subscriptions 테이블과 accounts.push_enabled / notifications_enabled 컬럼 존재 확인
// 사용: node --env-file=.env.local scripts/check-push-schema.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, key);

async function probe(label, fn) {
  try { const r = await fn(); console.log(label, '✓', JSON.stringify(r).slice(0, 200)); }
  catch (e) { console.log(label, '✗', e?.message ?? e); }
}

// 실제 모든 컬럼 조회 — Supabase는 select(*)로 1행이라도 있으면 컬럼명을 노출
await probe('push_subscriptions(*) 1행 샘플', () =>
  sb.from('push_subscriptions').select('*').limit(1).then(r => {
    if (r.error) throw new Error(r.error.message + ' [code ' + (r.error.code||'-') + ']');
    return { rowCount: r.data?.length ?? 0, sample: r.data?.[0] ?? null };
  })
);

// 키 컬럼 후보 추가 확인
const candidates = [
  'keys','subscription','subscription_json','data',
  'p256dh_key','auth_key','p256dh_token','auth_secret',
  'public_key','auth_token',
  'expirationTime','expiration_time',
  'device_label','device_name','label'
];
for (const col of candidates) {
  await probe(`push_subscriptions.${col}`, () =>
    sb.from('push_subscriptions').select(`id,${col}`).limit(1).then(r => {
      if (r.error) throw new Error(r.error.message);
      return { ok: true };
    })
  );
}

await probe('accounts.push_enabled', () =>
  sb.from('accounts').select('id,push_enabled').limit(1).then(r => {
    if (r.error) throw new Error(r.error.message);
    return r.data?.[0] ?? {};
  })
);

await probe('accounts.notifications_enabled', () =>
  sb.from('accounts').select('id,notifications_enabled').limit(1).then(r => {
    if (r.error) throw new Error(r.error.message);
    return r.data?.[0] ?? {};
  })
);
