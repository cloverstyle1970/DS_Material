# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 응답 정책

- **모든 대화 응답은 한국어로 작성** (사용자 메모리 합의)
- **Next.js 16** 이라 학습 데이터와 API·구조가 다를 수 있음. 새 코드 작성 전 `node_modules/next/dist/docs/` 참조 (루트 `AGENTS.md` 강제)

## 개발 명령어

```bash
npm run dev      # 개발 서버 (next dev, Turbopack 기본)
npm run build    # 프로덕션 빌드
npm run start    # 프로덕션 서버
npm run lint     # ESLint (eslint-config-next 16.2.4)
npx tsc --noEmit -p .   # 타입 체크 (테스트 프레임워크 없음)
```

- 테스트 프레임워크 없음. 검증은 `tsc --noEmit` + 수동 브라우저 확인.
- `scripts/e2e-test.mjs` — Node로 직접 실행하는 1회성 시나리오 스크립트(공식 테스트 X)
- 포트 3000 점유 시 자동 3001

## 코드베이스 구조

```
src/
  app/
    (admin)/        # AdminShell 안에서 동작하는 모든 보호 페이지
      layout.tsx    # ThemeProvider + AdminShell
      hr/, data/, material/, requests/, ... # 각 메뉴
    login/page.tsx  # 비보호
    layout.tsx      # 루트 (AuthProvider + 다크모드 깜빡임 방지 스크립트)
  components/       # 도메인별 폴더 (data/, hr/, materials/, quotes/, tbm/, ...)
                    # 각 페이지는 `*Client.tsx` 클라이언트 컴포넌트를 page.tsx에서 import만 함
  context/          # AuthContext, ThemeContext, TabsContext, SidebarContext
  lib/
    supabase.ts             # Supabase 클라이언트 (단일 인스턴스)
    page-registry.tsx       # 탭으로 열 수 있는 모든 페이지 등록 (필수)
    permissions.ts          # PERMISSION_MENUS + matchMenuHref(longest-prefix)
    password.ts             # SHA-256 (Web Crypto API)
    mock-*.ts, api-client.ts # 정적 GitHub Pages 배포용 잔여. 실제 데이터는 Supabase 직접 호출
scripts/migration-*.sql     # Supabase 수동 마이그레이션 (idempotent)
supabase/                   # 보조 시드/리셋 SQL
```

## 핵심 아키텍처 패턴 (반드시 이해)

### 1. 탭 + 페이지 레지스트리 시스템

탐색은 일반 Next.js 라우팅이 아닌 **탭 + AdminShell 마운트** 방식이다:

- `src/lib/page-registry.tsx`의 `PAGE_REGISTRY: Record<href, {label, render}>` 가 단일 진리원.
- `AdminShell`이 모든 열린 탭을 `position:absolute` div로 동시 마운트하고 현재 pathname만 `display:flex`로 노출. **탭을 전환해도 다른 페이지의 state가 유지된다** (의도된 동작).
- 새 페이지 추가 시:
  1. `src/app/(admin)/<path>/page.tsx` — `*Client` 컴포넌트 import만
  2. `src/lib/page-registry.tsx` — `PAGE_REGISTRY`에 entry 추가
  3. `src/components/layout/Sidebar.tsx`의 `NAV_GROUPS` — 메뉴 항목 추가 (`adminOnly` 옵션)
- 탭 한도 `MAX_TABS = 10` (`TabsContext`). 초과 시 `openTab` 무시.

### 2. 인증 / 권한 모델

- 인증: `AuthContext` + localStorage(`ds_auth_user`). 서버 세션 없음. 새로고침 시 Supabase에서 `permissions/dept/theme` 재조회로 권한 변경 즉시 반영.
- `accounts.permissions: text[]` 가 단일 진리원. 값은 다음 중 하나:
  - `"admin"` — 전체 권한 (모든 메뉴/기능 통과)
  - `"site_manage"`, `"view_only"` — 레거시 플래그
  - `"menu:/path:read|create|update"` — 메뉴별 권한
- 권한 체크: `hasMenuPermission(user, href, "read"|"create"|"update")` 또는 `isAdmin(user)`. `AdminShell`이 라우트 가드도 수행 (`matchMenuHref`로 longest-prefix 매칭 → 권한 없으면 `/dashboard`로 리다이렉트).
- **권한 그룹**(`permission_groups` 테이블, `/data/permission-groups` 페이지): 그룹은 권한 템플릿이며 "↻ 멤버에 적용" 버튼이 `accounts.permissions`를 **덮어쓰기**(동기화) 방식. 그룹 자체가 런타임에 조회되지는 않음 — `accounts.permissions`만 인증에 사용. 그룹 변경 후 멤버 동기화를 잊으면 권한이 안 반영된다.

### 3. Supabase 직접 호출

- 모든 컴포넌트가 `import { supabase } from "@/lib/supabase"` 로 직접 SQL을 친다. 별도 API 레이어 없음.
- `src/lib/api-client.ts` / `src/lib/mock-*.ts` 는 **GitHub Pages 정적 배포 잔재**. 신규 코드는 Supabase 직접 호출 패턴을 따른다.
- RLS 정책은 거의 모두 `FOR ALL USING (TRUE) WITH CHECK (TRUE)` (개발 단계). 운영 전 정책 강화 필요.
- 환경변수: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`.env.local`)

### 4. 마이그레이션 운영

- 모든 스키마 변경은 `scripts/migration-<feature>.sql` 한 파일로. **날짜 순 X — 기능 단위 명명**.
- Supabase Dashboard → SQL Editor에서 수동 실행. CLI 자동화 없음.
- 작성 규칙:
  - 모두 idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS` ... `CREATE POLICY`)
  - 파일 끝에 `SELECT` 검증 쿼리로 결과 확인
  - 새 테이블이면 RLS 활성 + `allow_all_<table>` 정책 (개발 표준)
- 사용자 정보 관련 부속 테이블 패턴: `user_<entity>(id PK, user_id FK ON DELETE CASCADE, ...)`

### 5. 사원/개인정보 모델

`accounts` + 부속 1:N 테이블이 사원등록·개인정보수정 양쪽에서 공유:

| 테이블 | 용도 | 편집 위치 |
|--------|------|----------|
| `accounts` | 사원 본체 (성명·주민번호·gender·blood_type·dept·team·position·permissions·permission_group_id·uniform_*_size·theme·push_enabled·notifications_enabled 등) | 사원등록(admin) / 개인정보수정(본인) |
| `user_family_members` | 가족 + 긴급연락처 1명(`is_emergency` 부분 UNIQUE, `phone`) | 양쪽 |
| `user_vehicles` | 차량 (회사차량은 별도 페이지에서 관리) | 양쪽 (회사차량은 readOnly) |
| `user_certifications` | 자격증 (`self_check`, `acquired_date`, `expiry_date`, `issuer`, `cert_doc_url`) | 양쪽 |
| `user_career_history` | 경력 | 양쪽 |
| `user_rewards_punishments` | 상벌사항 | 양쪽 |
| `permission_groups` | 7개 시드 그룹 + 권한 템플릿 | `/data/permission-groups` |

저장 패턴: 1:N 테이블은 **전체 DELETE 후 INSERT 재삽입** (단순한 정합성 보장). 단, `user_vehicles`는 `vehicle_type='회사차량'` 행은 보존.

부속 1:N 테이블의 `user_id` 컬럼은 모두 `accounts.id` 를 가리킨다 (테이블 이름이 `user_*` 인 것은 레거시 명명). **PostgREST 에 노출된 `users` 테이블은 Supabase Auth 시스템 테이블(`auth.users`) 이므로 비즈니스 코드에서 호출 금지** — `supabase.from("accounts")` 만 사용.

### 6. UI 컨벤션

- 다크모드: Tailwind `class` 전략. 깜빡임 방지를 위해 `app/layout.tsx` head에 인라인 스크립트로 SSR 전에 `<html class="dark">` 적용. 모든 컴포넌트는 `dark:` variant를 함께 작성.
- 입력 자동 포맷 (어디서나 동일 함수 재구현):
  - 휴대폰: `010-0000-0000`
  - YYYYMMDD → YYYY-MM-DD (생년월일·취득일·만료일 등)
  - 주민번호 7번째 자리(1·3·5·7→남, 2·4·6·8→여)로 성별 자동 추정
- 폼: 일반적으로 `Enter` 키로 다음 입력란 포커스 이동 (한글 IME 조합 중 무시).
- 초기 비밀번호: `1234` (사원등록 시 `hashPassword("1234")`로 `accounts.password_hash` 세팅. 변경은 `/data/profile` 기본정보 탭).

---

## 프로젝트 개요 (도메인)

**승강기 유지보수 스마트 자재관리 시스템 (MVP)** — 현장 유지보수 기사(모바일)와 본사 자재 담당자(웹) 간의 자재 신청-출고-회수 흐름을 실시간 관리. 기존 엑셀/이카운트 ERP 체계를 대체하며 별도 ERP 연동 없이 독립 운영.

현재 상태: **개발 단계** — Next.js 16 (Web Admin) 작업 중. 모바일은 미착수.

## 기술 스택

| 계층 | 기술 (확정) |
|------|------------|
| Web Admin Frontend | **Next.js 16.2.4** (App Router) + React 19 + TypeScript + Tailwind CSS v4 |
| Mobile Frontend | React Native 또는 Flutter (미확정) |
| Backend / DB | **Supabase** (PostgreSQL) — 직접 호출. 별도 API 서버 없음 |
| Infra | AWS (EC2, RDS, S3) 또는 NCP (미확정) |
| 알림 | 카카오 알림톡 API (알리고, 비즈톡 등) (미연동) |

## 핵심 도메인 개념

### 자재 코드 체계 (12자리 고정)
```
[구분(1)] + [대분류(2)] + [중분류(2)] + [소분류(2)] + [일련번호(4)] + [수리품구분(1)]
```
- **구분**: DS 자사 자재 → `D`, TKE 등 외부 자재 → `_`(공백)
- **분류 코드**: 기계실 `01`, 승강로 `02` 등 (엑셀 코드표 참조)
- **일련번호**: 동일 분류 내 `0001~9999` 자동 채번
- **수리품구분**: 재사용 수리품 → `R`, 신품 → `_`(공백)
- 기존 TKE 파트번호는 원본 유지; 앞의 `D` 유무로 DS/TKE 구분

### 관리 계층 구조
```
현장(건물명) > 호기(승강기 번호)
```
모든 자재 신청·출고는 **호기 단위**로 기록됨.

### 업무 흐름 (Workflow)
1. 기사(모바일) → 호기별 자재 신청 (승인 절차 없음)
2. 담당자(웹) → 신청 확인 → 재고 있으면 즉시 출고 / 없으면 발주
3. 발주 자재 입고 시 → 시스템 입고 처리 + 기사에게 카카오톡 알림 발송
4. 기사 수령 → 최종 출고 완료 처리
5. 교체 후 회수 부품 → 기사(모바일)로 회수 등록 (시리얼번호 필수)

## 참조 데이터 파일 (시드용)

| 파일 | 내용 |
|------|------|
| `DS승강기_부품_코드_리스트_260424.xlsx` | 자재 코드 분류 체계 (대/중/소 코드표) |
| `TKE Part List_26.04.24.xls` | TKE 전체 파트 목록 |
| `TKE_Part_Price_List_26.04.24.xlsx` | TKE 파트 가격표 |
| `현장리스트.xlsx`, `현장호기정보.xlsx` | 관리 현장/호기 |
| `거래처리스트.xlsx`, `사용자리스트.xlsx` | 협력 거래처, 시스템 사용자 |
| `참조/이카운트 자재발주리스트.xlsx`, `참조/이카운트 판매현황_20XX.xlsx` | 기존 이카운트 이력 |

import 스크립트: `scripts/import-*.mjs` (Node로 직접 실행, dotenv로 Supabase 자격증명 로드).

## 비기능 요구사항 핵심

- 검색 API 응답: 500ms 이내
- 동시성: DB Transaction Isolation Level `Read Committed` 이상 (재고 정합성)
- 모바일 UI: 입력 필드 최소 48dp (장갑 착용 환경 고려)
- 웹 실시간 업데이트: WebSocket 또는 1분 단위 Polling

## 향후 확장 포인트

- 바코드/QR 스캔: `expo-barcode-scanner` 도입 가능하도록 데이터 필드 유지
- 이카운트 ERP 연동: `materials` 테이블에 `e_count_cd` 예비 컬럼 유지
