// Supabase Edge Function: push-send
// POST body { userId, title, body, link?, refType?, refId?, tag? }
//   - accounts.push_enabled = false 면 스킵
//   - push_subscriptions에서 account_id 일치하는 모든 endpoint로 발사
//   - 410/404 응답 endpoint는 자동 정리
//
// 신DB 스키마: push_subscriptions(id, account_id, endpoint, subscription JSON, created_at)
//             accounts.push_enabled (BOOLEAN)
//             body의 userId는 외부 호환 위해 유지하되 DB에서는 account_id로 매핑.
//
// 배포: supabase functions deploy push-send
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (자동 주입)
//          VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (수동 설정)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ error: "method not allowed" }, { status: 405 });

  // @ts-expect-error Deno
  let VAPID_PUBLIC  = (Deno.env.get("VAPID_PUBLIC_KEY")  ?? Deno.env.get("VAPID_PUBLIC")  ?? "").trim();
  // @ts-expect-error Deno
  let VAPID_PRIVATE = (Deno.env.get("VAPID_PRIVATE_KEY") ?? Deno.env.get("VAPID_PRIVATE") ?? "").trim();
  // URL-safe base64 정규화:
  //   1) +/ → -_ (standard → URL-safe)
  //   2) 끝의 = 패딩 제거
  //   3) URL-safe base64 외 모든 문자(공백/줄바꿈/탭 등) 제거 — Dashboard 복붙 오염 대응
  VAPID_PUBLIC  = VAPID_PUBLIC.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").replace(/[^A-Za-z0-9_-]/g, "");
  VAPID_PRIVATE = VAPID_PRIVATE.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").replace(/[^A-Za-z0-9_-]/g, "");
  // @ts-expect-error Deno
  let VAPID_SUBJECT   = Deno.env.get("VAPID_SUBJECT")     ?? "mailto:admin@example.com";
  // mailto:/https:// 접두사 자동 보정 (이메일만 등록한 경우)
  if (!VAPID_SUBJECT.startsWith("mailto:") && !VAPID_SUBJECT.startsWith("https://")) {
    VAPID_SUBJECT = `mailto:${VAPID_SUBJECT}`;
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return jsonResponse({ error: "VAPID 키 미설정 (Function 환경변수 VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)" }, { status: 500 });
  }

  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  } catch (e) {
    return jsonResponse({ error: `VAPID 설정 실패: ${(e as Error).message}` }, { status: 500 });
  }

  // @ts-expect-error Deno
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  // @ts-expect-error Deno
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json();
    const { userId, title } = body ?? {};
    if (!userId || !title) return jsonResponse({ error: "userId, title 필수" }, { status: 400 });

    // push_enabled 확인 (accounts 기준 — 신DB 표준)
    const { data: u } = await db.from("accounts").select("push_enabled").eq("id", userId).single();
    if (u && u.push_enabled === false) {
      return jsonResponse({ sent: 0, reason: "push_disabled" });
    }

    const { data: subs, error: subErr } = await db
      .from("push_subscriptions")
      .select("id, endpoint, subscription")
      .eq("account_id", userId);
    if (subErr) return jsonResponse({ error: subErr.message }, { status: 500 });
    if (!subs?.length) return jsonResponse({ sent: 0, reason: "no_subscription" });

    const payload = JSON.stringify({
      title,
      body:    body.body ?? "",
      link:    body.link    ?? null,
      refType: body.refType ?? null,
      refId:   body.refId   ?? null,
      tag:     body.tag     ?? null,
    });

    let sent = 0;
    const staleIds: number[] = [];

    await Promise.all(
      subs.map(async (s) => {
        // subscription JSON에는 {endpoint, keys:{p256dh,auth}}이 그대로 보관됨.
        // 일관성·디버그 편의로 row의 endpoint를 우선 사용.
        const sub = s.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | null;
        const p256dh = sub?.keys?.p256dh;
        const auth   = sub?.keys?.auth;
        if (!p256dh || !auth) {
          staleIds.push(s.id);
          return;
        }
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh, auth } },
            payload,
            { TTL: 120 }
          );
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) staleIds.push(s.id);
          else console.warn("[push-send] failed", status, (e as Error)?.message);
        }
      })
    );

    if (staleIds.length) {
      await db.from("push_subscriptions").delete().in("id", staleIds);
    }

    return jsonResponse({ sent, pruned: staleIds.length });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, { status: 500 });
  }
});
