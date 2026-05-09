"use client";

import { forwardRef, useImperativeHandle, useRef, useEffect } from "react";

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  getDataURL: () => string | null;
}

const SignaturePad = forwardRef<SignaturePadHandle>(function SignaturePad(_, ref) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    // 컨테이너 크기에 맞춰 캔버스 크기 설정 (DPR 보정)
    const rect = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(rect.width * dpr));
    cv.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1e293b";
  }, []);

  function getPos(e: PointerEvent | React.PointerEvent): { x: number; y: number } {
    const cv = cvRef.current!;
    const rect = cv.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent) {
    const cv = cvRef.current; if (!cv) return;
    cv.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const p = getPos(e);
    lastPosRef.current = p;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function move(e: React.PointerEvent) {
    if (!isDrawingRef.current) return;
    const cv = cvRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPosRef.current = p;
    hasInkRef.current = true;
  }

  function end(e: React.PointerEvent) {
    isDrawingRef.current = false;
    const cv = cvRef.current; if (!cv) return;
    try { cv.releasePointerCapture(e.pointerId); } catch {}
  }

  function clear() {
    const cv = cvRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    hasInkRef.current = false;
  }

  useImperativeHandle(ref, () => ({
    clear,
    isEmpty: () => !hasInkRef.current,
    getDataURL: () => cvRef.current?.toDataURL("image/png") ?? null,
  }), []);

  return (
    <div className="relative w-full">
      <canvas
        ref={cvRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="w-full h-32 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 touch-none"
      />
      <button
        type="button"
        onClick={clear}
        className="absolute top-2 right-2 px-2 py-1 rounded text-[11px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600"
      >
        지우기
      </button>
    </div>
  );
});

export default SignaturePad;
