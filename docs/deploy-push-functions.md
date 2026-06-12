# Web Push Edge Function 배포 요청

> 대상: Supabase 프로젝트 `bbnmxwpacdfqvicybhau` 관리자
> 요청자: 자재관리(MET) 개발 담당 (cloverstyle1970@gmail.com)
> 작성일: 2026-06-12

## 배경

자재관리 사이트(met.daesol.kr)의 **브라우저 푸시 알림** 기능을 활성화하기 위해 Supabase Edge Function 2개를 배포해야 합니다.

- DB 스키마(`push_subscriptions`, `accounts.push_enabled`)는 자재관리 측에서 적용 완료 (2026-06-12, commit `86186fb`)
- Edge Function 소스 코드도 동일 커밋에 포함
- Supabase Dashboard 권한이 없어 함수 배포는 관리자께 의뢰드립니다

## 작업 내용 요약

| # | 작업 | 결과 확인 |
|---|------|-----------|
| 1 | `push-subscribe` 함수 배포 | `curl -X OPTIONS https://bbnmxwpacdfqvicybhau.supabase.co/functions/v1/push-subscribe` 200 OK |
| 2 | `push-send` 함수 배포 | 위와 동일 URL의 push-send 경로 200 OK |
| 3 | `push-send` 함수에 VAPID 시크릿 3개 설정 | 시크릿 목록 조회로 확인 |

함수 소스 위치 (자재관리 repo):
- `supabase/functions/push-subscribe/index.ts`
- `supabase/functions/push-send/index.ts`

## 실행 명령 (Supabase CLI)

```bash
# 1) 로그인 (이미 로그인되어 있으면 생략)
npx supabase login

# 2) 자재관리 프로젝트 연결 (이미 연결되어 있으면 생략)
npx supabase link --project-ref bbnmxwpacdfqvicybhau

# 3) 함수 2개 배포
npx supabase functions deploy push-subscribe
npx supabase functions deploy push-send

# 4) push-send용 VAPID 시크릿 3개 설정
#    값은 별도 채널(보안 메신저/암호화 메일)로 전달드립니다.
npx supabase secrets set \
  VAPID_PUBLIC_KEY=<요청자에게서 별도 수령> \
  VAPID_PRIVATE_KEY=<요청자에게서 별도 수령> \
  VAPID_SUBJECT=mailto:cloverstyle1970@gmail.com
```

## 영향 범위 / 안전성

- **새 함수 2개 추가만** — 기존 함수/테이블 변경 없음
- 다른 사이트(men.daesol.kr 등)에서 호출하지 않는 함수이므로 **리스크 없음**
- 함수가 사용하는 DB 테이블 `push_subscriptions`는 자재관리/유지보수 양측이 공유하지만, 본 함수는 `account_id` 기준 본인 행만 조회/upsert (기존 행 수정 안 함)
- 자동 주입 환경변수(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)만 사용

## 검증 절차

배포 후 다음으로 확인:

```bash
# 1) 함수 존재 확인 — 둘 다 200 OK 떠야 함
curl -s -o /dev/null -w "push-subscribe: %{http_code}\n" \
  -X OPTIONS https://bbnmxwpacdfqvicybhau.supabase.co/functions/v1/push-subscribe
curl -s -o /dev/null -w "push-send:      %{http_code}\n" \
  -X OPTIONS https://bbnmxwpacdfqvicybhau.supabase.co/functions/v1/push-send
```

위 결과 200 OK가 떨어지면 자재관리 측에서 클라이언트 [구독] → [테스트 알림 보내기] 시나리오로 종단 검증합니다.

## 문의

진행 중 에러가 발생하거나 추가 정보가 필요하면 요청자(cloverstyle1970@gmail.com)에게 회신 부탁드립니다.
