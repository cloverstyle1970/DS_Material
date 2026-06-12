# 자재관리 사이트 Web Push Edge Function 배포 요청

> **수신**: Supabase 프로젝트 `bbnmxwpacdfqvicybhau` 관리자
> **요청자**: 자재관리(MET) 개발 담당 — cloverstyle1970@gmail.com
> **작성일**: 2026-06-12

---

## 한눈에 보기

자재관리 사이트(met.daesol.kr)의 **브라우저 푸시 알림** 기능을 켜기 위해 Supabase Edge Function 2개를 배포하고 시크릿 3개를 설정해 주세요. 다른 사이트에는 영향 없습니다.

| # | 작업 | 예상 소요 |
|---|------|-----------|
| 1 | `push-subscribe` Edge Function 배포 | ~1분 |
| 2 | `push-send` Edge Function 배포 | ~1분 |
| 3 | `push-send` 함수에 VAPID 시크릿 3개 설정 | ~1분 |
| 4 | 검증 (curl 한 줄) | ~10초 |

DB(`push_subscriptions` 테이블, `accounts.push_enabled` 컬럼)는 이미 적용 완료(2026-06-12). DB 작업은 없습니다.

---

## 사전 준비

### A. Supabase CLI 설치 확인
```bash
npx supabase --version
```
출력이 `2.x.x` 형태면 OK. 없으면 `npm install -g supabase` 또는 `npx supabase ...` 사용.

### B. 자재관리 repo 클론 (소스 코드 필요)
```bash
git clone <자재관리 repo URL>
cd <repo>
git checkout 4accd50   # 본 요청서가 포함된 커밋
```
또는 첨부로 받은 zip의 `supabase/functions/` 폴더 사용.

### C. Supabase CLI 로그인 & 프로젝트 연결
```bash
npx supabase login                                            # 브라우저 열림 → 인증
npx supabase link --project-ref bbnmxwpacdfqvicybhau          # DB 비밀번호는 Enter로 스킵 가능
```

---

## 작업 1·2: Edge Function 배포

repo 루트에서 두 줄만 실행하면 됩니다.

```bash
npx supabase functions deploy push-subscribe
npx supabase functions deploy push-send
```

**기대 출력 (각 함수마다):**
```
Deployed Functions on project bbnmxwpacdfqvicybhau: push-subscribe
```

> CLI가 싫으면 Dashboard에서도 가능: `Edge Functions` → `Create a new function` → 이름 입력 → `supabase/functions/push-subscribe/index.ts` 내용 복붙 → Deploy. push-send도 동일.

---

## 작업 3: VAPID 시크릿 설정 (`push-send`에만 필요)

VAPID 키 3개를 환경변수로 등록합니다. **값은 요청자가 별도 안전 채널(보안 메신저/암호화 이메일)로 전달**합니다.

### CLI 방식
```bash
npx supabase secrets set \
  VAPID_PUBLIC_KEY=<요청자가 전달한 값> \
  VAPID_PRIVATE_KEY=<요청자가 전달한 값> \
  VAPID_SUBJECT=mailto:cloverstyle1970@gmail.com
```

### Dashboard 방식
1. Supabase Dashboard → 프로젝트 선택 → `Edge Functions` → `Manage secrets`
2. **Add new secret** 3번 클릭하여 등록:
   - `VAPID_PUBLIC_KEY` = (요청자 전달 값)
   - `VAPID_PRIVATE_KEY` = (요청자 전달 값)
   - `VAPID_SUBJECT` = `mailto:cloverstyle1970@gmail.com`
3. Save

> 이미 등록된 시크릿이 있으면 덮어쓰면 됩니다(영향 받는 다른 함수 없음).

---

## 작업 4: 검증

배포·시크릿 설정 후 다음 명령으로 함수가 깨어났는지 확인:

```bash
curl -s -o /dev/null -w "push-subscribe: %{http_code}\n" \
  -X OPTIONS https://bbnmxwpacdfqvicybhau.supabase.co/functions/v1/push-subscribe
curl -s -o /dev/null -w "push-send:      %{http_code}\n" \
  -X OPTIONS https://bbnmxwpacdfqvicybhau.supabase.co/functions/v1/push-send
```

**기대 결과:**
```
push-subscribe: 200
push-send:      200
```

(404가 나오면 함수 배포 실패. CLI 출력 다시 확인.)

여기까지 200이 뜨면 **유지보수 측 작업 종료**입니다. 회신 부탁드립니다 — 이후 자재관리 측에서 클라이언트 화면으로 실제 푸시 도착 여부 검증합니다.

---

## 영향 범위 / 안전성

| 항목 | 영향 |
|------|------|
| 다른 Edge Function | 없음 (새 함수 2개 추가만) |
| 다른 DB 테이블 | 없음 (이번 작업에서는 DB 변경 없음) |
| `push_subscriptions` 테이블 | 본 함수가 `account_id` 기준 본인 행만 upsert/delete. 타인 행 영향 없음 |
| 다른 사이트(men 등) | 호출 안 함 — 자재관리에서만 사용 |
| Supabase 사용량 | 함수 호출당 ms 단위. 무시할 수준 |

함수 소스 코드는 매우 짧습니다(각 ~70라인). 배포 전 직접 검토 원하시면 repo의 다음 파일 참고:
- `supabase/functions/push-subscribe/index.ts`
- `supabase/functions/push-send/index.ts`

---

## 트러블슈팅

| 증상 | 원인 / 대처 |
|------|-------------|
| `Error: Project not linked` | `npx supabase link --project-ref bbnmxwpacdfqvicybhau` 다시 실행 |
| `permission denied for project` | 본인 Supabase 계정이 해당 프로젝트의 Owner/Developer 권한인지 확인 |
| 배포는 성공인데 OPTIONS가 404 | 1~2분 대기 후 재시도 (CDN 전파). 그래도 404면 함수 이름 오타 확인 |
| `push-send` 호출 시 "VAPID 키 미설정" 응답 | 시크릿이 `push-send` 함수에 안 붙음. Dashboard에서 다시 확인 |
| 시크릿 값 복붙했는데 안 됨 | 줄바꿈·공백이 섞인 경우 — Dashboard에서 양 끝 trim 확인 |

---

## 문의

진행 중 막히는 부분이나 추가 정보 필요하면 요청자에게 회신 부탁드립니다.
- 이메일: cloverstyle1970@gmail.com
- 소스 커밋: `4accd50` (master 브랜치)
