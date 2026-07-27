import { supabase } from "@/lib/supabase";

const STORAGE_BUCKET = "tbm-photos";

// Storage public URL → 버킷 내 경로. 형식이 다르면 null (정리 대상에서 제외).
function toStoragePath(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/${STORAGE_BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : url.slice(i + marker.length);
}

/**
 * TBM 기록 삭제. 부속 행은 FK CASCADE 로 정리되지만 **Storage 파일은 자동으로 지워지지 않아**
 * 삭제할 때마다 고아 파일이 쌓인다. 그래서 행을 지우기 전에 경로를 모아 함께 제거한다.
 *
 * 파일을 참조하는 곳이 네 군데(작성자 서명/사진 + 참가자 확인 서명/사진)이고 모두 같은 버킷을 쓴다.
 * 한 곳이라도 빠뜨리면 조용히 고아가 남으므로 전부 훑는다.
 *
 * 실패 시 throw — 호출부에서 사용자에게 알린다.
 */
export async function deleteTbmRecord(id: number): Promise<void> {
  // 1. 행이 사라지면 URL 을 되찾을 수 없으므로 삭제 전에 수집한다.
  const [rec, photos, parts, partPhotos] = await Promise.all([
    supabase.from("tbm_records").select("signature_url").eq("id", id).maybeSingle(),
    supabase.from("tbm_photos").select("photo_url").eq("tbm_id", id),
    supabase.from("tbm_participants").select("signature_url").eq("tbm_id", id),
    supabase.from("tbm_participant_photos").select("photo_url").eq("tbm_id", id),
  ]);

  const paths = [
    rec.data?.signature_url,
    ...(photos.data ?? []).map((p) => p.photo_url),
    ...(parts.data ?? []).map((p) => p.signature_url),
    ...(partPhotos.data ?? []).map((p) => p.photo_url),
  ]
    .map(toStoragePath)
    .filter((p): p is string => !!p);

  // 2. 레코드 삭제 (부속 행은 CASCADE)
  const { error } = await supabase.from("tbm_records").delete().eq("id", id);
  if (error) throw new Error(error.message);

  // 3. 파일 정리. 행은 이미 지워졌으므로 여기서 실패해도 삭제를 되돌리지 않는다.
  //    (남은 파일은 고아가 되지만, 삭제 성공을 실패로 뒤집는 것보다 낫다)
  if (paths.length > 0) {
    const { error: rmErr } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
    if (rmErr) console.warn("[tbm] 첨부 파일 정리 실패:", rmErr.message);
  }
}
