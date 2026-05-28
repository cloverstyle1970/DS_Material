import { createClient } from "@supabase/supabase-js";

// ============================================================
// 1. DB 연결 설정 (출발지: 자재관리 구DB ➔ 목적지: 유지관리 신DB)
// ============================================================
const SOURCE_URL = "https://gwgzzsoknjulwwsmubju.supabase.co";
const SOURCE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";

const TARGET_URL = "https://bbnmxwpacdfqvicybhau.supabase.co";
const TARGET_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJibm14d3BhY2RmcXZpY3liaGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDA3NDYsImV4cCI6MjA5MTAxNjc0Nn0.cGqnmu5BeaXosxoE-IEmjX-dF4zDYipzpYb5hhc8S6I";

const source = createClient(SOURCE_URL, SOURCE_ANON_KEY);
const target = createClient(TARGET_URL, TARGET_ANON_KEY);

// 이전할 테이블 목록 (종속성 순서대로 처리)
const TABLES_TO_MIGRATE = [
  { name: "materials", idCol: "id" },
  { name: "quote_settings", idCol: "id" },
  { name: "labor_rates", idCol: "id" },
  { name: "quotes", idCol: "id" },
  { name: "quote_items", idCol: "id" }
];

async function migrateTable(tableName, idColumn) {
  console.log(`\n--------------------------------------------`);
  console.log(`📦 [${tableName}] 테이블 데이터 이전 시작...`);

  // 1. 출발지(구DB)에서 페이지네이션으로 전체 데이터 조회 (Supabase 1000개 제한 우회)
  let rows = [];
  let start = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    console.log(`   ➔ 구DB에서 데이터 조회 중... (Offset: ${start} ~ ${start + pageSize - 1})`);
    const { data: chunk, error: fetchError } = await source
      .from(tableName)
      .select("*")
      .range(start, start + pageSize - 1);

    if (fetchError) {
      console.error(`❌ [${tableName}] 데이터 조회 실패:`, fetchError.message);
      return false;
    }

    if (!chunk || chunk.length === 0) {
      hasMore = false;
    } else {
      rows.push(...chunk);
      if (chunk.length < pageSize) {
        hasMore = false;
      } else {
        start += pageSize;
      }
    }
  }

  if (rows.length === 0) {
    console.log(`ℹ️ [${tableName}] 구DB에 이전할 데이터가 없습니다.`);
    return true;
  }

  console.log(`🔍 [${tableName}] 총 ${rows.length}개 행 조회 완료. 목적지로 복사 중...`);

  // 2. 목적지(신DB)에 청크 단위로 업서트 (upsert)하여 데이터 주입
  const writeChunkSize = 100;
  let successCount = 0;

  for (let i = 0; i < rows.length; i += writeChunkSize) {
    const chunk = rows.slice(i, i + writeChunkSize);
    const { error: insertError } = await target
      .from(tableName)
      .upsert(chunk, { onConflict: idColumn });

    if (insertError) {
      console.error(`❌ [${tableName}] 데이터 삽입 실패 (인덱스 ${i}~):`, insertError.message);
      return false;
    }
    successCount += chunk.length;
    console.log(`   ➔ ${successCount}/${rows.length} 완료...`);
  }

  console.log(`✅ [${tableName}] 이전 완료! 총 ${successCount}개 행 병합 성공.`);
  return true;
}

async function startMigration() {
  console.log("==============================================");
  console.log("🚀 대솔이엘 자재관리 ➔ 유지관리 DB 통합 이전 시작");
  console.log(`🔗 출발지 (자재관리): ${SOURCE_URL}`);
  console.log(`🔗 목적지 (유지관리): ${TARGET_URL}`);
  console.log("==============================================");

  for (const table of TABLES_TO_MIGRATE) {
    const success = await migrateTable(table.name, table.idCol);
    if (!success) {
      console.error(`\n🚨 [${table.name}] 테이블 복사 중 오류가 발생하여 이관 작업을 중단합니다.`);
      process.exit(1);
    }
  }

  console.log("\n==============================================");
  console.log("🎉 모든 자재관리 데이터가 유지관리 DB로 안전하게 이전 완료되었습니다!");
  console.log("==============================================");
}

startMigration().catch(err => {
  console.error("🚨 치명적 에러 발생:", err);
  process.exit(1);
});
