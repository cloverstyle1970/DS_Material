import { supabase } from "./supabase";

const SETTING_KEY = "material_managers";

export interface MaterialManager {
  id: number;
  name: string;
  dept: string | null;
}

/** system_settings 에서 자재담당자 ID 배열을 읽어온다. */
async function fetchManagerIds(): Promise<number[]> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", SETTING_KEY)
    .maybeSingle();
  if (!data?.value) return [];
  try {
    const parsed = JSON.parse(data.value);
    if (Array.isArray(parsed)) return parsed.map(Number).filter(Boolean);
  } catch { /* ignore */ }
  return [];
}

/** 자재담당자 계정 목록 조회 */
export async function getMaterialManagers(): Promise<MaterialManager[]> {
  const ids = await fetchManagerIds();
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("accounts")
    .select("id, username, name, dept")
    .in("id", ids);
  return ((data ?? []) as { id: number; username: string | null; name: string | null; dept: string | null }[])
    .map(a => ({ id: a.id, name: (a.username || a.name || "").trim(), dept: a.dept }))
    .filter(a => !!a.name);
}

/** 자재담당자 ID 배열 저장 (관리자 전용) */
export async function setMaterialManagerIds(ids: number[]): Promise<void> {
  await supabase
    .from("system_settings")
    .upsert({ key: SETTING_KEY, value: JSON.stringify(ids), updated_at: new Date().toISOString() }, { onConflict: "key" });
}

/** 알림 발송 대상 ID 배열 반환 (excludeIds 제외) */
export async function getNotifyTargetIds(excludeIds: number[] = []): Promise<number[]> {
  const ids = await fetchManagerIds();
  return ids.filter(id => !excludeIds.includes(id));
}
