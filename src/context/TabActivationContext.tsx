"use client";

import { createContext, useContext, useEffect, useRef } from "react";

// 탭이 현재 보이는지(활성) 여부. AdminShell이 탭별로 주입한다.
// 탭 시스템 밖의 일반 페이지에서는 기본값 true(항상 활성)이라 영향 없음.
const TabActivationContext = createContext<{ isActive: boolean }>({ isActive: true });

export function TabActivationProvider({
  isActive,
  children,
}: {
  isActive: boolean;
  children: React.ReactNode;
}) {
  return (
    <TabActivationContext.Provider value={{ isActive }}>
      {children}
    </TabActivationContext.Provider>
  );
}

/** 현재 탭의 활성 상태를 반환한다. 탭 시스템 밖에서는 항상 true. */
export function useTabIsActive(): boolean {
  const { isActive } = useContext(TabActivationContext);
  return isActive;
}

/**
 * 숨어 있던 탭이 다시 활성화되는 순간(false→true)에만 reload를 호출한다.
 * 최초 mount 시점은 컴포넌트가 이미 자체 fetch를 하므로 중복 호출하지 않는다.
 */
export function useReloadOnActivate(reload: () => void) {
  const { isActive } = useContext(TabActivationContext);
  const prevActive = useRef(isActive);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (!prevActive.current && isActive) reloadRef.current();
    prevActive.current = isActive;
  }, [isActive]);
}
