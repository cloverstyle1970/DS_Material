"use client";

import SearchableSelect from "./SearchableSelect";

interface SiteOption { id: number; name: string }

interface Props {
  sites: SiteOption[];
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  className?: string;
}

export default function SiteSearchInput({ sites, value, onChange, placeholder = "현장명 입력", className }: Props) {
  return (
    <SearchableSelect
      options={sites}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
    />
  );
}
