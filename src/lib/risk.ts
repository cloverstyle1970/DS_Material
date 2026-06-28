// 위험성평가 / 유해요인조사 공용 타입·헬퍼

export interface RiskCategory {
  id: number;
  name: string;
  doc_no: string;          // DS-001
  sub_process: string | null;
  sort_order: number;
  active: boolean;
  created_at?: string;
}

export interface RiskHazardItem {
  id: number;
  category_id: number;
  gubun: string | null;
  hazard: string;
  accident_type: string | null;
  current_measure: string | null;
  default_improvement: string | null;
  default_present: boolean;        // 유해요인조사표 기본 유(true)/무(false)
  sort_order: number;
  active: boolean;
}

export interface HazardSurvey {
  id: number;
  category_id: number;
  site_name: string | null;       // 현장명
  assess_type: string | null;     // 종류: 정기 | 수시
  team: string | null;
  assessor: string | null;
  survey_date: string;
  user_id: number | null;
  status: "submitted" | "assessed";
  created_at?: string;
}

export interface HazardSurveyItem {
  id: number;
  survey_id: number;
  item_id: number | null;
  gubun: string | null;
  hazard: string | null;
  accident_type: string | null;
  current_measure: string | null;
  present: boolean;
  result: string | null;          // 적정 | 보완 | 해당없음
  improvement: string | null;     // 개선대책(위험성 감소대책)
  improve_done_date: string | null; // 개선 완료일
  manager: string | null;         // 담당자
  note: string | null;
  sort_order: number;
}

export const RESULT_OPTIONS = ["적정", "보완", "해당없음"] as const;
export type RiskResult = (typeof RESULT_OPTIONS)[number];

export const ASSESS_TYPES = ["정기", "수시"] as const;
export type AssessType = (typeof ASSESS_TYPES)[number];

// 다음 문서번호 자동 채번. 기존 DS-NNN 중 최대값 +1, 최소 3자리.
// 접두사는 첫 등록값을 따르되 기본 "DS".
export function nextDocNo(existing: string[], prefix = "DS"): string {
  let max = 0;
  for (const d of existing) {
    const m = /^([A-Za-z]+)-(\d+)$/.exec((d ?? "").trim());
    if (m && m[1].toUpperCase() === prefix.toUpperCase()) {
      const n = parseInt(m[2], 10);
      if (n > max) max = n;
    }
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}
