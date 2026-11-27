import { insertNotification, sendKakao } from "@/lib/notify";
import { supabase } from "@/lib/supabase";

async function resolveUsername(id: number, fallback: string): Promise<string> {
  if (fallback.trim()) return fallback.trim();
  const { data } = await supabase.from("accounts").select("username").eq("id", id).single();
  return data?.username ?? "";
}

const LEAVE_HREF  = "/hr/leave-ledger";

/** 승인 요청 알림 → 승인자에게 (링크: 년차계 목록 — 승인/반려 버튼 있는 페이지) */
export async function notifyLeaveApprovalRequest(params: {
  approverId: number;
  authorId: number;
  authorName: string;
  requestNo: string;
  requestId: number;
  leaveType: string;
  period: string;
}): Promise<void> {
  const { approverId, authorId, authorName, requestNo, requestId, leaveType, period } = params;
  const name = await resolveUsername(authorId, authorName);
  await insertNotification({
    userId:  approverId,
    type:    "leave_approval_request",
    title:   `년차계 승인 요청 — ${requestNo}`,
    message: `${name} · ${leaveType}`,
    link:    LEAVE_HREF,
    refType: "leave_request",
    refId:   requestId,
  });
  sendKakao("MET_LEAVE_APPROVE_REQ", approverId, {
    "#{작성자명}": name,
    "#{휴가종류}": leaveType,
    "#{기간}":    period,
    "#{문서번호}": requestNo,
  }).catch(e => console.warn("[kakao] leave approval req failed:", e));
}

/** 승인 완료 알림 → 작성자에게 */
export async function notifyLeaveApproved(params: {
  authorId: number;
  authorName: string;
  approverName: string;
  requestNo: string;
  requestId: number;
  leaveType: string;
}): Promise<void> {
  const { authorId, authorName, approverName, requestNo, requestId, leaveType } = params;
  const name = await resolveUsername(authorId, authorName);
  await insertNotification({
    userId:  authorId,
    type:    "leave_approved",
    title:   `년차계 승인 완료 — ${requestNo}`,
    message: `${approverName}님이 승인하였습니다.`,
    link:    LEAVE_HREF,
    refType: "leave_request",
    refId:   requestId,
  });
  sendKakao("MET_LEAVE_RESULT", authorId, {
    "#{작성자명}": name,
    "#{문서번호}": requestNo,
    "#{휴가종류}": leaveType,
    "#{결과}":    "승인",
    "#{결재자명}": approverName,
    "#{사유}":    "-",
  }).catch(e => console.warn("[kakao] leave approved failed:", e));
}

/** 승인 완료 알림 → 연차계 담당자에게 */
export async function notifyLeaveApprovedToManager(params: {
  managerId: number;
  authorName: string;
  approverName: string;
  requestNo: string;
  requestId: number;
  leaveType: string;
}): Promise<void> {
  const { managerId, authorName, approverName, requestNo, requestId, leaveType } = params;
  await insertNotification({
    userId:  managerId,
    type:    "leave_approved_manager",
    title:   `년차계 승인 완료 — ${requestNo}`,
    message: `${authorName} · ${leaveType} / 승인: ${approverName}`,
    link:    LEAVE_HREF,
    refType: "leave_request",
    refId:   requestId,
  });
}

/** 반려 알림 → 작성자에게 */
export async function notifyLeaveRejected(params: {
  authorId: number;
  authorName: string;
  approverName: string;
  requestNo: string;
  requestId: number;
  leaveType: string;
  reason: string;
}): Promise<void> {
  const { authorId, authorName, approverName, requestNo, requestId, leaveType, reason } = params;
  const name = await resolveUsername(authorId, authorName);
  await insertNotification({
    userId:  authorId,
    type:    "leave_rejected",
    title:   `년차계 반려 — ${requestNo}`,
    message: `${approverName}님이 반려하였습니다. 사유: ${reason}`,
    link:    LEAVE_HREF,
    refType: "leave_request",
    refId:   requestId,
  });
  sendKakao("MET_LEAVE_RESULT", authorId, {
    "#{작성자명}": name,
    "#{문서번호}": requestNo,
    "#{휴가종류}": leaveType,
    "#{결과}":    "반려",
    "#{결재자명}": approverName,
    "#{사유}":    reason,
  }).catch(e => console.warn("[kakao] leave rejected failed:", e));
}
