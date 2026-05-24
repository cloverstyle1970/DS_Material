"use client";

import { useEffect, useState, useCallback } from "react";
import { getErrorMessage } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

// Supabase Edge Function 호출 (output: export 모드라 Next API Route 불가).
async function callPushFn<T = unknown>(
  fnName: "push-subscribe" | "push-send",
  method: "POST" | "DELETE",
  body: unknown
): Promise<T> {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Supabase 환경변수 미설정");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method,
    headers: {
      "Content-Type":  "application/json",
      "apikey":        SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`);
  return data as T;
}

const VAPID_PUBLIC   = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL    || "";
const SUPABASE_KEY   = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const buffer = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type SupportState = "checking" | "unsupported" | "denied" | "ready";

export default function PushNotificationToggle() {
  const { user } = useAuth();
  const [supportState, setSupportState] = useState<SupportState>("checking");
  const [subscribed, setSubscribed] = useState(false);
  const [pushEnabled, setPushEnabled] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    if (typeof window === "undefined") return;

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSupportState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setSupportState("denied");
      return;
    }
    setSupportState("ready");

    // 기존 구독 확인
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setSubscribed(!!sub);
    } catch {
      setSubscribed(false);
    }

    // push_enabled 조회
    const { data } = await supabase
      .from("users")
      .select("push_enabled")
      .eq("id", user.id)
      .single();
    setPushEnabled(data?.push_enabled !== false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
    const existing = await navigator.serviceWorker.getRegistration("/");
    if (existing) return existing;
    return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  }

  async function subscribeNow() {
    if (!user || busy) return;
    if (!VAPID_PUBLIC) {
      alert("VAPID 공개키 미설정 (.env.local NEXT_PUBLIC_VAPID_PUBLIC_KEY)");
      return;
    }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setSupportState(permission === "denied" ? "denied" : "ready");
        return;
      }
      const reg = await ensureRegistration();
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
      const json = sub.toJSON();
      await callPushFn("push-subscribe", "POST", {
        userId: user.id,
        subscription: { endpoint: json.endpoint, keys: json.keys },
        userAgent: navigator.userAgent,
      });
      setSubscribed(true);
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribeNow() {
    if (!user || busy) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await callPushFn("push-subscribe", "DELETE", { userId: user.id, endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function togglePushEnabled() {
    if (!user || busy) return;
    const next = !pushEnabled;
    setPushEnabled(next);
    setBusy(true);
    try {
      const { error } = await supabase.from("users").update({ push_enabled: next }).eq("id", user.id);
      if (error) throw error;
    } catch (e) {
      setPushEnabled(!next);
      alert(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendTestPush() {
    if (!user || testBusy) return;
    setTestBusy(true);
    try {
      const res = await callPushFn<{ sent: number; reason?: string }>("push-send", "POST", {
        userId: user.id,
        title: "DS 자재관리 — 테스트 알림",
        body:  `${user.name} 님, 푸시가 정상 도착했습니다.`,
        link:  "/me",
        tag:   "test-push",
      });
      if (res.sent === 0) alert(`전송 0건 (${res.reason ?? "unknown"})`);
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setTestBusy(false);
    }
  }

  if (!user) return null;

  // 안내 메시지 결정
  let statusText = "";
  if (supportState === "checking") statusText = "확인 중...";
  else if (supportState === "unsupported") statusText = "이 브라우저는 Web Push를 지원하지 않습니다";
  else if (supportState === "denied") statusText = "브라우저 알림 권한이 차단됨 — 브라우저 설정에서 해제 필요";
  else if (!subscribed) statusText = "구독 안 됨";
  else if (!pushEnabled) statusText = "구독됨 — 수신 OFF (저장만 됨)";
  else statusText = "구독됨 — 수신 ON";

  const canSubscribe = supportState === "ready" && !subscribed;
  const canUnsubscribe = supportState === "ready" && subscribed;
  const canToggleEnable = supportState === "ready" && subscribed;
  const canTest = supportState === "ready" && subscribed && pushEnabled;

  return (
    <div className="py-2 px-2 -mx-2 mb-2 rounded bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 shrink-0">브라우저 푸시 알림</span>
          <span className="text-[10px] text-gray-400 truncate">{statusText}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canSubscribe && (
            <button
              type="button"
              onClick={subscribeNow}
              disabled={busy}
              className="px-2 py-1 text-[11px] font-medium rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
            >
              구독
            </button>
          )}
          {canUnsubscribe && (
            <button
              type="button"
              onClick={unsubscribeNow}
              disabled={busy}
              className="px-2 py-1 text-[11px] font-medium rounded bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-400 disabled:opacity-50"
            >
              해제
            </button>
          )}
          {canToggleEnable && (
            <button
              type="button"
              role="switch"
              aria-checked={pushEnabled}
              onClick={togglePushEnabled}
              disabled={busy}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                pushEnabled ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  pushEnabled ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          )}
        </div>
      </div>
      {canTest && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={sendTestPush}
            disabled={testBusy}
            className="px-2 py-1 text-[11px] font-medium rounded border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50"
          >
            {testBusy ? "전송 중..." : "테스트 알림 보내기"}
          </button>
        </div>
      )}
    </div>
  );
}
