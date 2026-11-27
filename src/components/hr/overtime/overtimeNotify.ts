import { insertNotification, sendKakao } from "@/lib/notify";

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
  sendKakao("MET_OT_APPROVE_REQ", approverId, {
    "#{작성자명}": authorName,
    "#{현장명}":  siteName,
    "#{날짜}":    startAt.slice(0, 10),
    "#{문서번호}": reportNo,
  }).catch(e => console.warn("[kakao] overtime approval req failed:", e));
}

/** 승인 완료 알림 → 작성자에게 */
export async function notifyOvertimeApproved(params: {
  authorId: number;
  authorName: string;
  approverName: string;
  reportNo: string;
  reportId: number;
  startAt: string;
}): Promise<void> {
  const { authorId, authorName, approverName, reportNo, reportId, startAt } = params;
  await insertNotification({
    userId:  authorId,
    type:    "overtime_approved",
    title:   `잔업보고서 승인 완료 — ${reportNo}`,
    message: `${approverName}님이 승인하였습니다.`,
    link:    LEDGER_HREF,
    refType: "overtime_report",
    refId:   reportId,
  });
  sendKakao("MET_OT_RESULT", authorId, {
    "#{작성자명}": authorName,
    "#{문서번호}": reportNo,
    "#{작업일}":  startAt.slice(0, 10),
    "#{결과}":    "승인",
    "#{결재자명}": approverName,
    "#{사유}":    "-",
  }).catch(e => console.warn("[kakao] overtime approved failed:", e));
}

/** 반려 알림 → 작성자에게 */
export async function notifyOvertimeRejected(params: {
  authorId: number;
  authorName: string;
  approverName: string;
  reportNo: string;
  reportId: number;
  startAt: string;
  reason: string;
}): Promise<void> {
  const { authorId, authorName, approverName, reportNo, reportId, startAt, reason } = params;
  await insertNotification({
    userId:  authorId,
    type:    "overtime_rejected",
    title:   `잔업보고서 반려 — ${reportNo}`,
    message: `${approverName}님이 반려하였습니다. 사유: ${reason}`,
    link:    LEDGER_HREF,
    refType: "overtime_report",
    refId:   reportId,
  });
  sendKakao("MET_OT_RESULT", authorId, {
    "#{작성자명}": authorName,
    "#{문서번호}": reportNo,
    "#{작업일}":  startAt.slice(0, 10),
    "#{결과}":    "반려",
    "#{결재자명}": approverName,
    "#{사유}":    reason,
  }).catch(e => console.warn("[kakao] overtime rejected failed:", e));
}
