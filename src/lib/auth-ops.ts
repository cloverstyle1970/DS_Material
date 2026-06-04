import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";

// 유지보수 사이트(daesol-sketch.github.io)와 공유되는 Edge Function.
// auth.users(이메일 키 = `${account_id}@daesol.el`) 측 비번/계정을 service role 권한으로 갱신한다.
// 자재관리는 accounts.password(평문)만 직접 다루므로, 유지보수의 Supabase Auth 인증을
// 같이 살려두려면 비번 변경·신규 등록 시 반드시 이 함수를 호출해야 한다.
const ADMIN_AUTH_OPS_URL = `${SUPABASE_URL}/functions/v1/admin-auth-ops`;

type Action = "create" | "change_password" | "reset_password";

async function call(action: Action, accountId: number, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(ADMIN_AUTH_OPS_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, account_id: accountId, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      return { ok: false, error: body?.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function createAuthUser(accountId: number, password: string) {
  return call("create", accountId, password);
}

export function changeAuthPassword(accountId: number, password: string) {
  return call("change_password", accountId, password);
}
