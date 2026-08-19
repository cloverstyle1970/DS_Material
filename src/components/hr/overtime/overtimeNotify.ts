import { insertNotification } from "@/lib/notify";

const LEDGER_HREF = "/hr/overtime-ledger";

/** 승인 요청 알림 → 승인자에게 */
export async function notifyOvertimeApprovalRequest(params: {
  approverId: number;
  authorName: string;
  reportNo: string;
  reportId: number;
  siteName: string;
  startAt: string;
}): Promise<void> {
  const { approverId, authorName, reportNo, reportId, siteName, startAt } = params;
  await insertNotification({
    userId:  approverId,
    type:    "overtime_approval_request",
    title:   `잔업보고서 승인 요청 — ${reportNo}`,
    message: `${authorName} · ${siteName} · ${startAt.slice(0, 10)}`,
    link:    LEDGER_HREF,
    refType: "overtime_report",
    refId:   reportId,
  });
}

/** 승인 완료 알림 → 작성자에게 */
export async function notifyOvertimeApproved(params: {
  authorId: number;
  approverName: string;
  reportNo: string;
  reportId: number;
}): Promise<void> {
  const { authorId, approverName, reportNo, reportId } = params;
  await insertNotification({
    userId:  authorId,
    type:    "overtime_approved",
    title:   `잔업보고서 승인 완료 — ${reportNo}`,
    message: `${approverName}님이 승인하였습니다.`,
    link:    LEDGER_HREF,
    refType: "overtime_report",
    refId:   reportId,
  });
}

/** 반려 알림 → 작성자에게 */
export async function notifyOvertimeRejected(params: {
  authorId: number;
  approverName: string;
  reportNo: string;
  reportId: number;
  reason: string;
}): Promise<void> {
  const { authorId, approverName, reportNo, reportId, reason } = params;
  await insertNotification({
    userId:  authorId,
    type:    "overtime_rejected",
    title:   `잔업보고서 반려 — ${reportNo}`,
    message: `${approverName}님이 반려하였습니다. 사유: ${reason}`,
    link:    LEDGER_HREF,
    refType: "overtime_report",
    refId:   reportId,
  });
}
