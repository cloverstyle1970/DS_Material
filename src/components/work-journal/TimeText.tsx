"use client";

// HH:MM (24H) 직접 입력용 텍스트 시간 필드.
// - 숫자 4자리 입력 시 자동으로 : 삽입 (예: 0930 → 09:30)
// - blur 시 정규화 (0~23 : 0~59, 두 자리 zero-pad)
// - 유효 형식 아니면 빈값으로 되돌림

interface TimeTextProps {
  value: string;                          // "HH:MM" 또는 ""
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

function normalize(raw: string): string {
  if (!raw) return "";
  const m = raw.match(/^(\d{1,2}):?(\d{0,2})$/);
  if (!m) return "";
  const hRaw = parseInt(m[1], 10);
  const mRaw = m[2] === "" ? 0 : parseInt(m[2], 10);
  if (!Number.isFinite(hRaw) || !Number.isFinite(mRaw)) return "";
  const hh = Math.min(23, Math.max(0, hRaw));
  const mm = Math.min(59, Math.max(0, mRaw));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export default function TimeText({
  value, onChange, placeholder = "HH:MM", className = "", disabled,
}: TimeTextProps) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    let v = e.target.value.replace(/[^0-9:]/g, "");
    // 4자리 숫자만 있으면 자동 : 삽입
    if (/^\d{3,4}$/.test(v)) {
      const hh = v.slice(0, 2);
      const mm = v.slice(2);
      v = `${hh}:${mm}`;
    }
    if (v.length > 5) v = v.slice(0, 5);
    onChange(v);
  }

  function handleBlur() {
    if (value === "") return;
    const norm = normalize(value);
    if (norm !== value) onChange(norm);
  }

  return (
    <input
      type="text"
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={placeholder}
      maxLength={5}
      inputMode="numeric"
      pattern="^([01]?[0-9]|2[0-3]):[0-5][0-9]$"
      disabled={disabled}
      className={className}
    />
  );
}
