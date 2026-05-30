"use client";

// ============================================================
// 근무복·안전장구 — 관리자 직접 불출 등록 탭
// ------------------------------------------------------------
// · 신청 절차 없이 바로 지급 (uniform_safety_requests status='수령완료' 로 1단계 생성)
// · 출고 트랜잭션(add_transaction RPC) 라인별 호출 → 재고 차감 + 출고이력 반영
// · 근무복 + 사이즈 있을 때 users.uniform_top_size / uniform_bottom_size 동기화
// · 엑셀 일괄 업로드 (xlsx 라이브러리) — 사전 검증 후 일괄 처리
// ============================================================

import { useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { fmtNum } from "@/lib/format";
import * as XLSX from "xlsx";

// ────────────────────────────────────────────────────────────
// 타입
// ────────────────────────────────────────────────────────────

interface UserMini { id: number; name: string; dept: string | null; }

export interface MaterialOption {
  id: string;
  name: string;
  unit: string | null;
  model_no: string | null;
  stock_qty: number | null;
  request_type?: "근무복" | "안전장구"; // load 시 주입
}

type ReqType = "근무복" | "안전장구";

interface FormLine {
  key: string;
  sub_code: string;
  material_id: string;
  size: string;
  qty: number;
}

interface BulkRow {
  rowNo: number;
  user_name: string;
  user_dept: string;
  request_type: string;
  material_id: string;
  size: string;
  qty: number;
  note: string;
  // 검증 결과
  user?: UserMini;
  material?: MaterialOption;
  errors: string[];
}

interface Props {
  users: UserMini[];
  materials: MaterialOption[];
  subLabels: { uniform: Map<string, string>; safety: Map<string, string> };
  canUpdate: boolean;
  onCompleted: () => void | Promise<void>;
}

// ────────────────────────────────────────────────────────────
// 유틸
// ────────────────────────────────────────────────────────────

const subCodeOf = (id: string) => id.length >= 7 ? id.substring(5, 7) : "";

// ────────────────────────────────────────────────────────────

export default function UniformSafetyDirectIssueTab({
  users, materials, subLabels, canUpdate, onCompleted,
}: Props) {
  const { user } = useAuth();

  // 단일 등록 폼
  const [reqType,  setReqType]  = useState<ReqType>("근무복");
  const [userId,   setUserId]   = useState<string>("");
  const [note,     setNote]     = useState("");
  const [lines,    setLines]    = useState<FormLine[]>([
    { key: crypto.randomUUID(), sub_code: "", material_id: "", size: "", qty: 1 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 엑셀 업로드 상태
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkFile, setBulkFile] = useState<string>("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 자재 풀을 구분별로 분리
  const uniformMats = useMemo(() => materials.filter(m => m.request_type === "근무복"), [materials]);
  const safetyMats  = useMemo(() => materials.filter(m => m.request_type === "안전장구"), [materials]);

  // 폼 탭의 소분류 그룹: sub_code → {label, materials[]}
  const groups = useMemo(() => {
    const list = reqType === "근무복" ? uniformMats : safetyMats;
    const labelMap = reqType === "근무복" ? subLabels.uniform : subLabels.safety;
    const bySub = new Map<string, MaterialOption[]>();
    for (const m of list) {
      const s = subCodeOf(m.id);
      const arr = bySub.get(s) ?? [];
      arr.push(m);
      bySub.set(s, arr);
    }
    // 카테고리 라벨이 비어있으면 sub_code 자체를 라벨로 (자재 첫 항목명 fallback)
    if (labelMap.size === 0) {
      return Array.from(bySub.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([s, mats]) => ({ subCode: s, groupLabel: mats[0]?.name ?? `sub-${s}`, materials: mats }));
    }
    return Array.from(labelMap.entries())
      .filter(([s]) => s !== "99")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([s, label]) => ({ subCode: s, groupLabel: label, materials: bySub.get(s) ?? [] }));
  }, [reqType, uniformMats, safetyMats, subLabels]);

  // 자재 ID → 자재 정보 lookup (검증/카테고리 라벨용)
  const matById = useMemo(() => {
    const m = new Map<string, MaterialOption>();
    for (const x of materials) m.set(x.id, x);
    return m;
  }, [materials]);

  // ────────────────────────────────────────────────────────────
  // 공용 처리: 단일 / 그룹 단위
  // ────────────────────────────────────────────────────────────

  async function processOneIssuance(payload: {
    request_type: ReqType;
    user: UserMini;
    note: string | null;
    items: Array<{ material_id: string; material_name: string; category_label: string | null; size: string | null; qty: number }>;
  }) {
    if (!user) throw new Error("로그인이 필요합니다.");
    const { request_type, user: target, note, items } = payload;

    // 사전 재고 검증
    const needMap = new Map<string, number>();
    for (const it of items) needMap.set(it.material_id, (needMap.get(it.material_id) ?? 0) + it.qty);
    const { data: stockRows, error: stockErr } = await supabase
      .from("materials").select("id, name, stock_qty").in("id", Array.from(needMap.keys()));
    if (stockErr) throw stockErr;
    const stockMap = new Map((stockRows ?? []).map(r => [r.id as string, { name: r.name as string, qty: (r.stock_qty as number) ?? 0 }]));
    const insufficient: string[] = [];
    for (const [mid, need] of needMap.entries()) {
      const info = stockMap.get(mid);
      if (!info || info.qty < need) insufficient.push(`${info?.name ?? mid} (필요 ${need} / 재고 ${info?.qty ?? 0})`);
    }
    if (insufficient.length > 0) throw new Error(`재고 부족:\n- ${insufficient.join("\n- ")}`);

    const now = new Date().toISOString();

    // 1) 신청 헤더 (수령완료 상태로 한 번에)
    const { data: header, error: e1 } = await supabase.from("uniform_safety_requests").insert({
      request_type,
      status:         "수령완료",
      user_id:        target.id,
      user_name:      target.name,
      user_dept:      target.dept ?? null,
      note,
      requested_at:   now,
      processed_at:   now,
      processor_id:   user.id,
      processor_name: user.name,
      received_at:    now,
    }).select().single();
    if (e1 || !header) throw e1 || new Error("신청 헤더 생성 실패");

    // 2) 라인 insert
    const { error: e2 } = await supabase.from("uniform_safety_request_items").insert(
      items.map((it, idx) => ({ ...it, request_id: header.id, sort_order: (idx + 1) * 10 }))
    );
    if (e2) throw e2;

    // 3) 출고 트랜잭션 (라인별, 동일 batch_id)
    const batchId = crypto.randomUUID();
    const siteName = `[지급] ${target.name}`;
    for (const it of items) {
      const noteParts = [
        `${request_type} 직접불출 #${header.id}`,
        target.dept ? `부서 ${target.dept}` : null,
        it.category_label ? `구분 ${it.category_label}` : null,
        it.size ? `사이즈 ${it.size}` : null,
      ].filter(Boolean) as string[];
      const { data, error } = await supabase.rpc("add_transaction", {
        p_type:            "출고",
        p_material_id:     it.material_id,
        p_material_name:   it.material_name,
        p_qty:             it.qty,
        p_site_name:       siteName,
        p_note:            noteParts.join(" / "),
        p_user_id:         user.id,
        p_user_name:       user.name,
        p_elevator_name:   null,
        p_serial_nos:      null,
        p_requires_return: false,
        p_batch_id:        batchId,
      });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((data as any)?.error) throw new Error((data as any).error);
    }

    // 4) 근무복 사이즈 동기화 (라벨 기준)
    if (request_type === "근무복") {
      const update: Record<string, string> = {};
      for (const it of items) {
        if (!it.size) continue;
        if (it.category_label && /상의|점퍼|자켓|재킷/.test(it.category_label)) update.uniform_top_size    = it.size;
        if (it.category_label && /하의|바지/.test(it.category_label))         update.uniform_bottom_size = it.size;
      }
      if (Object.keys(update).length > 0) {
        await supabase.from("accounts").update(update).eq("id", target.id);
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  // 단일 등록 폼
  // ────────────────────────────────────────────────────────────

  function updateLine(idx: number, patch: Partial<FormLine>) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }

  async function submitSingle() {
    setMessage(null);
    if (!canUpdate) { setMessage({ type: "error", text: "권한이 없습니다." }); return; }
    if (!userId) { setMessage({ type: "error", text: "수령자를 선택하세요." }); return; }
    const target = users.find(u => String(u.id) === userId);
    if (!target) { setMessage({ type: "error", text: "수령자 정보를 찾을 수 없습니다." }); return; }
    const valid = lines.filter(l => l.material_id);
    if (valid.length === 0) { setMessage({ type: "error", text: "자재를 1건 이상 선택하세요." }); return; }
    for (const l of valid) {
      if (l.qty < 1) { setMessage({ type: "error", text: "수량은 1 이상이어야 합니다." }); return; }
    }

    const labelMap = reqType === "근무복" ? subLabels.uniform : subLabels.safety;
    const items = valid.map(l => {
      const m = matById.get(l.material_id);
      const sub = subCodeOf(l.material_id);
      return {
        material_id:    l.material_id,
        material_name:  m?.name ?? "",
        category_label: labelMap.get(sub) ?? (reqType === "근무복" ? "근무복" : "안전장구"),
        size:           l.size.trim() || null,
        qty:            l.qty,
      };
    });

    setSubmitting(true);
    try {
      await processOneIssuance({
        request_type: reqType,
        user: target,
        note: note.trim() || null,
        items,
      });
      setMessage({ type: "success", text: `${target.name} (${target.dept ?? ""}) 에게 ${items.length}건 직접 불출 완료. 재고 차감·이력 반영됨.` });
      setLines([{ key: crypto.randomUUID(), sub_code: "", material_id: "", size: "", qty: 1 }]);
      setNote("");
      await onCompleted();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  // ────────────────────────────────────────────────────────────
  // 엑셀 업로드
  // ────────────────────────────────────────────────────────────

  function downloadTemplate() {
    const data = [
      ["수령자명", "부서", "구분", "자재코드", "사이즈", "수량", "비고"],
      ["홍길동",   "기술팀",  "근무복",   "D9902010001_", "L",   1, "예시"],
      ["홍길동",   "기술팀",  "근무복",   "D9902020001_", "95",  1, ""],
      ["김철수",   "",       "안전장구", "D9903010001_", "",    1, ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 18 }, { wch: 8 }, { wch: 6 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "불출등록");
    XLSX.writeFile(wb, "직접불출_템플릿.xlsx");
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setBulkMessage(null);
    const f = e.target.files?.[0];
    if (!f) return;
    setBulkFile(f.name);
    console.log(`[bulk-upload] 파일 선택: ${f.name} (${f.size} bytes, type=${f.type || "(빈 mime)"})`);

    const reader = new FileReader();
    // 동일 파일 재선택 시에도 onChange 가 발화되도록 처리 끝나면 input value 비움
    const resetInput = () => { if (fileInputRef.current) fileInputRef.current.value = ""; };
    reader.onerror = () => {
      console.error("[bulk-upload] FileReader 실패:", reader.error);
      setBulkMessage({ type: "error", text: `파일 읽기 실패: ${reader.error?.message ?? "알 수 없는 오류"}` });
      setBulkRows([]);
      resetInput();
    };
    reader.onload = () => {
      try {
        const ab = reader.result as ArrayBuffer;
        if (!ab || ab.byteLength === 0) throw new Error("파일이 비어있습니다");
        const wb = XLSX.read(ab, { type: "array" });
        console.log("[bulk-upload] 시트 목록:", wb.SheetNames);
        if (!wb.SheetNames || wb.SheetNames.length === 0) throw new Error("엑셀에 시트가 없습니다");
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        if (!ws || !ws["!ref"]) throw new Error(`시트 '${sheetName}' 가 비어있습니다`);
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        console.log(`[bulk-upload] 시트='${sheetName}' 데이터 ${rows.length}행, 첫 행 키:`, rows[0] ? Object.keys(rows[0]) : "(없음)");
        if (rows.length === 0) throw new Error(`시트 '${sheetName}' 에 데이터 행이 없습니다 (첫 행은 헤더로 인식됨)`);
        // null-safe 헤더 정규화 (헤더 셀이 비어 sheet_to_json 이 null 키를 만들 가능성도 방어)
        const normStr = (v: unknown): string => (v == null ? "" : String(v)).replace(/[\s ]+/g, "").toLowerCase();
        const rawKeys = Object.keys(rows[0]);
        const normKeyMap = new Map(rawKeys.map(k => [normStr(k), k]));
        const parsed: BulkRow[] = rows.map((r, i) => {
          const pick = (k: string[]): string => {
            for (const key of k) {
              const realKey = normKeyMap.get(normStr(key));
              if (realKey === undefined) continue;
              const v = r[realKey];
              if (v == null) continue;
              const s = String(v).trim();
              if (s !== "") return s;
            }
            return "";
          };
          const qtyRaw = pick(["수량", "qty", "개수", "수"]);
          const qty    = Math.max(1, Math.floor(Number(qtyRaw) || 0));
          const row: BulkRow = {
            rowNo:        i + 2,
            user_name:    pick(["수령자명", "수령자", "이름", "성명", "사용자", "사용자명"]),
            user_dept:    pick(["부서", "소속", "팀", "부서명"]),
            request_type: pick(["구분", "타입", "종류", "request_type", "type"]),
            material_id:  pick(["자재코드", "자재ID", "자재id", "코드", "물품코드", "품목코드", "material_id", "id"]),
            size:         pick(["사이즈", "size", "치수"]),
            qty,
            note:         pick(["비고", "메모", "비고사항", "note"]),
            errors:       [],
          };
          // 검증
          if (!row.user_name)    row.errors.push("수령자명 누락");
          if (!row.request_type) row.errors.push("구분 누락");
          if (!row.material_id)  row.errors.push("자재코드 누락");
          if (qty < 1)           row.errors.push("수량은 1 이상");
          if (row.request_type && !["근무복","안전장구"].includes(row.request_type)) {
            row.errors.push(`구분은 '근무복' 또는 '안전장구' (입력값: ${row.request_type})`);
          }
          // 사용자 매칭 (이름 + 부서)
          // - 양쪽 모두 모든 공백(NBSP 포함) 제거 후 비교 → 보이지 않는 공백 차이로 인한 실패 방지
          // - 부서가 입력됐어도 부서로 매칭 실패 시, 이름으로 유일하면 그 한 명을 채택
          const norm = (v: unknown) => (v == null ? "" : String(v)).replace(/[\s ]+/g, "");
          const targetName = norm(row.user_name);
          const sameName = users.filter(u => norm(u.name) === targetName);
          let candidates = sameName;
          if (row.user_dept) {
            const targetDept = norm(row.user_dept);
            const byDept = sameName.filter(u => norm(u.dept ?? "") === targetDept);
            if (byDept.length > 0) candidates = byDept;
            // 부서 일치 없을 때는 sameName 그대로 → 동명이인이면 아래에서 에러 처리
          }
          if (candidates.length === 0) {
            const hint = sameName.length > 0
              ? `등록된 동명 ${sameName.length}명: ${sameName.map(u => `${u.name}(${u.dept ?? "-"})`).join(", ")}`
              : `등록된 사용자 ${users.length}명 중 동명 0명`;
            row.errors.push(`사용자 '${row.user_name}'${row.user_dept ? `(${row.user_dept})` : ""} 찾을 수 없음 — ${hint}`);
          } else if (candidates.length > 1) {
            row.errors.push(`동명이인 ${candidates.length}명: ${candidates.map(u => u.dept ?? "-").join(", ")}. 부서를 함께 입력하세요`);
          } else {
            row.user = candidates[0];
          }
          // 자재 매칭
          if (row.material_id) {
            const m = matById.get(row.material_id);
            if (!m) row.errors.push(`자재코드 '${row.material_id}' 미등록`);
            else {
              row.material = m;
              // 구분-코드 prefix 정합성
              if (row.request_type === "근무복"   && !row.material_id.startsWith("D9902")) row.errors.push("근무복은 D9902 코드만");
              if (row.request_type === "안전장구" && !row.material_id.startsWith("D9903")) row.errors.push("안전장구는 D9903 코드만");
            }
          }
          return row;
        });
        setBulkRows(parsed);
        const errCnt = parsed.filter(r => r.errors.length > 0).length;
        setBulkMessage({
          type: errCnt > 0 ? "info" : "success",
          text: `${parsed.length}행 읽음 · 오류 ${errCnt}행${errCnt > 0 ? ' (수정 후 다시 업로드하거나 일괄 등록 시 해당 행은 건너뜀)' : ''}`,
        });
      } catch (err) {
        console.error("[bulk-upload] 파싱 실패:", err);
        setBulkMessage({ type: "error", text: `엑셀 파싱 실패: ${err instanceof Error ? err.message : String(err)} (브라우저 콘솔에서 상세 로그 확인)` });
        setBulkRows([]);
      } finally {
        resetInput();
      }
    };
    reader.readAsArrayBuffer(f);
  }

  async function applyBulk() {
    setBulkMessage(null);
    if (!canUpdate) { setBulkMessage({ type: "error", text: "권한이 없습니다." }); return; }
    const ok = bulkRows.filter(r => r.errors.length === 0 && r.user && r.material);
    if (ok.length === 0) { setBulkMessage({ type: "error", text: "처리할 수 있는 행이 없습니다." }); return; }

    // (user_id + request_type) 그룹핑
    const groups = new Map<string, { user: UserMini; request_type: ReqType; items: BulkRow[] }>();
    for (const r of ok) {
      const key = `${r.user!.id}|${r.request_type}`;
      const g = groups.get(key);
      if (g) g.items.push(r);
      else groups.set(key, { user: r.user!, request_type: r.request_type as ReqType, items: [r] });
    }

    setBulkSubmitting(true);
    let success = 0, fail = 0;
    const failMsgs: string[] = [];
    for (const g of groups.values()) {
      const labelMap = g.request_type === "근무복" ? subLabels.uniform : subLabels.safety;
      const items = g.items.map(r => ({
        material_id:    r.material_id,
        material_name:  r.material!.name,
        category_label: labelMap.get(subCodeOf(r.material_id)) ?? (g.request_type === "근무복" ? "근무복" : "안전장구"),
        size:           r.size.trim() || null,
        qty:            r.qty,
      }));
      // 그룹의 비고는 첫 라인의 비고를 사용 (그룹 묶음이므로)
      const note = g.items.find(r => r.note)?.note ?? null;
      try {
        await processOneIssuance({ request_type: g.request_type, user: g.user, note, items });
        success += g.items.length;
      } catch (e) {
        fail += g.items.length;
        failMsgs.push(`${g.user.name} (${g.request_type}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setBulkSubmitting(false);
    setBulkMessage({
      type: fail === 0 ? "success" : "error",
      text: `완료: 성공 ${success}건 / 실패 ${fail}건${failMsgs.length ? "\n\n" + failMsgs.join("\n") : ""}`,
    });
    if (success > 0) {
      // 처리된 행 제거, 실패 행은 남겨둠
      const failedKeys = new Set<number>();
      for (const g of groups.values()) {
        // success 라인을 알기 어려우니, 전부 실패한 그룹만 남김. (단순화)
        if (failMsgs.some(m => m.startsWith(g.user.name + " "))) {
          for (const r of g.items) failedKeys.add(r.rowNo);
        }
      }
      setBulkRows(prev => prev.filter(r => r.errors.length > 0 || failedKeys.has(r.rowNo)));
      await onCompleted();
    }
  }

  // ────────────────────────────────────────────────────────────
  // 렌더
  // ────────────────────────────────────────────────────────────

  const labelCls = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1";
  const inputCls = "w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100";
  const cardCls  = "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5";

  return (
    <div className="px-6 py-4 space-y-4 max-w-5xl">
      {/* ───── 단일 등록 폼 ───── */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">단일 직접 불출</h2>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">신청 절차 없이 즉시 출고 + 수령완료 처리</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div>
            <label className={labelCls}>구분</label>
            <select value={reqType} onChange={e => { setReqType(e.target.value as ReqType); setLines([{ key: crypto.randomUUID(), sub_code: "", material_id: "", size: "", qty: 1 }]); }} className={inputCls}>
              <option value="근무복">근무복</option>
              <option value="안전장구">안전장구</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>수령자</label>
            <select value={userId} onChange={e => setUserId(e.target.value)} className={inputCls}>
              <option value="">선택</option>
              {users.map(u => (
                <option key={u.id} value={String(u.id)}>{u.name}{u.dept ? ` (${u.dept})` : ""}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2 mb-3">
          {lines.map((l, i) => {
            const grp = groups.find(g => g.subCode === l.sub_code);
            return (
              <div key={l.key} className="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-700/30 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400">#{i + 1}</div>
                  {lines.length > 1 && (
                    <button type="button" onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-[11px] text-red-500">삭제</button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <div>
                    <label className={labelCls}>품목</label>
                    <select value={l.sub_code}
                      onChange={e => updateLine(i, { sub_code: e.target.value, material_id: "" })}
                      className={inputCls}>
                      <option value="">{groups.length === 0 ? "(소분류 없음)" : "선택"}</option>
                      {groups.map(g => <option key={g.subCode} value={g.subCode}>{g.groupLabel}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>자재</label>
                    <select value={l.material_id}
                      onChange={e => updateLine(i, { material_id: e.target.value })}
                      disabled={!l.sub_code} className={inputCls}>
                      <option value="">{!l.sub_code ? "품목 먼저 선택" : ((grp?.materials.length ?? 0) === 0 ? "(자재 미등록)" : "자재 선택")}</option>
                      {(grp?.materials ?? []).map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name}{m.model_no ? ` / ${m.model_no}` : ""} (재고 {fmtNum(m.stock_qty ?? 0)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>수량</label>
                    <input type="number" min={1} value={l.qty}
                      onChange={e => updateLine(i, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                      className={inputCls} />
                  </div>
                </div>
                {reqType === "근무복" && (
                  <div className="mt-2">
                    <label className={labelCls}>사이즈</label>
                    <input type="text" value={l.size} onChange={e => updateLine(i, { size: e.target.value })} lang="ko"
                      placeholder="예: 95, L, 270" className={inputCls} />
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" onClick={() => setLines(prev => [...prev, { key: crypto.randomUUID(), sub_code: "", material_id: "", size: "", qty: 1 }])}
            className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">+ 라인 추가</button>
        </div>

        <div className="mb-3">
          <label className={labelCls}>비고</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} lang="ko"
            placeholder="지급 사유나 참고 사항 (선택)"
            className={inputCls + " resize-none"} />
        </div>

        {message && (
          <div className={`mb-3 text-xs px-3 py-2 rounded whitespace-pre-line ${
            message.type === "success" ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                       : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
          }`}>{message.text}</div>
        )}

        <div className="flex justify-end">
          <button type="button" onClick={submitSingle} disabled={submitting || !canUpdate}
            className="px-5 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50">
            {submitting ? "처리 중..." : "✓ 직접 불출 등록"}
          </button>
        </div>
      </div>

      {/* ───── 엑셀 일괄 업로드 ───── */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">엑셀 일괄 업로드</h2>
          <button type="button" onClick={downloadTemplate}
            className="px-3 py-1.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-xs font-semibold hover:bg-blue-200">
            📥 템플릿 다운로드
          </button>
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
          컬럼: <code className="font-mono">수령자명 / 부서 / 구분 / 자재코드 / 사이즈 / 수량 / 비고</code><br/>
          · 구분: <code>근무복</code> 또는 <code>안전장구</code> · 자재코드는 12자리 ID · 동명이인은 부서로 구분<br/>
          · 같은 (수령자 + 구분) 행은 한 건의 신청으로 묶여 처리됨
        </div>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
            📁 파일 선택
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
          </label>
          <span className={`text-xs ${bulkFile ? "text-gray-700 dark:text-gray-200" : "text-gray-400 dark:text-gray-500 italic"}`}>
            {bulkFile || "선택된 파일 없음"}
          </span>
        </div>

        {bulkMessage && (
          <div className={`mb-3 text-xs px-3 py-2 rounded whitespace-pre-line ${
            bulkMessage.type === "success" ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
            : bulkMessage.type === "error" ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
            :                                 "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
          }`}>{bulkMessage.text}</div>
        )}

        {bulkRows.length > 0 && (
          <>
            <div className="max-h-[500px] overflow-auto border border-gray-200 dark:border-gray-700 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 dark:bg-slate-800 sticky top-0 z-10 shadow-sm">
                  <tr className="text-left text-xs text-slate-700 dark:text-slate-200">
                    <th className="px-3 py-3 w-12 text-center">행</th>
                    <th className="px-3 py-3">수령자</th>
                    <th className="px-3 py-3">부서</th>
                    <th className="px-3 py-3 w-20">구분</th>
                    <th className="px-3 py-3">자재 (코드)</th>
                    <th className="px-3 py-3 w-16">사이즈</th>
                    <th className="px-3 py-3 w-16 text-right">수량</th>
                    <th className="px-3 py-3">상태</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {bulkRows.map((r, idx) => {
                    const hasErr = r.errors.length > 0;
                    const rowBg = hasErr
                      ? "bg-red-50/70 dark:bg-red-900/20"
                      : (idx % 2 === 0 ? "bg-white dark:bg-gray-800" : "bg-slate-50/60 dark:bg-gray-800/60");
                    return (
                      <tr key={r.rowNo} className={`${rowBg} hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors`}>
                        <td className="px-3 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400 text-center whitespace-nowrap">{r.rowNo}</td>
                        <td className="px-3 py-2.5 text-gray-900 dark:text-white whitespace-nowrap">{r.user_name || <span className="text-red-500">(누락)</span>}</td>
                        <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.user_dept || <span className="text-gray-400 dark:text-gray-500">-</span>}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {r.request_type ? (
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                              r.request_type === "근무복" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                              : r.request_type === "안전장구" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                              : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                            }`}>{r.request_type}</span>
                          ) : <span className="text-red-500 text-xs">(누락)</span>}
                        </td>
                        <td className="px-3 py-2.5 max-w-[280px]">
                          <span className="block text-gray-900 dark:text-gray-100 truncate" title={`${r.material?.name ?? ""} ${r.material_id}`}>
                            {r.material?.name ?? <span className="text-red-500">(미등록)</span>}
                            <span className="font-mono text-xs text-gray-500 dark:text-gray-400 ml-1">{r.material_id || "(코드 누락)"}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-800 dark:text-gray-200 whitespace-nowrap">{r.size || <span className="text-gray-400 dark:text-gray-500">-</span>}</td>
                        <td className="px-3 py-2.5 text-right text-orange-600 dark:text-orange-400 text-base whitespace-nowrap">{fmtNum(r.qty)}</td>
                        <td className="px-3 py-2.5 max-w-[320px]">
                          {!hasErr ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 whitespace-nowrap">
                              ✓ 등록 가능
                            </span>
                          ) : (
                            <span className="block text-xs text-red-700 dark:text-red-300 truncate" title={r.errors.join(" / ")}>
                              ⚠ {r.errors.join(" / ")}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                전체 {bulkRows.length} · 정상 {bulkRows.filter(r => r.errors.length === 0).length} · 오류 {bulkRows.filter(r => r.errors.length > 0).length}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setBulkRows([]); setBulkFile(""); setBulkMessage(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                  className="px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold">
                  초기화
                </button>
                <button type="button" onClick={applyBulk}
                  disabled={bulkSubmitting || !canUpdate || bulkRows.filter(r => r.errors.length === 0).length === 0}
                  className="px-4 py-1.5 rounded bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-50">
                  {bulkSubmitting ? "처리 중..." : `✓ 정상 ${bulkRows.filter(r => r.errors.length === 0).length}건 일괄 등록`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
