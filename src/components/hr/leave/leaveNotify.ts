import { insertNotification } from "@/lib/notify";

const LEAVE_HREF  = "/hr/leave-ledger";

/** 승인 요청 알림 → 승인자에게 (링크: 년차계 목록 — 승인/반려 버튼 있는 페이지) */
export async function notifyLeaveApprovalRequest(params: {
  approverId: number;
  authorName: string;
  requestNo: string;
  requestId: number;
  leaveType: string;
}): Promise<void> {
  const { approverId, authorName, requestNo, requestId, leaveType } = params;
  await insertNotification({
    userId:  approverId,
    type:    "leave_approval_request",
    title:   `년차계 승인 요청 — ${requestNo}`,
    message: `${authorName} · ${leaveType}`,
    link:    LEAVE_HREF,
    refType: "leave_request",
    refId:   requestId,
  });
}

/** 승인 완료 알림 → 작성자에게 */
export async function notifyLeaveApproved(params: {
  authorId: number;
  approverName: string;
  requestNo: string;
  requestId: number;
}): Promise<void> {
  const { authorId, approverName, requestNo, requestId } = params;
  await insertNotification({
    userId:  authorId,
    type:    "leave_approved",
    title:   `년차계 승인 완료 — ${requestNo}`,
    message: `${approverName}님이 승인하였습니다.`,
    link:    LEAVE_HREF,
    refType: "leave_request",
    refId:   requestId,
  });
}

/** 반려 알림 → 작성자에게 */
export async function notifyLeaveRejected(params: {
  authorId: number;
  approverName: string;
  requestNo: string;
  requestId: number;
  reason: string;
}): Promise<void> {
  const { authorId, approverName, requestNo, requestId, reason } = params;
  await insertNotification({
    userId:  authorId,
    type:    "leave_rejected",
    title:   `년차계 반려 — ${requestNo}`,
    message: `${approverName}님이 반려하였습니다. 사유: ${reason}`,
    link:    LEAVE_HREF,
    refType: "leave_request",
    refId:   requestId,
  });
}
