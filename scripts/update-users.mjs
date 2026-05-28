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
  console.error("??Missing SUPABASE credentials in .env.local");
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

// SSN ?¬ë§· ?œì??? ?˜ì´???œê±° ??13?ë¦¬ ?«ì ?•ì‹?¼ë¡œ ?€??function cleanSsn(v) {
  if (!v) return null;
  return String(v).replace(/\D/g, "").slice(0, 13);
}

async function main() {
  console.log("?? ?¬ì›ëª?ê¸°ì? ?•ë³´ ?…ë°?´íŠ¸ ?œì‘...");

  // 1. ?°ì´?°ë² ?´ìŠ¤?ì„œ ?„ì¬ ?¬ì› ëª©ë¡ ì¡°íšŒ
  const { data: dbUsers, error } = await supabase
    .from("users")
    .select("*");
    
  if (error) {
    console.error("??DB ?¬ì› ì¡°íšŒ ?¤íŒ¨:", error.message);
    process.exit(1);
  }
  
  console.log(`?¹ï¸ ?„ì¬ DB???±ë¡???¬ì›: ${dbUsers.length}ëª?);

  // DB ?¬ì›ëª…ì„ ?¤ë¡œ ë§¤í•‘ (?™ëª…?´ì¸ ?ˆë°©???„í•´ ë°°ì—´ë¡?ê´€ë¦?
  const dbUsersByName = new Map();
  for (const user of dbUsers) {
    if (!dbUsersByName.has(user.name)) {
      dbUsersByName.set(user.name, []);
    }
    dbUsersByName.get(user.name).push(user);
  }

  // 2. ?‘ì? ?Œì¼ ë¡œë“œ ë°??Œì‹±
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

  console.log(`?¹ï¸ ?‘ì? ?Œì¼ ???¬ì›: ${excelUsers.length}ëª?);

  // 3. ?…ë°?´íŠ¸ ?€??ë§¤ì¹˜ ë°??¤í–‰
  let updateCount = 0;
  let skippedCount = 0;

  for (const exUser of excelUsers) {
    const matchedDbUsers = dbUsersByName.get(exUser.name);
    
    if (!matchedDbUsers) {
      console.log(`? ï¸ ?‘ì? ?¬ì› '${exUser.name}'?€(?? DB???±ë¡?˜ì–´ ?ˆì? ?Šì•„ ê±´ë„ˆ?ë‹ˆ??`);
      skippedCount++;
      continue;
    }

    if (matchedDbUsers.length > 1) {
      console.log(`? ï¸ DB???™ì¼???´ë¦„ '${exUser.name}'??ê°€ì§??¬ì›???¬ëŸ¬ ëª?ì¡´ì¬?©ë‹ˆ?? ?‘ì????¬ì›ë²ˆí˜¸(${exUser.id})?€ ?¼ì¹˜?˜ëŠ” ê³„ì •??ì°¾ìŠµ?ˆë‹¤.`);
    }

    // ?´ë¦„??ê°™ê³  ?¬ì›ë²ˆí˜¸(id)ê¹Œì? ?¼ì¹˜?˜ê±°?? ?¨ì¼ ?´ë¦„ ë§¤ì¹­?????€?ì„ ì°¾ìŒ
    const targetUser = matchedDbUsers.find(u => u.id === exUser.id) || matchedDbUsers[0];

    // ë³€ê²??¬í•­ ê°ì?
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
      console.log(`?ï¸ ?¬ì› '${targetUser.name}' (ID: ${targetUser.id}) ?•ë³´ ?…ë°?´íŠ¸ ì¤?`);
      for (const [key, val] of Object.entries(patch)) {
        console.log(`   - ${key}: "${targetUser[key]}" ??"${val}"`);
      }

      const { error: updateErr } = await supabase
        .from("users")
        .update(patch)
        .eq("id", targetUser.id);

      if (updateErr) {
        console.error(`??'${targetUser.name}' ?…ë°?´íŠ¸ ?¤íŒ¨:`, updateErr.message);
      } else {
        updateCount++;
      }
    } else {
      // ë³€ê²??¬í•­ ?†ìŒ
    }
  }

  console.log(`\n?‰ ?…ë°?´íŠ¸ ?‘ì—… ?„ë£Œ!`);
  console.log(`   - ?•ë³´ê°€ ?…ë°?´íŠ¸???¬ì›: ${updateCount}ëª?);
  console.log(`   - ?•ë³´ ë³€ê²½ì´ ?†ê±°??ê±´ë„ˆ???¬ì›: ${excelUsers.length - updateCount}ëª?);
}

main();
