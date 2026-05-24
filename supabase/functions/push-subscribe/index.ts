// Supabase Edge Function: push-subscribe
// POST   body { userId, subscription: { endpoint, keys: { p256dh, auth } }, userAgent? }
//        push_subscriptions에 upsert (endpoint UNIQUE)
// DELETE body { userId, endpoint }
//        해당 endpoint 행 삭제
//
// 배포: supabase functions deploy push-subscribe
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (Supabase가 자동 주입)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

// @ts-expect-error Deno 글로벌 (로컬 TS 환경엔 타입 없음)
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // @ts-expect-error Deno
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  // @ts-expect-error Deno
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json();

    if (req.method === "POST") {
      const { userId, subscription, userAgent } = body ?? {};
      if (!userId || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return jsonResponse({ error: "userId, subscription 필수" }, { status: 400 });
      }
      const { error } = await db.from("push_subscriptions").upsert(
        {
          user_id:    userId,
          endpoint:   subscription.endpoint,
          p256dh:     subscription.keys.p256dh,
          auth:       subscription.keys.auth,
          user_agent: userAgent ?? null,
        },
        { onConflict: "endpoint" }
      );
      if (error) return jsonResponse({ error: error.message }, { status: 500 });
      return jsonResponse({ ok: true });
    }

    if (req.method === "DELETE") {
      const { endpoint } = body ?? {};
      if (!endpoint) return jsonResponse({ error: "endpoint 필수" }, { status: 400 });
      const { error } = await db.from("push_subscriptions").delete().eq("endpoint", endpoint);
      if (error) return jsonResponse({ error: error.message }, { status: 500 });
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "method not allowed" }, { status: 405 });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, { status: 500 });
  }
});
