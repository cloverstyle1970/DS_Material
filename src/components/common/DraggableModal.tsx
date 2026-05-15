"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  open: boolean;
  header: ReactNode;
  children: ReactNode;
  panelClassName?: string;
  z?: number;
  /** 지정하면 오버레이 클릭 시 호출 (mousedown→click 외부 검증 포함) */
  onClose?: () => void;
}

export default function DraggableModal({
  open,
  header,
  children,
  panelClassName = "w-full max-w-lg max-h-[90vh]",
  z = 60,
  onClose,
}: Props) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const pressedOnBackdrop = useRef(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { if (!open) setPos({ x: 0, y: 0 }); }, [open]);

  if (!open || !mounted || typeof document === "undefined") return null;

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, label")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y };
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    setPos({
      x: dragRef.current.baseX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.baseY + (e.clientY - dragRef.current.startY),
    });
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }

  function onBackdropMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    pressedOnBackdrop.current = e.target === e.currentTarget;
  }
  function onBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (onClose && pressedOnBackdrop.current && e.target === e.currentTarget) onClose();
    pressedOnBackdrop.current = false;
  }

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
      style={{ zIndex: z }}
      onMouseDown={onBackdropMouseDown}
      onClick={onBackdropClick}
    >
      <div
        className={`bg-white dark:bg-gray-800 rounded-xl shadow-xl flex flex-col overflow-hidden ${panelClassName}`}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
      >
        <div
          className="select-none cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => setPos({ x: 0, y: 0 })}
          title="드래그하여 이동 · 더블클릭 시 원위치"
        >
          {header}
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
