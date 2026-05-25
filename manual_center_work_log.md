# 대솔이엘 도움말 센터 개발 및 트러블슈팅 종합 작업 일지 (Work Log)

본 문서는 대솔이엘 자재/인사 관리 시스템 내 **도움말 센터(Manual Center) 구축 및 다기능 PDF 인쇄 최적화** 작업 세션의 전체 진행 내역과 대화 요약, 기술적 트러블슈팅 해결 과정을 영구 보존하기 위해 작성된 종합 기록물입니다.

---

## 1. 🎯 프로젝트 수행 목표
임직원들이 시스템의 주요 기능(개인정보수정, TBM 등록, 공사요청/일정)을 쉽게 익히고 활용할 수 있도록 **자체 도움말 센터**를 개설하고, 이를 고품질 vector PDF 파일로 완벽하게 출력/인쇄할 수 있는 환경을 구축하는 것을 목표로 삼았습니다.

### 📋 요구사항 체크리스트 및 달성도
* [x] **도움말 센터(`/manual`) 페이지 개설 및 네비게이션 연동**
* [x] **초경량 마크다운 렌더러 구현 (제목, 리스트, 강조, 배지 지원)**
* [x] **화면 스크린샷 렌더링 지원 (`![설명](경로)` 파싱)**
* [x] **임직원 배포용 다기능 매뉴얼 3종 작성 및 DB 시딩**
  * `사원용 개인정보수정 사용 설명서` (인적자원/사원)
  * `작업자용 TBM 등록 및 서명 설명서` (안전/TBM)
  * `공사일정 등록 및 공사요청 사용 설명서` (현장/호기)
* [x] **강력한 데이터베이스 오프라인 예외 처리 (정적 백업 데이터 구비)**
* [x] **PDF 변환 및 인쇄 환경 최적화 (`@media print` 튜닝)**
  * [x] 정크 정보 (사이드바, 탭 목록 바, 편집 버튼) 차단
  * [x] 브라우저 기본 헤더/푸터 (URL, 제목, 날짜) 소거
  * [x] 1페이지 잘림/누락 방지 (레이아웃 상속 평탄화)
  * [x] 여러 탭 중복 인쇄 방지 (SPA 프린팅 격리 차단막 설정)
  * [x] 2페이지 이후 상단 여백 보장 (페이지별 마진 분할 이관)
* [x] **Git 버전 관리 (커밋 및 원격 master 브랜치 푸시 배포)**

---

## 2. ⏳ 연대기별 진행 과정 및 트러블슈팅 이력

### Phase 1: 도움말 센터 개설 및 개별 매뉴얼 작성
1. **도움말 센터 화면 컴포넌트 개발 (`ManualCenterClient.tsx`)**:
   * 카테고리 목차 사이드바와 본문 마크다운 파서, 인쇄 버튼, 그리고 관리자용 실시간 마크다운 에디터(수정/추가/삭제)가 결합된 단일 클라이언트 모듈을 구축했습니다.
2. **초기 시드 SQL 생성 및 병합 (`migration-add-manuals.sql`)**:
   * 1차적으로 개인정보수정 설명서를 담은 개별 마이그레이션 SQL을 생성하고, 병합기(`build-migration-all.mjs`)를 돌려 `migration-all.sql`로 조립했습니다.
3. **동작 실패 및 오류 인지 (PostgreSQL 파싱 에러 - Unterminated Quoted String)**:
   * **원인**: 설명서 내용 중 `기본정보의 '긴급연락망'에` 구절의 홀따옴표(`'`)가 SQL 문자열 상수를 조기 종료하여 에러 발생.
   * **해결**: 홀따옴표를 이스케이프 규격인 두 개의 홀따옴표(`''`)로 전면 이스케이프 처리 완료.

### Phase 2: 라우터 연동 및 스크린샷 매핑 (방안 1 이행)
1. **도움말 센터 클릭 시 페이지 없음(404) 발생 오류**:
   * **원인**: UI 레지스트리에는 주소가 잡혔으나, Next.js App Router of the physical route mapping file (`src/app/(admin)/manual/page.tsx`) was missing.
   * **해결**: 물리적인 페이지 엔트리 파일을 즉시 신설하여 `/manual` 경로 정상 개통.
2. **시각적 품질 향상을 위한 실제 사용자 화면 연동**:
   * 사용자의 선택에 따라 **로컬 Next.js `public` 스토리지 활용안(방안 1)**으로 방향을 정립.
   * 이에 맞춰 대솔이엘 시스템 UI 테마를 정교하게 모사한 프리미엄 스크린샷 이미지 3종을 설계 및 생성하여 `public/images/manual/` 폴더에 배치.
   * 마크다운 렌더러가 이미지를 감지하면 미려한 그림 카드로 파싱하도록 렌더러 내 이미지 파서 탑재.

### Phase 3: 완벽한 PDF 인쇄 및 레이아웃 튜닝 (5차 피드백 이행)
1. **인쇄 결과물이 화면과 상이한 현상 (스크린샷 누락)**:
   * **해결**: 이미지 태그에 씌워져 있던 `.no-print` 속성을 걷어내고, 인쇄 시 이미지가 반으로 쪼개져 출력되는 것을 방지하는 `break-inside: avoid !important` 규칙 수립.
2. **결과물이 아예 백지(Blank)로 출력되는 치명적 현상**:
   * **원인**: 스크롤 영역을 해제하고자 `.flex` 클래스 전체에 `display: block`을 주는 바람에, 높이(`height: 100%`)와 relative/absolute 좌표가 걸려있던 멀티탭 DOM 래퍼들의 높이가 전부 `0`으로 무너짐.
   * **해결**: 개별 유틸리티 클래스를 흔들지 않고, Next.js 본체가 위치하는 최상단 부모 컨테이너 5단계 계층구조만 정밀 타격하여 인쇄 플랫화(`display: block`, `overflow: visible`, `height: auto`, `position: static`)를 처리하도록 개편하여 백지 현상 해결.
3. **열려 있는 모든 탭이 하나의 문서로 중복 합산 출력되는 현상**:
   * **원인**: 부모 래퍼 플랫화 과정에서 비활성 탭들의 원래 스타일인 `display: none`이 무력화되어 마운트된 모든 탭이 함께 출력됨.
   * **해결**: 개별 탭 래퍼 (`body > div > div > div > div > div`)를 플랫화 그룹에서 별도 분리하여 display 속성 강제를 차단.
4. **일부 타 탭의 잔재 출력 잔존 현상**:
   * **해결**: 인쇄 시점에 숨겨지도록 이중 격리 차단막(`div[style*="display: none"] { display: none !important; }`)을 탑재해 완전한 개별 탭 격리 인쇄 달성.
   * 상단에 여전히 인쇄되던 불필요한 탭 버튼 그룹(`TabBar`) 컨테이너에 `no-print` 전역 클래스 적용.
5. **2페이지부터 상단 여백이 아예 밀착되어 답답해지는 현상**:
   * **원인**: 용지 여백을 `body` 마진으로 처리하면 브라우저는 용지 끝자락에서 body 경계를 한 번만 인식하므로, 쪼개진 2페이지부터는 마진이 0이 됨.
   * **해결**: 마진 제어를 A4 페이지 단위로 자동 계산하는 `@page { margin: 2cm; }` 스타일로 이관하고 `body { margin: 0 !important; }`로 튜닝하여 모든 용지 상단에 균일한 2cm의 아름다운 여백 완성.

---

## 3. 📂 물리적 최종 산출물 및 경로

본 세션을 통해 신설되거나 수정된 파일들의 위치입니다.

### 💻 프론트엔드 및 라우팅 코드
* 📄 **도움말 센터 페이지 엔트리**: [src/app/(admin)/manual/page.tsx](file:///h:/DS_Material/src/app/(admin)/manual/page.tsx) [NEW]
* 📄 **도움말 센터 클라이언트 컴포넌트**: [src/components/manual/ManualCenterClient.tsx](file:///h:/DS_Material/src/components/manual/ManualCenterClient.tsx) [MODIFY]
* 📄 **탭바 인쇄 방지 적용**: [src/components/layout/TabBar.tsx](file:///h:/DS_Material/src/components/layout/TabBar.tsx) [MODIFY]
* 📄 **경로 레지스트리 맵**: [src/lib/page-registry.tsx](file:///h:/DS_Material/src/lib/page-registry.tsx) [MODIFY]

### 🛢️ 데이터베이스 마이그레이션 SQL
* 📄 **도움말 센터 DB 세팅 및 초기 시드**: [scripts/migration-add-manuals.sql](file:///h:/DS_Material/scripts/migration-add-manuals.sql) [MODIFY]
* 📄 **통합 마이그레이션 스크립트**: [scripts/migration-all.sql](file:///h:/DS_Material/scripts/migration-all.sql) [MODIFY]

### 📸 가이드 스크린샷 이미지 리소스
* 📂 **스크린샷 보관 경로**: [public/images/manual/](file:///h:/DS_Material/public/images/manual) [NEW]
  * 🖼️ `personal_info.png` (개인정보수정 화면 가이드)
  * 🖼️ `tbm_register.png` (TBM 등록 가이드)
  * 🖼️ `construction_calendar.png` (공사일정/캘린더 가이드)

---

## 4. 🔒 마스터 브랜치 배포 무결성 검증 결과
* **TypeScript 컴파일 검사 결과**: `npx tsc --noEmit` ➔ **오류 0건 (완벽 통과)**
* **Git 배포 상태**: `origin/master` 원격 동기화 및 푸시 완료.

---

대솔이엘 도움말 센터와 완벽한 vector PDF 출력 환경은 임직원들에게 최상의 안내서가 될 것입니다. 작업 완료를 다시 한번 축하합니다!
