"use client";

import { useEffect, useRef, useState } from "react";

export interface ElevatorOption {
  id: number;
  unitName: string | null;
}

interface Props {
  value: string;
  elevators: ElevatorOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  /** 셀 내부에 박힌 인라인용 (테이블 셀 등) — 기본 true */
  inline?: boolean;
}

export default function ElevatorPicker({ value, elevators, onChange, placeholder = "선택", inline = true }: Props) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open && focusedIndex >= 0 && listRef.current) {
      const el = listRef.current.children[focusedIndex] as HTMLElement;
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [open, focusedIndex]);

  function pick(name: string) {
    onChange(name);
    setOpen(false);
    setFocusedIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setFocusedIndex(i => (i < elevators.length - 1 ? i + 1 : i));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex(i => (i > 0 ? i - 1 : 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open && focusedIndex >= 0) pick(elevators[focusedIndex].unitName ?? "");
      else setOpen(o => !o);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      onChange("");
    }
  }

  // 인라인(테이블 셀)용은 border 없이 셀 배경에 녹아들고, 박스형은 자체 border
  const buttonCls = inline
    ? `w-full px-2 py-1 text-sm font-semibold text-left border-0 bg-white dark:bg-gray-800 hover:bg-blue-50/40 dark:hover:bg-blue-900/20 focus:outline-none focus:bg-yellow-50 dark:focus:bg-yellow-900/20 focus:ring-1 focus:ring-blue-300 transition-colors flex items-center justify-between`
    : `w-full px-3 py-2 text-sm font-semibold text-left rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-blue-50/40 dark:hover:bg-blue-900/20 focus:outline-none focus:ring-2 focus:ring-blue-300 transition-colors flex items-center justify-between`;

  const colorCls = value ? "text-gray-900 dark:text-gray-50" : "text-gray-400 dark:text-gray-500";

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} onKeyDown={handleKeyDown}
        className={`${buttonCls} ${colorCls}`}>
        <span className="truncate">{value || placeholder}</span>
        <span className="text-gray-400 text-[10px] ml-1 shrink-0">▾</span>
      </button>
      {open && (
        <ul ref={listRef}
          className="absolute z-50 top-full left-0 mt-0.5 w-44 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-2xl max-h-60 overflow-y-auto">
          <li>
            <button type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick("")}
              className="w-full text-left px-3 py-2 text-sm text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 italic">
              (선택 해제)
            </button>
          </li>
          {elevators.map((el, idx) => {
            const active = el.unitName === value;
            const focused = focusedIndex === idx;
            return (
              <li key={el.id}>
                <button type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => pick(el.unitName ?? "")}
                  onMouseEnter={() => setFocusedIndex(idx)}
                  className={`w-full text-left px-3 py-2 text-sm font-semibold transition-colors border-b border-gray-50 dark:border-gray-700 last:border-0
                    ${active ? "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-200" : focused ? "bg-blue-50 dark:bg-blue-900/30 text-gray-900 dark:text-gray-50" : "text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"}`}>
                  {el.unitName ?? "-"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
