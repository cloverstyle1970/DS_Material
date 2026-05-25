import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import XLSX from "xlsx";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ Missing SUPABASE credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function str(v) { return v != null && v !== "" ? String(v).trim() : null; }
function excelDate(v) {
  if (!v) return null;
  const s = String(v).trim().replace(/\D/g, "");
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return null;
}

// SSN 포맷 표준화: 하이픈 제거 후 13자리 숫자 형식으로 저장
function cleanSsn(v) {
  if (!v) return null;
  return String(v).replace(/\D/g, "").slice(0, 13);
}

async function main() {
  console.log("🚀 사원명 기준 정보 업데이트 시작...");

  // 1. 데이터베이스에서 현재 사원 목록 조회
  const { data: dbUsers, error } = await supabase
    .from("users")
    .select("*");
    
  if (error) {
    console.error("❌ DB 사원 조회 실패:", error.message);
    process.exit(1);
  }
  
  console.log(`ℹ️ 현재 DB에 등록된 사원: ${dbUsers.length}명`);

  // DB 사원명을 키로 매핑 (동명이인 예방을 위해 배열로 관리)
  const dbUsersByName = new Map();
  for (const user of dbUsers) {
    if (!dbUsersByName.has(user.name)) {
      dbUsersByName.set(user.name, []);
    }
    dbUsersByName.get(user.name).push(user);
  }

  // 2. 엑셀 파일 로드 및 파싱
  const filePath = path.join(__dirname, "..", "ds-page", "user.xlsx");
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const excelRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  
  const excelUsers = [];
  for (const row of excelRows.slice(1)) {
    const name = str(row[1]);
    if (!name) continue;
    
    excelUsers.push({
      id:          row[0] !== "" ? Number(row[0]) : null,
      name,
      dept:        str(row[2]),
      rank:        str(row[3]),
      ssn:         cleanSsn(row[4]),
      cert:        str(row[5]),
      hire_date:   excelDate(row[6]),
      resign_date: excelDate(row[7]),
      phone:       str(row[8]),
      status:      str(row[9]),
      address:     str(row[10]),
    });
  }

  console.log(`ℹ️ 엑셀 파일 내 사원: ${excelUsers.length}명`);

  // 3. 업데이트 대상 매치 및 실행
  let updateCount = 0;
  let skippedCount = 0;

  for (const exUser of excelUsers) {
    const matchedDbUsers = dbUsersByName.get(exUser.name);
    
    if (!matchedDbUsers) {
      console.log(`⚠️ 엑셀 사원 '${exUser.name}'은(는) DB에 등록되어 있지 않아 건너뜁니다.`);
      skippedCount++;
      continue;
    }

    if (matchedDbUsers.length > 1) {
      console.log(`⚠️ DB에 동일한 이름 '${exUser.name}'을 가진 사원이 여러 명 존재합니다. 엑셀의 사원번호(${exUser.id})와 일치하는 계정을 찾습니다.`);
    }

    // 이름이 같고 사원번호(id)까지 일치하거나, 단일 이름 매칭일 때 대상을 찾음
    const targetUser = matchedDbUsers.find(u => u.id === exUser.id) || matchedDbUsers[0];

    // 변경 사항 감지
    const patch = {};
    const fieldsToCompare = {
      dept: 'dept',
      rank: 'rank',
      ssn: 'ssn',
      cert: 'cert',
      hire_date: 'hire_date',
      resign_date: 'resign_date',
      phone: 'phone',
      status: 'status',
      address: 'address'
    };

    for (const [dbField, exField] of Object.entries(fieldsToCompare)) {
      const dbVal = targetUser[dbField] == null ? "" : String(targetUser[dbField]).trim();
      const exVal = exUser[exField] == null ? "" : String(exUser[exField]).trim();

      if (dbVal !== exVal) {
        patch[dbField] = exUser[exField];
      }
    }

    if (Object.keys(patch).length > 0) {
      console.log(`✏️ 사원 '${targetUser.name}' (ID: ${targetUser.id}) 정보 업데이트 중:`);
      for (const [key, val] of Object.entries(patch)) {
        console.log(`   - ${key}: "${targetUser[key]}" ➔ "${val}"`);
      }

      const { error: updateErr } = await supabase
        .from("users")
        .update(patch)
        .eq("id", targetUser.id);

      if (updateErr) {
        console.error(`❌ '${targetUser.name}' 업데이트 실패:`, updateErr.message);
      } else {
        updateCount++;
      }
    } else {
      // 변경 사항 없음
    }
  }

  console.log(`\n🎉 업데이트 작업 완료!`);
  console.log(`   - 정보가 업데이트된 사원: ${updateCount}명`);
  console.log(`   - 정보 변경이 없거나 건너뛴 사원: ${excelUsers.length - updateCount}명`);
}

main();
