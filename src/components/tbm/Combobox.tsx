"use client";

import { useState, useRef, useEffect, KeyboardEvent, RefObject, forwardRef, useImperativeHandle } from "react";

export interface ComboboxHandle {
  focus: () => void;
}

export interface ComboboxProps<T> {
  value: string;
  onChange: (v: string) => void;
  options: T[];
  getLabel: (o: T) => string;
  /** 입력값 기준 필터 함수. 미지정 시 부분일치(대소문자 무시) */
  filter?: (o: T, query: string) => boolean;
  /** 옵션 선택 시 호출 — value도 자동으로 onChange로 갱신됨 */
  onSelect?: (o: T) => void;
  /** Enter 또는 클릭 후 다음 필드로 포커스 이동 */
  nextRef?: RefObject<HTMLElement | { focus: () => void } | null>;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

function ComboboxInner<T>(
  { value, onChange, options, getLabel, filter, onSelect, nextRef, placeholder, className, disabled }: ComboboxProps<T>,
  ref: React.Ref<ComboboxHandle>
) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }), []);

  const filterFn = filter ?? ((o: T, q: string) => getLabel(o).toLowerCase().includes(q.toLowerCase()));
  const trimmed = value.trim();
  const matches = trimmed ? options.filter(o => filterFn(o, trimmed)) : options;
  const visible = matches.slice(0, 30);

  useEffect(() => { setHighlighted(0); }, [value, open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(o: T) {
    onChange(getLabel(o));
    onSelect?.(o);
    setOpen(false);
    requestAnimationFrame(() => {
      const next = nextRef?.current;
      if (next) (next as HTMLElement).focus?.();
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // 한글 IME 조합 중에는 키 이벤트 무시
    if ((e.nativeEvent as KeyboardEvent["nativeEvent"] & { isComposing?: boolean }).isComposing) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlighted(h => Math.min(h + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (visible.length === 0) return;
      e.preventDefault();
      // 단일 매칭이면 자동 선택, 다중 매칭이면 하이라이트된 항목 선택
      const target = visible.length === 1 ? visible[0] : visible[highlighted];
      if (target) pick(target);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        lang="ko"
        autoComplete="off"
        className={className}
      />
      {open && visible.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-30">
          {visible.map((o, i) => (
            <li
              key={i}
              onMouseDown={e => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setHighlighted(i)}
              className={`px-3 py-2 text-sm cursor-pointer ${
                i === highlighted
                  ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold"
                  : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
              }`}
            >
              {getLabel(o)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const Combobox = forwardRef(ComboboxInner) as <T>(
  props: ComboboxProps<T> & { ref?: React.Ref<ComboboxHandle> }
) => React.ReactElement;

export default Combobox;
