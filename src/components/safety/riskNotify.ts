import { supabase } from "@/lib/supabase";
import { insertNotification } from "@/lib/notify";

// 위험성평가 참가자 지정 알림. PC/모바일 등록 화면 양쪽에서 공유한다.
//
// 링크는 **보내는 화면이 아니라 받는 사람의 화면 모드**(accounts.view_mode)로 결정한다.
// 모바일 기사에게 PC 페이지를, PC 담당자에게 모바일 페이지를 열어주면 곧장 헤매기 때문.
// 두 경로는 같은 메뉴 권한(/safety/risk-assessment)을 공유하므로 어느 쪽으로 보내도
// 권한 때문에 막히지 않는다.
const PC_HREF = "/safety/risk-assessment";
const MOBILE_HREF = "/safety/risk-assessment/mobile";

export interface RiskParticipantNotifyParams {
  userIds: number[];       // 수신자 (호출부에서 본인 제외까지 마친 목록)
  surveyId: number;
  docNo: string | null;    // DS-001
  categoryName: string;    // 보수점검(자체점검)
  siteName: string;
  surveyDate: string;
}

/**
 * 참가자 전원에게 인앱+Push 알림 발송.
 * 알림 실패가 평가 저장을 되돌리면 안 되므로 호출부에서 await 하지 말 것(fire-and-forget).
 */
export async function notifyRiskParticipants(params: RiskParticipantNotifyParams): Promise<void> {
  const { userIds, surveyId, docNo, categoryName, siteName, surveyDate } = params;
  if (userIds.length === 0) return;

  // 수신자 화면 모드 일괄 조회. 조회 실패·미설정이면 PC(기본값)로 보낸다.
  const { data } = await supabase.from("accounts").select("id, view_mode").in("id", userIds);
  const modeById = new Map<number, string | null>((data ?? []).map((a) => [a.id as number, a.view_mode as string | null]));

  const titleParts = [docNo, categoryName].filter(Boolean).join(" ");
  const sitePart = siteName.trim() ? ` · ${siteName.trim()}` : "";

  await Promise.all(
    userIds.map((id) =>
      insertNotification({
        userId: id,
        type: "risk_participant",
        title: "위험성평가 참가자로 지정되었습니다 — 서명이 필요합니다",
        message: `[${titleParts}]${sitePart} / ${surveyDate}`,
        link: modeById.get(id) === "mobile" ? MOBILE_HREF : PC_HREF,
        refType: "hazard_survey",
        refId: surveyId,
      })
    )
  );
}
