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
          /* 헤더, 사이드바, 탭 바, 각종 UI 버튼 비표시 */
          aside, header, nav, .no-print, button, select, input, textarea {
            display: none !important;
          }
          /* 전체 레이아웃 초기화 */
          body, .flex, .overflow-hidden {
            display: block !important;
            overflow: visible !important;
            background: white !important;
            color: black !important;
          }
          .print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
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
            page-break-after: avoid;
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
          }
          pre {
            background: #f4f4f4 !important;
            border: 1px solid #ddd !important;
            padding: 8pt !important;
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
