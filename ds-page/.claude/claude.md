# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**승강기 유지보수 스마트 자재관리 시스템 (MVP)**

현장 유지보수 기사(모바일)와 본사 자재 담당자(웹) 간의 자재 신청-출고-회수 흐름을 실시간으로 관리하는 시스템. 기존 엑셀/이카운트 ERP 체계를 대체하며, 별도 ERP 연동 없이 독립 운영됨.

현재 상태: **개발 단계** — Next.js 16 (Web Admin) 초기화 완료.

## 개발 명령어

```bash
npm run dev      # 개발 서버 시작 (http://localhost:3000), Turbopack 사용
npm run build    # 프로덕션 빌드
npm run start    # 프로덕션 서버 시작
npm run lint     # ESLint 검사
```

## 아키텍처

| 계층 | 기술 (확정) |
|------|------------|
| Web Admin Frontend | **Next.js 16** (App Router, TypeScript, Tailwind CSS) |
| Mobile Frontend | React Native 또는 Flutter (미확정) |
| Backend API | Node.js (NestJS) 또는 Python (FastAPI) (미확정) |
| Database | PostgreSQL (pg_trgm 모듈로 부분 일치 검색) |
| Infra | AWS (EC2, RDS, S3) 또는 NCP |
| 알림 | 카카오 알림톡 API (알리고, 비즈톡 등) |

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

## 주요 API 엔드포인트 (설계)

**모바일 (기사용)**
- `GET /v1/materials` — 자재 통합 검색 + 실시간 재고 조회
- `POST /v1/requests` — 자재 신청 (호기 정보 필수)
- `GET /v1/requests/history` — 담당 현장 투입 이력
- `POST /v1/returns` — 회수 자재 등록

**웹 (관리자용)**
- `PATCH /v1/requests/{id}/status` — 출고 처리 및 상태 변경
- `POST /v1/orders` — 부족 자재 외부 발주
- `GET /v1/stats/monthly` — 월간 현장별/호기별 출고 통계

## 핵심 DB 테이블 (설계)

- **materials**: `material_id(PK, VARCHAR 12)`, `name`, `alias`, `model_no`, `storage_loc`, `stock_qty`, `is_repair`, `e_count_cd`(이카운트 연동 예비 컬럼)
- **sites**: `site_id`, `site_name`, `address`
- **elevators**: `elevator_id`, `site_id(FK)`, `ho_gi_no`
- 검색 인덱스: `name`, `alias`, `model_no`에 `pg_trgm` GIN 인덱스 적용

## 참조 데이터 파일

| 파일 | 내용 |
|------|------|
| `DS승강기_부품_코드_리스트_260424.xlsx` | 자재 코드 분류 체계 (대/중/소 코드표) |
| `TKE Part List_26.04.24.xls` | TKE 전체 파트 목록 |
| `TKE_Part_Price_List_26.04.24.xlsx` | TKE 파트 가격표 |
| `현장리스트.xlsx` | 관리 현장 목록 |
| `현장호기정보.xlsx` | 현장별 호기 정보 |
| `거래처리스트.xlsx` | 협력 거래처 목록 |
| `사용자리스트.xlsx` | 시스템 사용자 목록 |
| `참조/이카운트 자재발주리스트.xlsx` | 기존 이카운트 발주 이력 |
| `참조/이카운트 판매현황_20XX.xlsx` | 연도별 판매 이력 (시드 데이터 참고) |

## 비기능 요구사항 핵심

- 검색 API 응답: 500ms 이내
- 동시성: DB Transaction Isolation Level `Read Committed` 이상 (재고 정합성)
- 모바일 UI: 입력 필드 최소 48dp (장갑 착용 환경 고려)
- 웹 실시간 업데이트: WebSocket 또는 1분 단위 Polling

## 향후 확장 포인트

- 바코드/QR 스캔: `expo-barcode-scanner` 도입 가능하도록 데이터 필드 유지
- 이카운트 ERP 연동: `materials` 테이블에 `e_count_cd` 예비 컬럼 유지
