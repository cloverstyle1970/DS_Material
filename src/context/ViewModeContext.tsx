"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

// 화면 레이아웃 모드. viewport 반응형 자동 감지를 무시하고 이 값으로 레이아웃을 강제한다.
// - "pc": 사이드바 고정 등 데스크톱 레이아웃
// - "mobile": 사이드바 오버레이 + 모바일 폭 프레임 등 모바일 레이아웃
export type ViewMode = "pc" | "mobile";

interface ViewModeContextValue {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
}

const ViewModeContext = createContext<ViewModeContextValue>({
  viewMode: "pc",
  setViewMode: () => {},
});

const STORAGE_KEY = "app-view-mode";
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): ViewMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "mobile" || saved === "pc" ? saved : "pc";
}

function getServerSnapshot(): ViewMode {
  return "pc";
}

// localStorage 갱신 + 구독자 즉시 통지. ThemeContext와 달리 view_mode는 html class가 아닌
// React 상태(Context)가 레이아웃을 결정하므로, 외부(AuthContext)에서 값을 주입할 때도
// 반드시 이 함수를 통해 listeners를 깨워야 화면에 반영된다.
export function setStoredViewMode(m: ViewMode) {
  localStorage.setItem(STORAGE_KEY, m);
  listeners.forEach((l) => l());
}

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const viewMode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <ViewModeContext.Provider value={{ viewMode, setViewMode: setStoredViewMode }}>
      {children}
    </ViewModeContext.Provider>
  );
}

export function useViewMode() {
  return useContext(ViewModeContext);
}
