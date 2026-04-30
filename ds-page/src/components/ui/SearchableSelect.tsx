"use client";

import { useState, useEffect, useRef } from "react";

interface Option { id: number; name: string }

interface Props {
  options: Option[];
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  className?: string;
}

export default function SearchableSelect({ options, value, onChange, placeholder = "검색", className = "" }: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        if (!options.some(o => o.name === query)) setQuery(value);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [query, value, options]);

  const filtered = query.trim()
    ? options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    : options;

  function select(name: string) {
    setQuery(name);
    onChange(name);
    setOpen(false);
  }

  function handleChange(q: string) {
    setQuery(q);
    setOpen(true);
    if (q === "") onChange("");
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <input
        type="text"
        value={query}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
      {query && (
        <button
          type="button"
          onClick={() => { setQuery(""); onChange(""); setOpen(false); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-lg leading-none"
        >×</button>
      )}
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-y-auto max-h-52">
          {filtered.map(o => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => select(o.name)}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-gray-50 ${o.name === value ? "font-semibold text-slate-700" : "text-gray-800"}`}
              >
                {o.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim() !== "" && filtered.length === 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-xs text-gray-400">
          일치하는 항목이 없습니다
        </div>
      )}
    </div>
  );
}
