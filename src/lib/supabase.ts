import { createClient } from "@supabase/supabase-js";

// 신DB 고정 접속값. anon 키는 공개(publishable) 키로, 클라이언트 번들 노출이 정상이며 RLS로 보호된다.
// 배포 Secret 값 손상(붙여넣기 시 개행 끼임 등)으로 401이 반복돼, env를 읽지 않고 코드에 직접 고정한다.
// (키 교체가 필요하면 이 값을 수정. .replace 로 혹시 모를 공백도 한 번 더 정리)
export const SUPABASE_URL = "https://bbnmxwpacdfqvicybhau.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJibm14d3BhY2RmcXZpY3liaGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDA3NDYsImV4cCI6MjA5MTAxNjc0Nn0.cGqnmu5BeaXosxoE-IEmjX-dF4zDYipzpYb5hhc8S6I".replace(/\s/g, "");

// ──────────────────────────────────────────────────────────────────────────
// getSession(클라이언트 초기화) 전 무효 세션 선제 정리
// ------------------------------------------------------------------------
// createClient()는 생성 직후 내부적으로 _recoverAndRefresh()를 자동 실행해
// localStorage에 저장된 세션을 복구한다. 이때 세션이 만료됐고 refresh_token이
// 서버에서 거부되면(로그아웃 잔재·토큰 회전·다른 프로젝트 토큰) auth-js가
// `console.error(AuthApiError: Invalid Refresh Token: Refresh Token Not Found)`를
// 남긴다. 비로그인 부팅마다 콘솔에 빨간 에러가 찍히므로, 클라이언트 생성(=모든
// auth 동작·getSession) 전에 만료/깨진 세션을 선제 정리한다.
//
// 만료되지 않은(아직 유효한) 세션은 건드리지 않으므로, 정상 자동 로그인에는 영향이
// 없다. storageKey 규칙·만료 마진(90s)은 supabase-js / auth-js 기본값과 동일하게 맞춤.
// ──────────────────────────────────────────────────────────────────────────
const SUPABASE_AUTH_STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

function clearStaleAuthSession() {
  if (typeof window === "undefined") return; // SSR/빌드 시 localStorage 없음 → skip
  try {
    const raw = window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) return;
    let session: { refresh_token?: string; expires_at?: number } | null;
    try {
      session = JSON.parse(raw);
    } catch {
      window.localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY); // 파싱 불가한 깨진 값
      return;
    }
    const EXPIRY_MARGIN_MS = 90_000; // auth-js EXPIRY_MARGIN_MS(AUTO_REFRESH_TICK 3 × 30s)
    const expiresAtMs = (session?.expires_at ?? 0) * 1000;
    const expired = expiresAtMs - Date.now() < EXPIRY_MARGIN_MS;
    // refresh_token이 없으면(복구 불가) 또는 만료 임박/만료면 제거 → 자동 refresh 시도 자체를 차단
    if (!session?.refresh_token || expired) {
      window.localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
    }
  } catch {
    // localStorage 접근 불가(프라이빗 모드 등) — 무시
  }
}

clearStaleAuthSession();

const rawClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || "placeholder");

// ──────────────────────────────────────────────────────────────────────────
// 신DB 스키마 전환 과도기 스캐폴딩
// ------------------------------------------------------------------------
// 구 스키마 테이블(notifications, construction_*, tbm_*, users, vendors 등)이
// 신DB에 아직 없을 때, PostgREST는 PGRST205("Could not find the table ...")를
// 돌려준다. 화면 곳곳이 `if (error) throw` / `console.error` 로 이를 처리해
// Next dev 에러 오버레이를 띄우거나 컴포넌트를 멈추게 한다.
//
// 여기서 supabase 클라이언트를 감싸, "테이블 없음" 한 가지 케이스만
// 빈 결과({ data: [], error: null })로 degrade한다. 그 외 에러는 손대지 않아
// 실제 버그는 그대로 드러난다. 화면별 정식 전환이 끝나면 이 래퍼는 제거한다.
// ──────────────────────────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
const warnedTables = new Set<string>();

function isMissingTable(error: any): boolean {
  return !!error && (error.code === "PGRST205" || /Could not find the table/i.test(error.message ?? ""));
}

function degradeResult(res: any, table: string): any {
  if (res && isMissingTable(res.error)) {
    if (!warnedTables.has(table)) {
      warnedTables.add(table);
      console.warn(`[supabase] '${table}' 테이블이 신DB에 없어 빈 결과로 처리합니다 (스키마 전환 과도기).`);
    }
    return { ...res, data: [], error: null, status: 200, statusText: "OK" };
  }
  return res;
}

// PostgrestFilterBuilder 등 thenable을 감싼다. 체이닝(eq/order/limit/single...)은
// this(=target)를 반환하므로, 그 경우 프록시(receiver)를 다시 돌려 체인을 유지한다.
// 메서드 호출의 this 는 항상 실제 target 에 바인딩 → 내부 private 필드 접근 안전.
function wrapThenable(builder: any, table: string): any {
  if (!builder || typeof builder.then !== "function") return builder;
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (prop === "then") {
        return (onF: any, onR: any) =>
          target.then((res: any) => {
            const fixed = degradeResult(res, table);
            return onF ? onF(fixed) : fixed;
          }, onR);
      }
      const v = (target as any)[prop];
      if (typeof v === "function") {
        return (...args: any[]) => {
          const r = v.apply(target, args);
          return r === target ? receiver : wrapThenable(r, table);
        };
      }
      return v;
    },
  });
}

function wrapQueryBuilder(qb: any, table: string): any {
  return new Proxy(qb, {
    get(target, prop) {
      const v = (target as any)[prop];
      if (typeof v === "function") {
        return (...args: any[]) => wrapThenable(v.apply(target, args), table);
      }
      return v;
    },
  });
}

export const supabase = new Proxy(rawClient, {
  get(target, prop) {
    if (prop === "from") {
      return (table: string) => wrapQueryBuilder((target as any).from(table), table);
    }
    const v = (target as any)[prop];
    return typeof v === "function" ? v.bind(target) : v;
  },
}) as typeof rawClient;
/* eslint-enable @typescript-eslint/no-explicit-any */
