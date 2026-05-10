"use client";

import { useRef, type MouseEvent as ReactMouseEvent } from "react";

/**
 * 모달 backdrop 클릭 시 닫기 — 단, 내부에서 mousedown 후 외부로 드래그된 mouseup은 무시.
 *
 * 사용법:
 *   const backdrop = useBackdropClose(onClose);
 *   <div className="fixed inset-0 ..." {...backdrop}>
 *     <div onClick={e => e.stopPropagation()}>...</div>
 *   </div>
 */
export function useBackdropClose(onClose: () => void) {
  const pressedOnBackdrop = useRef(false);
  return {
    onMouseDown: (e: ReactMouseEvent) => {
      pressedOnBackdrop.current = e.target === e.currentTarget;
    },
    onClick: (e: ReactMouseEvent) => {
      if (pressedOnBackdrop.current && e.target === e.currentTarget) onClose();
      pressedOnBackdrop.current = false;
    },
  };
}
