-- 무상자재 신청 승인 흐름 추가
-- approval_status: NULL(승인불필요) | 'pending'(승인대기) | 'approved'(승인) | 'rejected'(반려)
-- 무상신청(request_type='무상신청')만 approval_status를 사용. 나머지는 NULL 유지.

ALTER TABLE material_requests
  ADD COLUMN IF NOT EXISTS approval_status  text,
  ADD COLUMN IF NOT EXISTS approver_id      bigint REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approver_name    text,
  ADD COLUMN IF NOT EXISTS approved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at      timestamptz,
  ADD COLUMN IF NOT EXISTS reject_reason    text;

-- 기존 무상신청 건 소급 처리: 이미 처리 흐름에 진입한 건은 approved 처리
UPDATE material_requests
SET approval_status = 'approved'
WHERE request_type = '무상신청';

-- 검증
SELECT
  request_type,
  approval_status,
  COUNT(*) AS cnt
FROM material_requests
GROUP BY request_type, approval_status
ORDER BY request_type, approval_status;
