// Supabase Edge Function: met-kakao-send  (자재관리 전용 — 유지보수의 kakao-send와 별개)
// POST body { templateCode: string, to: string, variables: Record<string, string> }
//   - templateCode: MET_MAT_APPROVE_REQ | MET_MAT_APPROVED_REQUESTER | MET_MAT_APPROVED_MANAGER
//                   | MET_MAT_REJECTED | MET_LEAVE_APPROVE_REQ | MET_OT_APPROVE_REQ
//   - to: 수신자 전화번호 (숫자만 또는 010-0000-0000 형식)
//   - variables: 템플릿 변수 (#{키}: 값)
//
// 환경변수 (Supabase Dashboard → Functions → Secrets):
//   SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_PFID, SOLAPI_SENDER
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (자동 주입)
//
// 배포: supabase functions deploy met-kakao-send

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SOLAPI_URL = "https://api.solapi.com/messages/v4/send-many";

const TEMPLATE_IDS: Record<string, string> = {
  MET_MAT_APPROVE_REQ:        "KA01TP2611190726211670MIy91QS12Z",
  MET_MAT_APPROVED_REQUESTER: "KA01TP261119075343171pZBxMoj63gA",
  MET_MAT_APPROVED_MANAGER:   "KA01TP261119080157882frp58fx2KsT",
  MET_MAT_REJECTED:           "KA01TP261119080358893omu4iIZcdPW",
  MET_LEAVE_APPROVE_REQ:      "KA01TP261119071957698Tid7MaeOUDi",
  MET_OT_APPROVE_REQ:         "KA01TP261119071253356YDztlhsiJf5",
};

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

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")   return jsonResponse({ error: "method not allowed" }, { status: 405 });

  // @ts-expect-error Deno
  const SUPABASE_URL_ENV = Deno.env.get("SUPABASE_URL")!;
  // @ts-expect-error Deno
  const SERVICE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // @ts-expect-error Deno
  const API_KEY    = (Deno.env.get("SOLAPI_API_KEY")    ?? "").trim();
  // @ts-expect-error Deno
  const API_SECRET = (Deno.env.get("SOLAPI_API_SECRET") ?? "").trim();
  // @ts-expect-error Deno
  const PFID       = (Deno.env.get("SOLAPI_PFID")       ?? "").trim();
  // @ts-expect-error Deno
  const SENDER     = (Deno.env.get("SOLAPI_SENDER")     ?? "").trim();

  if (!API_KEY || !API_SECRET || !PFID || !SENDER) {
    return jsonResponse(
      { error: "SOLAPI 환경변수 미설정 (SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_PFID / SOLAPI_SENDER)" },
      { status: 500 },
    );
  }

  // JWT 검증
  const db = createClient(SUPABASE_URL_ENV, SERVICE_KEY);
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "") ?? "";
  const { data: { user: caller }, error: authErr } = await db.auth.getUser(token);
  if (authErr || !caller) return jsonResponse({ error: "Unauthorized" }, { status: 401 });

  let body: { templateCode?: string; to?: string; variables?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON" }, { status: 400 });
  }

  const { templateCode, to, variables = {} } = body;
  if (!templateCode || !to) {
    return jsonResponse({ error: "templateCode, to 필수" }, { status: 400 });
  }

  const templateId = TEMPLATE_IDS[templateCode];
  if (!templateId) {
    return jsonResponse({ error: `알 수 없는 templateCode: ${templateCode}` }, { status: 400 });
  }

  const phone = to.replace(/[^0-9]/g, "");
  if (phone.length < 10) {
    return jsonResponse({ error: `유효하지 않은 전화번호: ${to}` }, { status: 400 });
  }

  // SOLAPI HMAC-SHA256 서명
  const date      = new Date().toISOString();
  const salt      = crypto.randomUUID().replace(/-/g, "");
  const signature = await hmacSha256Hex(API_SECRET, date + salt);

  const solapiBody = {
    messages: [{
      to:   phone,
      from: SENDER,
      kakaoOptions: {
        pfId:       PFID,
        templateId,
        variables,
      },
    }],
  };

  try {
    const res = await fetch(SOLAPI_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `HMAC-SHA256 apiKey=${API_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
      },
      body: JSON.stringify(solapiBody),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[met-kakao-send] SOLAPI error", res.status, JSON.stringify(result));
      return jsonResponse({ error: result?.errorMessage ?? `HTTP ${res.status}`, detail: result }, { status: 502 });
    }
    return jsonResponse({ ok: true, result });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, { status: 500 });
  }
});
