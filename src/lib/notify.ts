import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase";

export interface NotifyParams {
  userId: number;
  type: string;
  title: string;
  message: string;
  link?: string | null;
  refType?: string | null;
  refId?: number | null;
}

/**
 * 인앱 알림(notifications 테이블) + Web Push 이중 채널 발송.
 * - 인앱: 수신자가 notifications_enabled=false면 저장 스킵 (전역 on/off)
 * - Web Push: fire-and-forget (push 실패가 인앱에 영향 X). push_enabled 체크는 push-send Function 내부 처리.
 */
export async function insertNotification(params: NotifyParams): Promise<void> {
  const { data: u } = await supabase.from("accounts")
    .select("notifications_enabled").eq("id", params.userId).single();
  if (!u || u.notifications_enabled !== false) {
    await supabase.from("notifications").insert({
      user_id:  params.userId,
      type:     params.type,
      title:    params.title,
      message:  params.message,
      link:     params.link    ?? null,
      ref_type: params.refType ?? null,
      ref_id:   params.refId   ?? null,
    });
  }
  sendWebPush(params).catch(e => console.warn("[push] send failed:", e));
}

/**
 * 카카오 알림톡 발송 — fire-and-forget.
 * recipientAccountId 의 phone 을 accounts 에서 조회한 뒤 met-kakao-send Edge Function 호출.
 * 번호 없거나 발송 실패 시 warn 출력 후 무시 (다른 채널에 영향 없음).
 */
export async function sendKakao(
  templateCode: string,
  recipientAccountId: number,
  variables: Record<string, string>,
): Promise<void> {
  const { data: acc } = await supabase
    .from("accounts")
    .select("phone")
    .eq("id", recipientAccountId)
    .single();
  const phone = (acc?.phone ?? "").replace(/[^0-9]/g, "");
  if (phone.length < 10) return;

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/met-kakao-send`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "apikey":        SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ templateCode, to: phone, variables }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.warn("[kakao] send failed", templateCode, res.status, err?.error);
  }
}

async function sendWebPush(params: NotifyParams): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON_KEY;
  await fetch(`${SUPABASE_URL}/functions/v1/push-send`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "apikey":        SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      userId:  params.userId,
      title:   params.title,
      body:    params.message,
      link:    params.link    ?? null,
      refType: params.refType ?? null,
      refId:   params.refId   ?? null,
      tag:     params.type,
    }),
  });
}
