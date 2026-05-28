import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bbnmxwpacdfqvicybhau.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

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
