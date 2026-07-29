// TBM (Tool Box Meeting) 도메인 타입 정의

export type TBMMode = "repair" | "maintain";
export type TBMSubType = "inspect" | "parts" | "fault";
export type SafetyCategory = "all" | "electric" | "repair" | "maintain" | "rescue" | "weld";
export type SafetySeason = "all" | "spring" | "summer" | "fall" | "winter";
export type ChecklistType = "repair" | "inspect";

export interface SafetyRule {
  id: number;
  code: string;
  text: string;
  category: SafetyCategory;
  season: SafetySeason;
  sort_order: number;
  is_active: boolean;
}

export interface RepairType {
  id: number;
  code: string;
  label: string;
  sort_order: number;
  is_active: boolean;
}

export interface FaultType {
  id: number;
  code: string;
  label: string;
  sort_order: number;
  is_active: boolean;
}

export interface ChecklistItem {
  id: number;
  list_type: ChecklistType;
  label: string;
  sort_order: number;
  is_active: boolean;
}

export interface TBMRecord {
  id: number;
  user_id: number;
  user_name: string;
  mode: TBMMode;
  sub_type: TBMSubType | null;
  site_name: string;
  elevator_name: string;
  schedule_id: number | null;
  repair_type_id: number | null;
  fault_type_id: number | null;
  parts_name: string;
  passenger_trapped: boolean;
  work_content: string;
  risk_assessment: string;
  signature_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface TBMParticipant {
  tbm_id: number;
  user_id: number;
  user_name: string;
  signature_url: string | null;
  confirmed_at: string | null;
}

export interface TBMParticipantChecklist {
  tbm_id: number;
  user_id: number;
  item_id: number;
  is_checked: boolean;
}

export interface TBMParticipantSafety {
  tbm_id: number;
  user_id: number;
  rule_id: number;
  acknowledged: boolean;
}

export interface TBMParticipantPhoto {
  id: number;
  tbm_id: number;
  user_id: number;
  photo_url: string;
  uploaded_at: string;
}

export interface TBMRecordSafetyRule {
  tbm_id: number;
  rule_id: number;
  rule_text: string;
}

export interface TBMChecklistResult {
  tbm_id: number;
  item_id: number;
  item_label: string;
  is_checked: boolean;
}

export interface TBMPhoto {
  id: number;
  tbm_id: number;
  photo_url: string;
  uploaded_at: string;
}

export interface TBMEnvReading {
  id: number;
  tbm_id: number;
  seq: number;
  observed_at: string | null;         // "HH:MM:SS"
  temperature: number | null;
  humidity: number | null;
  apparent_temperature: number | null;
  location: string | null;
}

export interface TBMHeatRest {
  id: number;
  tbm_id: number;
  seq: number;
  rest_start: string | null;          // "HH:MM:SS"
  rest_end: string | null;
  rest_method: string | null;
}

// ============================================================
// 라벨 헬퍼
// ============================================================

export const MODE_LABELS: Record<TBMMode, string> = {
  repair: "수리공사",
  maintain: "보수",
};

export const SUB_TYPE_LABELS: Record<TBMSubType, string> = {
  inspect: "자체점검",
  parts: "부품교체",
  fault: "고장처리",
};

export const SUB_TYPE_ICONS: Record<TBMSubType, string> = {
  inspect: "🔍",
  parts: "🔧",
  fault: "🚨",
};

export const CATEGORY_LABELS: Record<SafetyCategory, string> = {
  all: "공통",
  electric: "전기",
  repair: "공사",
  maintain: "보수",
  rescue: "구출",
  weld: "용접",
};

export const SEASON_LABELS: Record<SafetySeason, string> = {
  all: "사계절",
  spring: "봄",
  summer: "여름",
  fall: "가을",
  winter: "겨울",
};
