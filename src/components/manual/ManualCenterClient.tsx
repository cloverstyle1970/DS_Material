"use client";

import { useState, useEffect, FormEvent } from "react";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

interface ManualRecord {
  id: number;
  category: string;
  title: string;
  content: string;
  sort_order: number;
  updated_at: string;
  updated_by: string | null;
}

// ⚠️ 데이터베이스 테이블 미생성 시 노출할 기본 정적 메뉴얼 데이터 (강력한 예외 처리)
const STATIC_FALLBACK_MANUALS: ManualRecord[] = [
  {
    id: -1,
    category: "인적자원/사원",
    title: "사원용 개인정보수정 사용 설명서",
    content: `# 사원용 개인정보수정 사용 설명서

본 설명서는 시스템을 이용하는 **대솔이엘 임직원 여러분**이 본인의 인적 사항을 최신화하고 관리할 수 있도록 지원하는 **개인정보수정(마이프로필)** 메뉴의 이용 안내서입니다.

사원 여러분의 소중한 정보(연락처, 주소, 비상연락망, 자격 취득 등)가 누락 없이 관리될 수 있도록 수시로 확인하시고 변경 사항이 있을 시 아래 가이드에 따라 업데이트해 주시기 바랍니다.

---

## 1. 개인정보수정 페이지 접속 방법

1. 시스템 로그인 후 좌측 사이드바 또는 상단 메뉴에서 **[개인정보수정]** 탭을 클릭하여 접속합니다.
2. 상단에 본인의 이름과 사원번호가 올바르게 표시되는지 확인합니다.

![개인정보수정 화면 가이드](/images/manual/personal_info.png)

---

## 2. 탭별 상세 작성 및 변경 가이드

개인정보수정 메뉴는 총 **7개의 탭**으로 구성되어 있습니다. 각 탭의 입력 표준 규격은 아래와 같습니다.

\`\`\`
[기본정보] ➔ [가족정보] ➔ [경력] ➔ [차량등록] ➔ [교육 및 자격] ➔ [상벌사항] ➔ [발령/재직상태 이력]
\`\`\`

### 👤 2.1. 기본정보 탭
임직원의 기본적인 신상 명세와 근무복 사이즈, 비밀번호 등을 관리합니다.

* **📷 프로필 사진**: 3:4 증명사진 규격의 이미지 파일(\`jpg\`, \`png\`, \`webp\`)을 업로드합니다.
* **🔒 잠금 항목 (사원 수정 불가)**: **성명, 주민등록번호, 입사일, 부서, 직급, 재직상태**는 정보의 무결성을 위해 **사원이 직접 수정할 수 없도록 잠금 처리**되어 있습니다. 해당 정보에 정정이 필요한 경우 관리팀 담당자에게 직접 수정을 요청하십시오.
* **📍 주소 입력**: \`[우편번호]\` 버튼을 눌러 도로명 주소 검색을 통해 기본 주소를 입력한 뒤, 아파트 동·호수 등 상세 주소를 하단 칸에 명확히 입력합니다.
* **👕 근무복/안전화 사이즈**: 제공되는 단복 및 안전장구 지급을 위해 상의(예: 100, XL), 하의(예: 32), 안전화(예: 265) 사이즈를 정확히 입력합니다.
* **🔐 비밀번호 변경**: 본인의 현재 비밀번호를 입력하고, 새 비밀번호(4자 이상)를 두 번 입력한 뒤 \`[비밀번호 변경]\` 버튼을 누르면 즉시 적용됩니다.

> **주민등록번호 마스킹 안내**:
> 주민등록번호는 개인정보 보호를 위해 화면상에서 **\`900101-1******\`**과 같이 뒷자리 첫 번째 숫자(성별 구분)를 제외하고 안전하게 마스킹 처리되어 노출되므로 안심하셔도 됩니다.

---

### 👨‍👩‍👧 2.2. 가족정보 탭
가족 구성원의 신상 정보와 비상시 연락할 수 있는 **긴급연락망**을 등록합니다.

* **➕ 가족 추가**: 우측 상단의 \`[+ 가족 추가]\` 버튼을 눌러 구성원을 등록합니다.
* **🚨 긴급연락처 지정 (필수)**: 
  * 등록한 가족 구성원 중 **최소 1명**에게 반드시 **\`[긴급연락처 지정]\` 체크박스를 활성화**해 주십시오.
  * 긴급연락처로 지정된 가족은 **관계, 성명, 연락처가 모두 필수 입력**사항이 됩니다.
  * 지정된 연락처는 기본정보의 ''긴급연락망''에 자동으로 연동되어 긴급 상황 발생 시 회사가 신속하게 대처하는 데 활용됩니다.

---

### 💼 2.3. 경력 탭
입사 전 수행했던 과거 근무 이력을 등록합니다.

* 회사명(필수), 근무부서, 직급, 입사일, 퇴사일 및 구체적인 담당 업무를 작성하여 이력을 누적 관리합니다.
* 현재 재직 중인 대솔이엘 이전의 모든 경력 사항이 인사 정보로 활용됩니다.

---

### 🚗 2.4. 차량등록 탭
업무 또는 출퇴근 시 사용하는 차량을 등록하고 보험 및 유류 지원 등을 위해 관리합니다.

* **자차 / 렌트 / 기타** 차량 등록 시 **구분, 차량번호, 차종, 유종**을 빠짐없이 입력해야 저장됩니다.
* **회사차량 지정**: 본인에게 배정된 회사차량이 있는 경우, 목록에 **\`🔒 회사차량 (관리자 관리)\`** 배지가 표시되며 차량정보와 보험 정보는 관리자에 의해서만 자동 동기화 및 관리(사원 수정 불가)됩니다.

---

### 📜 2.5. 교육 및 자격 탭
승강기 자체점검인력 등록 및 각종 기술 자격증 이력을 관리합니다.

* **자체점검인력 여부**: 본인이 승강기 중급/고급 등 자체점검 자격을 갖추어 기술 업무를 수행하는 경우, **\`[✅ 자체점검여부]\`** 체크박스에 필히 체크해 주셔야 자재 출고 및 점검 승인 등의 시스템 권한이 원활하게 유지됩니다.
* **📂 자격증 사본 첨부**: 취득한 자격의 사본 파일(이미지 또는 PDF)을 \`[📁 파일 선택]\`을 통해 첨부할 수 있으며, 기존 첨부 파일을 웹상에서 즉시 클릭하여 열람해 볼 수 있습니다.

---

### 🏅 2.6. 상벌사항 탭 (읽기 전용)
회사에서 수여받은 우수사원 표창 등의 **포상 이력** 및 규정 위반 등의 **징계 이력**이 표시됩니다.
* 본 탭은 인사 정보 관리에 해당하여 사원이 직접 추가하거나 수정할 수 없으며 **조회만 가능**합니다.

---

### 📅 2.7. 발령/재직상태 이력 탭 (읽기 전용)
회사의 인사 발령에 따른 **입사, 퇴직, 휴직, 복직, 재입사**의 모든 상태 변동 흐름을 타임라인으로 보여줍니다.
* 사원의 근속 기간과 고용 형태 변화를 추적하는 화면으로, 사원은 **조회만 가능**하며 발령 사항 발생 시 관리자에 의해 정식 등록/업데이트됩니다.

---

## 3. 정보 저장 및 최종 검증

1. 정보를 입력하거나 정정한 후에는 화면 맨 아래에 위치한 **[저장]** 버튼을 반드시 클릭해야 데이터베이스에 반영됩니다.
2. 저장 실패 시 화면 하단에 **빨간색 경고 메세지**로 누락된 필드가 표시됩니다. (예: "가족정보 긴급연락처 지정 시 연락처는 필수입니다.") 안내 문구에 따라 해당 탭으로 이동하여 보완 후 다시 저장하십시오.
3. 저장이 정상 완료되면 **"개인정보가 저장되었습니다."**라는 **초록색 알림 문구**가 출력됩니다.`,
    sort_order: 10,
    updated_at: new Date().toISOString(),
    updated_by: "시스템",
  },
  {
    id: -2,
    category: "안전/TBM",
    title: "작업자용 TBM 등록 및 서명 설명서",
    content: `# 작업자용 TBM(Toolbox Meeting) 등록 및 서명 설명서

본 설명서는 현장에서 작업을 수행하기 전, 안전을 확보하고 작업 절차를 공유하기 위해 작성하는 **TBM(Toolbox Meeting) 일지 등록 및 서명** 기능의 이용 안내서입니다.

대솔이엘의 모든 기술 임직원은 산업안전보건법 및 사내 안전 관리 규정에 따라 **작업 시작 전 반드시 본 시스템을 통해 TBM을 작성하고 서명**을 완료해야 합니다.

---

## 1. TBM 등록 페이지 접속 방법

1. 모바일 또는 PC 시스템 로그인 후 좌측 메뉴에서 **[TBM]** 또는 **[TBM 등록]** 메뉴를 선택합니다.
2. 상단에 본인의 이름이 작성자로 올바르게 지정되었는지 확인합니다.

---

## 2. 단계별 상세 작성 가이드

TBM 등록 양식은 총 **8가지 핵심 영역**으로 구성되어 있습니다. 각 항목의 입력 방법은 아래와 같습니다.

![TBM 등록 화면 가이드](/images/manual/tbm_register.png)

### 🔌 2.1. 업무 구분 (업무 성격 지정)
오늘 진행할 작업의 성격에 맞춰 버튼을 터치하여 지정합니다.

* **🛠️ 공사**: 엘리베이터 설치, 교체, 주요 의장 공사 등 공사 작업을 수행할 때 선택합니다.
* **🔧 보수**: 예방 점검 및 부품 교체, 고장 대처 작업을 수행할 때 선택합니다. 보수 선택 시 아래 **3가지 세부 유형** 중 하나를 필히 지정해야 합니다:
  * **점검**: 정기 예방 점검 또는 자체 점검 시 선택합니다.
  * **부품교체**: 도어 슈, 로프, 쉬브, 제어반 부품 등 자재 교체 시 선택하며, 아래 \`교체 부품명\` 입력란에 대상 부품을 직접 입력합니다.
  * **고장처리**: 고장 신고 접수 후 현장 출동 시 선택하며, 제공되는 \`고장 증상\` 목록(예: 브레이크 이상, 도어 오작동 등)을 선택하고 \`승객 갇힘 여부\`를 반드시 체크(갇힘 없음 / 승객 갇힘)합니다.

---

### 📍 2.2. 현장 정보 입력
작업을 수행하는 빌딩 및 아파트 현장과 해당 엘리베이터의 호기를 지정합니다.

* **📅 공사일정에서 가져오기 (권장)**:
  * 본인에게 배정된 공사 및 점검 일정이 있는 경우, 최상단의 **일정 선택 셀렉트 박스**에 오늘 날짜 전후의 일정 목록이 나타납니다.
  * 해당 일정을 선택하면 **현장명, 호기명, 작업 내용이 자동으로 기입**되므로 더욱 빠르고 편리하게 등록할 수 있습니다.
* **✍️ 직접 입력**:
  * 배정된 일정이 없는 경우, \`현장명\` 입력란에 현장 이름의 일부를 입력한 뒤 아래로 나오는 자동완성 목록에서 선택하거나 직접 입력합니다.
  * 현장이 선택되면 해당 현장에 등록된 전체 호기 목록이 \`호기 선택\` 셀렉트 박스에 노출되므로, 실제 작업하는 호기(예: 1호기)를 선택합니다.

---

### 📝 2.3. 작업 내용 및 위험요소 기록
* **작업 내용 (필수)**: 당일 수행할 구체적인 기술적 작업 행위를 육하원칙에 의거하여 간결하고 명확하게 기록합니다. (예: "3호기 도어 인버터 및 세이프티 슈 마모로 인한 교체 작업")
* **위험요소 / 특이사항 (선택)**: 해당 작업 중 발생할 수 있는 주요 위험 요인(예: 감전 위험, 낙하 위험, 개구부 추락 등)과 작업 시 주의해야 할 특이사항을 기록합니다.

---

### ✅ 2.4. 작업 전 안전조치 체크리스트
* 선택한 업무 구분이 **공사**이거나 보수의 **점검**인 경우, 해당 작업 유형에 맞는 필수 사전 안전 점검 항목들이 노출됩니다.
* 안전화/안전모 등 개인 보호구 착용 상태, 제어반 주전원 차단 여부, 작업 표지판 설치 등 현장 상황을 육안으로 확인한 뒤 **모든 항목을 하나씩 터치하여 체크(✓)**합니다.

---

### ⚠️ 2.5. 핵심 안전수칙 지정
* 작업 종류별 핵심 안전 가이드를 확인하고 준수를 다짐하는 영역입니다.
* 상단의 태그 필터(\`전체\`, \`전기\`, \`공사\`, \`보수\`, \`구출\`, \`용접\`)를 터치하여 오늘 작업에 적합한 안전수칙 카테고리를 엽니다.
* 노출되는 안전수칙 리스트 중 오늘 철저히 준수해야 할 **수칙들의 체크박스를 선택**합니다. (복수 선택 가능)

---

### 👷 2.6. 동료 참가자 추가 (2인 1조 작업 등)
* 혼자 작업하는 단독 작업이 아닌, 동료와 함께 협동 작업을 수행할 때 사용합니다.
* \`이름 또는 부서 검색\` 란에 동료 사원의 이름(예: 홍길동)을 입력한 뒤, 검색 목록에서 대상을 선택하여 추가합니다.
* **TBM 기록 동기화**: 동료를 참가자로 등록하고 완료하면, 해당 동료 사원의 계정 내 [내 TBM 일지] 목록에도 본 TBM 기록이 동일하게 자동 등록되어 이중 기재의 번거로움이 사라집니다.

---

### 📸 2.7. 현장 사진 첨부
* 모바일 기기로 현장 사진을 직접 촬영하거나 저장된 이미지를 첨부합니다.
* \`📸 사진\` 영역의 카메라 아이콘이 있는 영역을 탭하면 **카메라 촬영 모드가 즉시 실행**되어 작업 전 전경이나 점검 대상 부품을 빠르게 촬영하여 등록할 수 있습니다. (최대 3장 권장)

---

### ✍ 2.8. 작업책임자 서명 및 등록
* 화면 가장 아래에 있는 서명 패드 영역에 **작업책임자(본인)의 서명**을 정자로 직접 서명합니다.
* 서명이 잘못된 경우 \`초기화\` 또는 \`Clear\` 버튼을 누르고 다시 작성할 수 있습니다.
* 모든 필수 항목 작성이 완료되었다면 화면 최하단의 **[📤 TBM 작성 완료]** 버튼을 클릭하여 안전 일지 등록을 마칩니다.

---

## 3. TBM 작성 시 핵심 유의 사항

> **1. 법적 증빙 자산으로서의 신뢰성**:
> 작성된 TBM 일지와 본인 서명은 향후 중대재해처벌법 및 산업안전보건법 관련 검증 시 **회사의 안전조치 이행 및 작업자 안전 교육을 증명하는 강력한 법적 효력**을 가집니다. 성실하고 사실에 입각하여 작성해 주십시오.
> 
> **2. 현장 동료의 참여 서명**:
> 2인 이상 작업 시 동료 참가자를 빠뜨리지 말고 입력하여 팀원 전체가 안전수칙을 공유했음을 누락 없이 증명하십시오.`,
    sort_order: 20,
    updated_at: new Date().toISOString(),
    updated_by: "시스템",
  },
  {
    id: -3,
    category: "현장/호기",
    title: "공사일정 등록 및 공사요청 사용 설명서",
    content: `# 공사일정 등록 및 공사요청 사용 설명서

본 설명서는 대솔이엘 시스템에서 공사 현장의 일정을 효율적으로 수립하고 협업하기 위해 제공되는 **공사 요청 및 공사일정(캘린더) 관리** 메뉴의 이용 안내서입니다.

현장의 원활한 자재 수급과 공사 진행, 안전 관리(TBM 연동)를 위해 공사 요청자 및 관리팀 담당자는 본 가이드에 따라 일정을 관리해 주시기 바랍니다.

---

## 1. 메뉴 접속 및 권한 안내

1. **공사 요청 페이지**: 로그인 후 좌측 사이드바에서 **[공사 요청]** 메뉴를 통해 진입합니다.
   * *대상*: 전 임직원 (현장 담당자, 관리자 모두 공사를 요청할 수 있습니다.)
2. **공사 일정 페이지**: 로그인 후 좌측 사이드바에서 **[공사 일정]** 메뉴를 통해 진입합니다.
   * *대상*: 전 임직원 조회 가능, **일정 등록/수정 권한 보유자(관리팀 및 관리자)**만 일정 및 연간 일정을 등록할 수 있습니다.

---

## 2. 공사 요청 가이드 (현장 담당자용)

신규 공사 건이 발생했거나 일정이 수립되어 공사 개시가 필요할 때 일정을 요청하는 단계입니다.

### 📝 2.1. 공사 요청 등록 방법
1. **[공사 요청]** 메뉴 우측 상단의 **[+ 공사 요청 등록]** 버튼을 클릭합니다.
2. 팝업 창에 아래 항목들을 정확히 입력합니다:
   * **현장명 (필수)**: 요청할 현장의 이름을 입력합니다. 입력 시 기존 등록된 현장 목록의 자동완성(\`Datalist\`)이 노출되므로 이를 선택하면 편리합니다.
   * **현장구분 (회사 구분)**: 해당 현장이 **TK(티케이엘리베이터)** 계약 현장인지, **DS(대솔이엘)** 자사 현장인지 선택합니다. **TK 현장 지정 시 블루 컬러 테두리**로 시인성이 향상됩니다.
   * **호기 정보**: 호기를 선택하거나 직접 기입합니다. (예: 101호기, 1~3호기)
   * **담당자 / 연락처**: 현장의 고객 측 담당자 성명 및 휴대전화 번호를 입력합니다. (연락처 입력 시 하이픈이 자동 입력됩니다.)
   * **공사내용 및 전달사항 (필수)**: 수행할 공사의 종류 및 세부 내용(예: "기계실 권상기 및 제어반 교체 공사")을 상세히 작성합니다.
3. **[등록하기]**를 눌러 제출합니다.

### 🔄 2.2. 요청 상태값 흐름
* **요청 (Red)**: 최초 등록된 상태이며, 담당자 본인은 수정/삭제가 가능합니다.
* **접수 (Gray)**: 관리팀에서 내용을 확인하고 내부 수용 상태로 변경한 상태입니다.
* **일정등록됨 (Blue)**: 관리자가 해당 요청을 기반으로 실제 캘린더에 일정을 조율하여 등록한 상태입니다. (이후 수정/삭제 불가)
* **완료 (Gray)**: 해당 현장의 공사가 모두 성공적으로 끝나 종료된 상태입니다.

---

## 3. 공사 일정 등록 및 조율 가이드 (관리팀 및 관리자용)

공사 요청을 접수하여 실제 공사 캘린더에 일정을 편제하고 배정하는 프로세스입니다.

![공사 일정 캘린더 화면 가이드](/images/manual/construction_calendar.png)

### 🔗 3.1. 공사 요청을 일정으로 전환하기 (연동)
1. **[공사 요청]** 메뉴에서 대기 중인 카드를 확인합니다.
2. 상태가 **\`요청\`**인 카드의 우측 하단에 있는 **[일정으로 등록 →]** 링크를 클릭합니다.
3. 클릭 시 **[공사 일정(캘린더)]** 메뉴로 자동 이동하며, **현장명, 호기명, 공사 상세 내용, 담당자 정보가 입력 폼에 자동으로 기입**되어 중복 기재 없이 즉시 일정 등록이 가능합니다.

### 📅 3.2. 캘린더에서 직접 일정 등록하기
1. **[공사 일정]** 메뉴 우측 상단의 **[+ 일정 등록]** 버튼을 누르거나, 달력 화면에서 **원하는 날짜 칸을 더블클릭/터치**합니다.
2. 입력창에서 아래 세부 필드를 작성합니다:
   * **시작일 / 종료일**: 공사가 진행될 기간을 지정합니다.
   * **작업시작시간 (24h)**: 현장 출근 및 작업 개시 예정 시간을 4자리 숫자로 입력하면 자동으로 시간 포맷이 적용됩니다. (예: \`0830\` 입력 시 \`08:30\` 자동 변환)
   * **현장명 / 현장구분 / 호기**: 공사가 수행될 공간 정보를 지정합니다.
   * **작업자**: 해당 공사에 투입될 현장 작업자(예: "홍길동, 김철수")를 지정합니다. 본 정보는 **TBM 안전 일지 작성의 기초 데이터**가 됩니다.
   * **공사내용 및 전달사항**: 상세 공사 가이드라인과 주의사항을 기입합니다.
3. **[저장]** 버튼을 누르면 달력에 공사 바(Bar)가 등록됩니다.

### 🛑 3.3. 공사휴무 기능
* 설날/추석 연휴나 회사 단체 휴무 등 전 현장 공사가 중단되는 날에는, 모달 하단 좌측의 **[공사휴무]** 버튼을 누릅니다.
* 현장명이 **\`공사휴무\`**로 일괄 자동 채워지며, 캘린더 상에 그린(Green) 컬러로 표기되어 전 직원이 휴무 일정을 한눈에 공유할 수 있습니다.

---

## 4. 캘린더 고급 활용법

* **🏢 계약처별 필터 기능**:
  * 상단 필터바의 **[전체 / TK / DS]** 버튼을 터치하여 원하는 계약처의 공사만 추려낼 수 있습니다.
* **🔍 현장명 실시간 검색**:
  * 상단 검색창에 키워드(예: "파크")를 입력하고 **[검색]**을 누르면, 달력 상에 해당 현장명이 포함된 공사 일정만 필터링되어 복잡한 일정 속에서 원하는 정보를 빠르게 서치할 수 있습니다.
* **🏖️ 연간일정 관리 (관리자 전용)**:
  * **[연간일정 관리]** 버튼을 누르면 단체 연차, 정기 휴무, 사내 행사 등을 달력 배경색 및 띠 배너로 등록할 수 있어 임직원의 근무 편의성을 높일 수 있습니다. (연차는 캘린더 배경이 **소프트한 레드**로 강조됩니다.)

---

## 5. TBM(안전 가이드)과의 상호 연동 안내

> **공사 일정 등록과 TBM 작성의 필수 고리**:
> 1. 본 메뉴를 통해 **공사 일정이 등록되면**, 해당 날짜의 작업자는 현장 모바일 기기에서 **[TBM 등록]** 시 **"공사일정에서 가져오기"**를 통해 해당 일정을 터치 한 번으로 즉시 연동할 수 있습니다.
> 2. 캘린더 상에서 **TBM이 미작성된 공사는 블랙 테두리**, **TBM 작성이 완료된 공사는 블루/화이트 테두리**로 실시간 연동 표출되므로 관리팀은 당일 현장 안전수칙 이행 현황을 달력에서 실시간 모니터링할 수 있습니다.`,
    sort_order: 30,
    updated_at: new Date().toISOString(),
    updated_by: "시스템",
  },
];

// 초경량 마크다운 ➔ HTML 변환 컴포넌트
function MarkdownRenderer({ text }: { text: string }) {
  const lines = text.split("\n");
  let inList = false;
  let inCode = false;
  let codeBlock: string[] = [];

  const renderedLines = lines.map((line, idx) => {
    // 1. 코드 블록 처리
    if (line.trim().startsWith("```")) {
      if (inCode) {
        inCode = false;
        const code = codeBlock.join("\n");
        codeBlock = [];
        return (
          <pre key={idx} className="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-4 py-3 rounded-lg overflow-x-auto text-xs font-mono my-3 border border-gray-200 dark:border-gray-700">
            <code>{code}</code>
          </pre>
        );
      } else {
        inCode = true;
        return null;
      }
    }

    if (inCode) {
      codeBlock.push(line);
      return null;
    }

    // 2. 제목 (Headers)
    if (line.startsWith("# ")) {
      return <h1 key={idx} className="text-2xl font-bold text-gray-900 dark:text-white mt-6 mb-3 border-b pb-2">{parseInline(line.slice(2))}</h1>;
    }
    if (line.startsWith("## ")) {
      return <h2 key={idx} className="text-xl font-bold text-gray-900 dark:text-white mt-5 mb-2.5">{parseInline(line.slice(3))}</h2>;
    }
    if (line.startsWith("### ")) {
      return <h3 key={idx} className="text-lg font-bold text-gray-900 dark:text-white mt-4 mb-2">{parseInline(line.slice(4))}</h3>;
    }

    // 3. 인용구 및 가이드 배지 (Blockquotes / Alert)
    if (line.startsWith("> ")) {
      const content = line.slice(2);
      if (content.startsWith("[!NOTE]") || content.startsWith("[!TIP]") || content.startsWith("[!IMPORTANT]")) {
        return null; // 배지 태그 제거
      }
      return (
        <blockquote key={idx} className="border-l-4 border-blue-500 bg-blue-50/50 dark:bg-blue-900/10 px-4 py-3 rounded-r-lg my-3 text-sm text-gray-700 dark:text-gray-300 italic">
          {parseInline(content)}
        </blockquote>
      );
    }

    // 4. 구분선 (Horizontal Rules)
    if (line.trim() === "---") {
      return <hr key={idx} className="my-6 border-gray-200 dark:border-gray-700" />;
    }

    // 5. 리스트 아이템 (Bullets)
    if (line.trim().startsWith("* ") || line.trim().startsWith("- ")) {
      const cleanLine = line.trim().slice(2);
      return (
        <li key={idx} className="list-disc ml-5 my-1 text-sm text-gray-700 dark:text-gray-300">
          {parseInline(cleanLine)}
        </li>
      );
    }

    // 5.5. 이미지 렌더링 (![설명](url))
    if (line.trim().startsWith("![") && line.trim().endsWith(")")) {
      const match = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (match) {
        const alt = match[1];
        const src = match[2];
        return (
          <div key={idx} className="my-4 flex flex-col items-center break-inside-avoid">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
              src={src} 
              alt={alt} 
              className="max-w-full h-auto rounded-xl border border-gray-200 dark:border-gray-700 shadow-md max-h-[400px] object-contain bg-gray-50 dark:bg-gray-800 p-1" 
            />
            {alt && <span className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">▲ {alt}</span>}
          </div>
        );
      }
    }

    // 6. 일반 문단
    if (line.trim() === "") {
      return <div key={idx} className="h-2" />;
    }

    return (
      <p key={idx} className="text-sm leading-relaxed text-gray-700 dark:text-gray-300 my-2">
        {parseInline(line)}
      </p>
    );
  }).filter(Boolean);

  return <div className="space-y-1">{renderedLines}</div>;
}

// 인라인 스타일 파서 (Bold, Code, Link)
function parseInline(text: string) {
  let parts: React.ReactNode[] = [text];

  // 1. 볼드 (**text**)
  parts = parts.flatMap((part) => {
    if (typeof part !== "string") return part;
    const regex = /\*\*([^*]+)\*\*/g;
    const pieces = [];
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(part)) !== null) {
      if (match.index > lastIndex) {
        pieces.push(part.slice(lastIndex, match.index));
      }
      pieces.push(<strong key={match.index} className="font-bold text-gray-900 dark:text-white">{match[1]}</strong>);
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < part.length) {
      pieces.push(part.slice(lastIndex));
    }
    return pieces;
  });

  // 2. 인라인 백틱 (`code`)
  parts = parts.flatMap((part) => {
    if (typeof part !== "string") return part;
    const regex = /`([^`]+)`/g;
    const pieces = [];
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(part)) !== null) {
      if (match.index > lastIndex) {
        pieces.push(part.slice(lastIndex, match.index));
      }
      pieces.push(
        <code key={match.index} className="bg-gray-100 dark:bg-gray-800 text-red-600 dark:text-red-400 px-1 py-0.5 rounded text-xs font-mono">
          {match[1]}
        </code>
      );
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < part.length) {
      pieces.push(part.slice(lastIndex));
    }
    return pieces;
  });

  // 3. 마크다운 링크 ([text](url))
  parts = parts.flatMap((part) => {
    if (typeof part !== "string") return part;
    const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const pieces = [];
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(part)) !== null) {
      if (match.index > lastIndex) {
        pieces.push(part.slice(lastIndex, match.index));
      }
      const url = match[2];
      pieces.push(
        <a key={match.index} href={url} target={url.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
          {match[1]}
        </a>
      );
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < part.length) {
      pieces.push(part.slice(lastIndex));
    }
    return pieces;
  });

  return parts;
}

export default function ManualCenterClient() {
  const { user } = useAuth();
  const meIsAdmin = user ? isAdmin(user) : false;

  const [manuals, setManuals] = useState<ManualRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number>(-1);
  const [loading, setLoading] = useState(true);
  const [isDbMode, setIsDbMode] = useState(false);

  // 편집용 상태
  const [editMode, setEditMode] = useState<"create" | "edit" | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("인적자원/사원");
  const [editContent, setEditContent] = useState("");
  const [editSortOrder, setEditSortOrder] = useState(10);
  const [saving, setSaving] = useState(false);

  // 카테고리 목록
  const CATEGORIES = ["인적자원/사원", "자재/입출고", "현장/호기", "견적/발주", "안전/TBM", "기타 도움말"];

  async function fetchManuals() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("manuals")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        setManuals(data as ManualRecord[]);
        setSelectedId(data[0].id);
        setIsDbMode(true);
      } else {
        // 테이블은 존재하나 데이터가 비어있을 때
        setManuals(STATIC_FALLBACK_MANUALS);
        setSelectedId(-1);
        setIsDbMode(true);
      }
    } catch (err) {
      console.warn("⚠️ manuals 테이블 조회가 불가능합니다. 정적 모드로 전환합니다:", err);
      setManuals(STATIC_FALLBACK_MANUALS);
      setSelectedId(-1);
      setIsDbMode(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchManuals();
  }, []);

  const activeManual = manuals.find((m) => m.id === selectedId) || manuals[0] || STATIC_FALLBACK_MANUALS[0];

  function startCreate() {
    setEditTitle("");
    setEditCategory("인적자원/사원");
    setEditContent("");
    setEditSortOrder((manuals.length ? Math.max(...manuals.map(m => m.sort_order)) : 0) + 10);
    setEditMode("create");
  }

  function startEdit() {
    if (!activeManual) return;
    setEditTitle(activeManual.title);
    setEditCategory(activeManual.category);
    setEditContent(activeManual.content);
    setEditSortOrder(activeManual.sort_order);
    setEditMode("edit");
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!editTitle.trim() || !editContent.trim()) {
      alert("제목과 내용을 모두 작성해주시기 바랍니다.");
      return;
    }
    setSaving(true);
    try {
      if (editMode === "create") {
        const { data, error } = await supabase
          .from("manuals")
          .insert({
            title: editTitle.trim(),
            category: editCategory,
            content: editContent,
            sort_order: Number(editSortOrder),
            updated_by: user?.name || "관리자",
          })
          .select()
          .single();

        if (error) throw error;
        alert("새 매뉴얼이 등록되었습니다.");
        setEditMode(null);
        await fetchManuals();
        if (data) setSelectedId(data.id);
      } else if (editMode === "edit" && activeManual) {
        const { error } = await supabase
          .from("manuals")
          .update({
            title: editTitle.trim(),
            category: editCategory,
            content: editContent,
            sort_order: Number(editSortOrder),
            updated_by: user?.name || "관리자",
            updated_at: new Date().toISOString(),
          })
          .eq("id", activeManual.id);

        if (error) throw error;
        alert("매뉴얼이 성공적으로 수정되었습니다.");
        setEditMode(null);
        await fetchManuals();
      }
    } catch (err) {
      console.error("매뉴얼 저장 오류:", err);
      alert("저장 실패: 데이터베이스가 아직 마이그레이션되지 않았거나 서버 통신 실패입니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!activeManual || activeManual.id < 0) return;
    if (!confirm(`정말로 매뉴얼 '${activeManual.title}'을(를) 삭제하시겠습니까?`)) return;

    try {
      const { error } = await supabase.from("manuals").delete().eq("id", activeManual.id);
      if (error) throw error;
      alert("매뉴얼이 삭제되었습니다.");
      await fetchManuals();
    } catch (err) {
      console.error("매뉴얼 삭제 실패:", err);
      alert("삭제 작업에 실패했습니다.");
    }
  }

  function handlePrint() {
    window.print();
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-gray-500">도움말 센터 데이터를 로딩 중입니다...</div>;
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden relative">
      {/* 🖨️ PDF 프린트 전용 미디어 스타일 삽입 */}
      <style>{`
        @media print {
          @page {
            margin: 2cm; /* A4 모든 페이지 사방 여백 강제 적용 (2페이지부터 상단 여백 보장) */
          }
          body {
            margin: 0 !important; /* body 마진 초기화, @page 여백이 페이지 단위로 정상 작동하도록 조치 */
          }
          /* 헤더, 사이드바, 탭 바, 각종 UI 버튼 비표시 */
          aside, header, nav, .no-print, button, select, input, textarea {
            display: none !important;
          }
          /* ⚠️ 비활성화(숨김)된 다른 모든 탭 뷰 강제 숨김 (가장 완벽한 SPA 프린팅 격리 방식) */
          div[style*="display: none"], 
          div[style*="display:none"] {
            display: none !important;
          }
          /* 전체 레이아웃 계층 플랫화 (Next.js 루트 및 AdminShell 구조 - display 변경 배제) */
          html, body, 
          body > div, 
          body > div > div, 
          body > div > div > div, 
          body > div > div > div > div, 
          body > div > div > div > div > div,
          main {
            overflow: visible !important;
            height: auto !important;
            min-height: 0 !important;
            position: static !important;
            background: white !important;
            color: black !important;
          }
          .print-area {
            display: block !important;
            position: static !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 20pt !important;
            box-shadow: none !important;
            border: none !important;
            background: white !important;
            color: black !important;
          }
          .print-title {
            text-align: center;
            font-size: 24pt !important;
            font-weight: bold;
            margin-bottom: 20pt;
            border-bottom: 2px solid #000;
            padding-bottom: 10pt;
          }
          h1, h2, h3 {
            page-break-after: avoid !important;
            break-after: avoid !important;
            color: black !important;
          }
          p, li, blockquote, pre {
            color: black !important;
            font-size: 10.5pt !important;
            line-height: 1.6 !important;
          }
          li {
            margin-left: 20pt !important;
          }
          blockquote {
            border-left: 4px solid #777 !important;
            background: #f9f9f9 !important;
            padding: 8pt 12pt !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          pre {
            background: #f4f4f4 !important;
            border: 1px solid #ddd !important;
            padding: 8pt !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            white-space: pre-wrap !important;
          }
          img {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            max-width: 100% !important;
            height: auto !important;
            display: block !important;
            margin: 10pt auto !important;
          }
        }
      `}</style>

      {/* 1. 상단 바 (도움말 헤더) */}
      <div className="no-print bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
            📖 대솔이엘 도움말 센터
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            시스템 사용법 가이드 및 사원·자재·TBM 현장 관리 매뉴얼을 수록합니다.
          </p>
        </div>

        <div className="flex gap-2">
          {!isDbMode && (
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 self-center">
              ⚠️ 로컬 오프라인 모드 (마이그레이션 전)
            </span>
          )}
          {meIsAdmin && isDbMode && !editMode && (
            <button
              type="button"
              onClick={startCreate}
              className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors"
            >
              ➕ 새 매뉴얼 추가
            </button>
          )}
          {editMode && (
            <button
              type="button"
              onClick={() => setEditMode(null)}
              className="px-3.5 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold transition-colors"
            >
              취소
            </button>
          )}
        </div>
      </div>

      {/* 2. 본문 및 사이드바 영역 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 좌측 도움말 사이드바 */}
        <aside className="no-print w-64 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col shrink-0">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700">
            <span className="text-xs font-bold text-gray-400">카테고리별 목차</span>
          </div>

          <nav className="flex-1 overflow-y-auto p-2 space-y-4">
            {CATEGORIES.map((cat) => {
              const catManuals = manuals.filter((m) => m.category === cat);
              if (catManuals.length === 0) return null;
              return (
                <div key={cat} className="space-y-1">
                  <div className="px-3 py-1 text-[11px] font-bold text-slate-500 tracking-wider">
                    {cat}
                  </div>
                  <div className="space-y-0.5">
                    {catManuals.map((m) => {
                      const isActive = m.id === selectedId;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setSelectedId(m.id);
                            setEditMode(null);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors truncate ${
                            isActive
                              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-semibold"
                              : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                          }`}
                        >
                          📄 {m.title}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </aside>

        {/* 우측 본문 보기 / 편집 영역 */}
        <main className="flex-1 overflow-y-auto p-6 bg-white dark:bg-gray-800/20">
          {editMode ? (
            /* ================= 📝 편집/등록 폼 ================= */
            <form onSubmit={handleSave} className="max-w-3xl mx-auto space-y-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-6 rounded-xl shadow-sm">
              <h2 className="text-sm font-bold text-gray-800 dark:text-white">
                {editMode === "create" ? "🆕 새 가이드 작성" : "📝 가이드 내용 수정"}
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">제목 *</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="예: 자재 신청 표준 업무 절차 가이드"
                    required
                    className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">카테고리 *</label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">정렬 순서 (숫자가 작을수록 우선 노출)</label>
                <input
                  type="number"
                  value={editSortOrder}
                  onChange={(e) => setEditSortOrder(Number(e.target.value))}
                  className="w-32 px-3 py-2 border rounded-lg dark:bg-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-gray-500">본문 내용 (마크다운 포맷 기재) *</label>
                  <span className="text-[10px] text-gray-400"># 대제목, ## 중제목, * 리스트, **굵게** 지원</span>
                </div>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="# 사원용 매뉴얼...&#10;&#10;기본 정보는 사원관리를 참고하십시오."
                  required
                  rows={16}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 text-sm font-mono text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setEditMode(null)}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-xs font-semibold"
                >
                  작성 취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-50"
                >
                  {saving ? "저장 중..." : "매뉴얼 저장"}
                </button>
              </div>
            </form>
          ) : activeManual ? (
            /* ================= 📄 매뉴얼 상세 뷰 ================= */
            <article className="print-area max-w-4xl mx-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6 sm:p-8 relative">
              
              {/* 인쇄 및 편집 버튼 (화면에서만 노출) */}
              <div className="no-print flex items-center justify-end gap-2 border-b pb-4 mb-6">
                {meIsAdmin && isDbMode && activeManual.id >= 0 && (
                  <>
                    <button
                      type="button"
                      onClick={startEdit}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300"
                    >
                      ✏️ 편집
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-xs font-semibold text-red-600"
                    >
                      🗑️ 삭제
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={handlePrint}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1 shrink-0"
                >
                  🖨️ PDF 출력 / 저장
                </button>
              </div>

              {/* 매뉴얼 본문 */}
              <div className="print-title border-b pb-3 mb-5">
                <span className="no-print text-xs font-semibold text-blue-600 dark:text-blue-400">{activeManual.category}</span>
                <h2 className="text-2xl font-black text-gray-900 dark:text-white mt-1">{activeManual.title}</h2>
                <div className="no-print flex items-center gap-4 text-[10px] text-gray-400 dark:text-gray-500 mt-2">
                  <span>최종 수정일: {new Date(activeManual.updated_at).toLocaleDateString()}</span>
                  {activeManual.updated_by && <span>수정자: {activeManual.updated_by}</span>}
                </div>
              </div>

              <div className="prose dark:prose-invert max-w-none">
                <MarkdownRenderer text={activeManual.content} />
              </div>
            </article>
          ) : (
            <div className="text-center py-16 text-sm text-gray-400">등록된 가이드가 없습니다.</div>
          )}
        </main>
      </div>
    </div>
  );
}
