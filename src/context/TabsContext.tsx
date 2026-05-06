"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";

export interface Tab {
  href: string;
  label: string;
}

interface TabsContextType {
  tabs: Tab[];
  activeHref: string | null;
  openTab: (href: string, label: string) => boolean;
  closeTab: (href: string) => void;
  setActive: (href: string) => void;
  isLimitReached: boolean;
}

export const MAX_TABS = 10;
const STORAGE_KEY = "ds_tabs_v1";

const TabsContext = createContext<TabsContextType>({
  tabs: [],
  activeHref: null,
  openTab: () => false,
  closeTab: () => {},
  setActive: () => {},
  isLimitReached: false,
});

export function TabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeHref, setActiveHref] = useState<string | null>(null);
  const hydrated = useRef(false);

  // localStorage 복원 — activeHref는 URL pathname에서 유도하므로 저장하지 않음
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { tabs: Tab[] };
        if (Array.isArray(parsed.tabs)) {
          setTabs(parsed.tabs.slice(0, MAX_TABS));
        }
      }
    } catch {}
    hydrated.current = true;
  }, []);

  // tabs 변경 시 저장
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs }));
    } catch {}
  }, [tabs]);

  const openTab = useCallback((href: string, label: string): boolean => {
    let added = false;
    setTabs(prev => {
      const existing = prev.find(t => t.href === href);
      if (existing) {
        // 라벨 갱신만 (이미 열려있음)
        if (existing.label !== label) {
          return prev.map(t => (t.href === href ? { ...t, label } : t));
        }
        return prev;
      }
      if (prev.length >= MAX_TABS) {
        return prev; // 한도 초과 — 무시
      }
      added = true;
      return [...prev, { href, label }];
    });
    setActiveHref(href);
    return added;
  }, []);

  const closeTab = useCallback((href: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.href === href);
      if (idx === -1) return prev;
      const next = prev.filter(t => t.href !== href);
      // 활성 탭을 닫으면 인접 탭으로 이동
      setActiveHref(curr => {
        if (curr !== href) return curr;
        if (next.length === 0) return null;
        const newIdx = Math.min(idx, next.length - 1);
        return next[newIdx].href;
      });
      return next;
    });
  }, []);

  const setActive = useCallback((href: string) => {
    setActiveHref(href);
  }, []);

  const isLimitReached = tabs.length >= MAX_TABS;

  return (
    <TabsContext.Provider value={{ tabs, activeHref, openTab, closeTab, setActive, isLimitReached }}>
      {children}
    </TabsContext.Provider>
  );
}

export function useTabs() {
  return useContext(TabsContext);
}
