import * as XLSX from "xlsx";
import { supabase } from "./supabase";

// 신DB 업무 테이블 — 코드에서 supabase.from() 호출되는 것 기준
// (2026-06-02 기준 src/ 전수 grep)
export const NEWDB_TABLES = [
  // 사원·권한
  "accounts", "permission_groups", "departments", "ranks", "crews",
  "user_family_members", "user_career_history", "user_certifications",
  "user_rewards_punishments", "user_vehicles", "user_status_history",
  "vehicle_user_history", "vehicle_insurance_history",
  // 현장
  "managed_sites", "site_elevators", "vendors",
  // 자재·재고
  "materials", "material_units", "material_requests", "categories",
  "transactions", "purchase_orders",
  // 견적
  "quotes", "quote_items", "quote_labor_lines", "quote_revisions",
  "quote_revision_notes", "quote_settings", "quote_requests",
  "quote_request_items", "labor_categories", "labor_workload_standards",
  "invoices", "payments",
  // TBM
  "tbm_records", "tbm_participants", "tbm_participant_checklist",
  "tbm_participant_photos", "tbm_participant_safety",
  "tbm_checklist_items", "tbm_checklist_results", "tbm_photos",
  "tbm_record_safety_rules", "tbm_safety_rules_master",
  "tbm_fault_types", "tbm_repair_types",
  // 기타 업무
  "notifications", "manuals", "annual_events",
  "construction_schedules", "construction_requests",
  "uniform_safety_requests", "uniform_safety_request_items",
] as const;

// 민감 컬럼 — 백업 시 자동 제외 (절대 노출 금지급)
export const EXCLUDED_COLUMNS: Record<string, string[]> = {
  accounts: ["password", "password_hash", "ssn"],
};

const PAGE_SIZE = 1000;

export interface BackupProgress {
  currentTable: string;
  doneTables: number;
  totalTables: number;
  rowsThisTable: number;
}

async function fetchAllRows(table: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let from = 0;
  // PostgREST 기본 limit 1000 → 1000행씩 페이지네이션
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

function stripExcluded(table: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const drops = EXCLUDED_COLUMNS[table];
  if (!drops || drops.length === 0 || rows.length === 0) return rows;
  return rows.map(r => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(r)) {
      if (!drops.includes(k)) out[k] = r[k];
    }
    return out;
  });
}

export async function downloadAllTablesBackup(
  onProgress?: (p: BackupProgress) => void
): Promise<void> {
  const wb = XLSX.utils.book_new();
  const indexRows: { table: string; rows: number; excluded: string; error: string }[] = [];

  for (let i = 0; i < NEWDB_TABLES.length; i++) {
    const table = NEWDB_TABLES[i];
    onProgress?.({ currentTable: table, doneTables: i, totalTables: NEWDB_TABLES.length, rowsThisTable: 0 });
    try {
      const rows = await fetchAllRows(table);
      const stripped = stripExcluded(table, rows);
      const ws = stripped.length > 0
        ? XLSX.utils.json_to_sheet(stripped)
        : XLSX.utils.aoa_to_sheet([["(데이터 없음)"]]);
      // Excel 시트명 31자 한도
      XLSX.utils.book_append_sheet(wb, ws, table.slice(0, 31));
      indexRows.push({
        table,
        rows: stripped.length,
        excluded: EXCLUDED_COLUMNS[table]?.join(", ") ?? "",
        error: "",
      });
      onProgress?.({ currentTable: table, doneTables: i + 1, totalTables: NEWDB_TABLES.length, rowsThisTable: stripped.length });
    } catch (err) {
      indexRows.push({
        table,
        rows: -1,
        excluded: EXCLUDED_COLUMNS[table]?.join(", ") ?? "",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const downloadedAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  const indexSheetData: (string | number)[][] = [
    ["신DB 전체 테이블 백업"],
    ["다운로드 시각", downloadedAt],
    ["총 테이블 수", NEWDB_TABLES.length],
    [],
    ["테이블명", "행수", "제외 컬럼", "오류"],
    ...indexRows.map(r => [r.table, r.rows, r.excluded, r.error]),
  ];
  const indexWs = XLSX.utils.aoa_to_sheet(indexSheetData);
  XLSX.utils.book_append_sheet(wb, indexWs, "_인덱스");
  // 인덱스 시트를 맨 앞으로
  wb.SheetNames = ["_인덱스", ...wb.SheetNames.filter(n => n !== "_인덱스")];

  const stamp = downloadedAt.slice(0, 10).replace(/-/g, "");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `신DB_전체백업_${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
