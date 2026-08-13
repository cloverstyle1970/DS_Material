"use client";
import { useState, useEffect, useRef } from "react";

function CameraIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M1 8a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 018.07 3h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0016.07 6H17a2 2 0 012 2v7a2 2 0 01-2 2H3a2 2 0 01-2-2V8zm13.5 3a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM10 14a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  );
}

const btnBase =
  "inline-flex items-center justify-center rounded text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 flex-shrink-0 transition-colors";

export function PhotoIconBtn({ urls }: { urls: (string | null | undefined)[] }) {
  const valid = urls.filter((u): u is string => !!u);
  if (valid.length === 0) return null;

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (valid.length === 1) {
    return (
      <button
        type="button"
        title="사진 보기"
        onClick={e => { e.stopPropagation(); window.open(valid[0], "_blank"); }}
        onMouseDown={e => e.stopPropagation()}
        className={btnBase + " w-5 h-5"}
      >
        <CameraIcon />
      </button>
    );
  }

  return (
    <div ref={ref} className="relative inline-flex flex-shrink-0">
      <button
        type="button"
        title={`사진 ${valid.length}장 보기`}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        onMouseDown={e => e.stopPropagation()}
        className={btnBase + " h-5 px-1 gap-0.5"}
      >
        <CameraIcon />
        <span className="text-[10px] font-bold leading-none">{valid.length}</span>
      </button>
      {open && (
        <div className="absolute z-[200] top-full left-0 mt-0.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl p-1 min-w-[72px]">
          {valid.map((url, i) => (
            <button
              key={i}
              type="button"
              onClick={e => { e.stopPropagation(); window.open(url, "_blank"); setOpen(false); }}
              onMouseDown={e => e.stopPropagation()}
              className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded whitespace-nowrap"
            >
              <CameraIcon />
              사진 {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
