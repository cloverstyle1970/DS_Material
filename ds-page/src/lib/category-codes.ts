export const MAJOR_CATEGORIES = [
  { code: "01", label: "기계실" },
  { code: "02", label: "승강로" },
  { code: "03", label: "피트" },
  { code: "04", label: "승강장" },
  { code: "05", label: "카" },
  { code: "06", label: "전기/제어" },
  { code: "09", label: "기타" },
] as const;

export const MID_CATEGORIES: Record<string, { code: string; label: string }[]> = {
  "01": [
    { code: "01", label: "권상기" },
    { code: "02", label: "제어반" },
    { code: "03", label: "조속기" },
    { code: "09", label: "기타" },
  ],
  "02": [
    { code: "01", label: "가이드레일" },
    { code: "02", label: "와이어로프" },
    { code: "03", label: "안전장치" },
    { code: "09", label: "기타" },
  ],
  "03": [
    { code: "01", label: "완충기" },
    { code: "09", label: "기타" },
  ],
  "04": [
    { code: "01", label: "승강장문" },
    { code: "02", label: "호출버튼" },
    { code: "09", label: "기타" },
  ],
  "05": [
    { code: "01", label: "카문" },
    { code: "02", label: "조작반" },
    { code: "03", label: "카체" },
    { code: "09", label: "기타" },
  ],
  "06": [
    { code: "01", label: "기판/PCB" },
    { code: "02", label: "센서/스위치" },
    { code: "03", label: "모터/인버터" },
    { code: "09", label: "기타" },
  ],
  "09": [
    { code: "01", label: "소모품" },
    { code: "09", label: "기타" },
  ],
};

export const SUB_CATEGORIES: Record<string, { code: string; label: string }[]> = {
  "0101": [{ code: "01", label: "브레이크" }, { code: "02", label: "모터" }, { code: "09", label: "기타" }],
  "0102": [{ code: "01", label: "메인보드" }, { code: "02", label: "전원부" }, { code: "09", label: "기타" }],
  "0103": [{ code: "01", label: "스프링" }, { code: "09", label: "기타" }],
  "0201": [{ code: "01", label: "T형" }, { code: "02", label: "L형" }, { code: "09", label: "기타" }],
  "0202": [{ code: "01", label: "주와이어" }, { code: "02", label: "보상와이어" }, { code: "09", label: "기타" }],
  "0501": [{ code: "01", label: "도어클로저" }, { code: "02", label: "도어행거" }, { code: "09", label: "기타" }],
  "0502": [{ code: "01", label: "버튼" }, { code: "02", label: "표시등" }, { code: "09", label: "기타" }],
  "0601": [{ code: "01", label: "주제어" }, { code: "02", label: "옵션보드" }, { code: "09", label: "기타" }],
  "0602": [{ code: "01", label: "리미트SW" }, { code: "02", label: "광전센서" }, { code: "09", label: "기타" }],
};

export function getSubCategories(major: string, mid: string) {
  return SUB_CATEGORIES[`${major}${mid}`] ?? [{ code: "09", label: "기타" }];
}

export function generateMaterialCode(params: {
  isDs: boolean;
  major: string;
  mid: string;
  sub: string;
  seq: number;
  isRepair: boolean;
}): string {
  const prefix = params.isDs ? "D" : "_";
  const seqStr = String(params.seq).padStart(4, "0");
  const suffix = params.isRepair ? "R" : "_";
  return `${prefix}${params.major}${params.mid}${params.sub}${seqStr}${suffix}`;
}
