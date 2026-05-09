"use client";

import { forwardRef, useImperativeHandle, useRef, useEffect } from "react";

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  getDataURL: () => string | null;
}

const SignaturePad = forwardRef<SignaturePadHandle>(function SignaturePad(_, ref) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const hasInkRef = useRef(false);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;

    let isDrawing = false;
    let dpr = window.devicePixelRatio || 1;

    function setupCanvas() {
      if (!cv) return;
      const rect = cv.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      // 기존 그림 보존을 위해 임시 캡처 (캔버스 크기 변경 시 컨텐츠 소실)
      let snapshot: ImageData | null = null;
      const prevCtx = cv.getContext("2d");
      if (prevCtx && cv.width > 0 && cv.height > 0 && hasInkRef.current) {
        try { snapshot = prevCtx.getImageData(0, 0, cv.width, cv.height); } catch { snapshot = null; }
      }
      cv.width = w * dpr;
      cv.height = h * dpr;
      cv.style.touchAction = "none";
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1e293b";
      if (snapshot) {
        try { ctx.putImageData(snapshot, 0, 0); } catch {}
      }
    }

    setupCanvas();

    function getPos(clientX: number, clientY: number) {
      const rect = cv!.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function onDown(e: PointerEvent) {
      e.preventDefault();
      try { cv!.setPointerCapture(e.pointerId); } catch {}
      isDrawing = true;
      const p = getPos(e.clientX, e.clientY);
      const ctx = cv!.getContext("2d");
      if (!ctx) return;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      // 단일 클릭(점)도 보이도록 점 찍기
      ctx.lineTo(p.x + 0.1, p.y + 0.1);
      ctx.stroke();
      hasInkRef.current = true;
    }

    function onMove(e: PointerEvent) {
      if (!isDrawing) return;
      e.preventDefault();
      const ctx = cv!.getContext("2d");
      if (!ctx) return;
      const p = getPos(e.clientX, e.clientY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      hasInkRef.current = true;
    }

    function onUp(e: PointerEvent) {
      isDrawing = false;
      try { cv!.releasePointerCapture(e.pointerId); } catch {}
    }

    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("pointerleave", onUp);

    // 리사이즈 시 캔버스 재구성 (그림 유지)
    const ro = new ResizeObserver(() => {
      dpr = window.devicePixelRatio || 1;
      setupCanvas();
    });
    ro.observe(cv);

    return () => {
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointercancel", onUp);
      cv.removeEventListener("pointerleave", onUp);
      ro.disconnect();
    };
  }, []);

  function clear() {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
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
        className="block w-full h-32 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
        style={{ touchAction: "none" }}
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
