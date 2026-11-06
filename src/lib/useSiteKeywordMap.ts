"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";

/**
 * managed_sites 의 alias·search_keywords 를 모아 "현장명 스냅샷 문자열 → 키워드 문자열" 맵을 만든다.
 *
 * 거래내역·신청·발주 등 모든 리스트 레코드는 managed_sites.site_name 의 **스냅샷**을 siteName 필드에 저장한다.
 * 사용자가 'S1' 같은 짧은 코드로 검색할 때 스냅샷 자체에는 'S1' 이 없지만, managed_sites.search_keywords(또는 alias) 에는 있을 수 있다.
 * 이 맵으로 리스트 필터 단계에서 스냅샷 siteName → alias+keywords 를 역조회해 포함 여부를 함께 판정한다.
 *
 * 사용:
 * ```ts
 * const siteKeywordMap = useSiteKeywordMap();
 * if (search.siteName.trim()) {
 *   const q = search.siteName.trim().toLowerCase();
 *   const name = (r.siteName ?? "").trim().toLowerCase();
 *   if (!name.includes(q) && !(siteKeywordMap.get(name) ?? "").includes(q)) return false;
 * }
 * ```
 */
export function useSiteKeywordMap(): Map<string, string> {
  const [rows, setRows] = useState<{ site_name: string; alias: string | null; search_keywords: string | null }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all: { site_name: string; alias: string | null; search_keywords: string | null }[] = [];
      const PAGE = 1000;
      for (let off = 0; ; off += PAGE) {
        const { data, error } = await supabase
          .from("managed_sites")
          .select("site_name, alias, search_keywords")
          .range(off, off + PAGE - 1);
        if (error || !data || data.length === 0) break;
        all.push(...(data as typeof all));
        if (data.length < PAGE) break;
      }
      if (!cancelled) setRows(all);
    })();
    return () => { cancelled = true; };
  }, []);

  return useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      const parts = [r.alias, r.search_keywords].filter(Boolean).join(" ").toLowerCase();
      if (parts && r.site_name) m.set(r.site_name.trim().toLowerCase(), parts);
    }
    return m;
  }, [rows]);
}

/**
 * 리스트 필터에서 사용할 공용 매처.
 * - query가 빈 문자열이면 true (필터 통과)
 * - siteName 스냅샷 자체에 query 가 포함되면 true
 * - 그렇지 않더라도 siteKeywordMap에서 해당 siteName 의 alias+keywords 에 query 가 포함되면 true
 */
export function matchSiteKeyword(
  siteName: string | null | undefined,
  query: string,
  siteKeywordMap: Map<string, string>,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = (siteName ?? "").trim().toLowerCase();
  if (name.includes(q)) return true;
  return (siteKeywordMap.get(name) ?? "").includes(q);
}
