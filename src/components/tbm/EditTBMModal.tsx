"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import DraggableModal from "@/components/common/DraggableModal";
import TimeText from "@/components/common/TimeText";
import { calcApparentTemperature, heatStressLevel } from "@/lib/apparent-temperature";
import { fetchCurrentWeather } from "@/lib/weather";
import type { TBMRecord, TBMEnvReading, TBMHeatRest } from "@/lib/tbm";

// 참가자·서명·사진·체크리스트·안전수칙은 편집 대상 아님(작업일지 편집 정책과 동일).
// 기본 필드 + 환경지표(다행) + 온열질환 예방 휴게(다행) + 폭염예방 토글만 수정.

interface EnvRow {
  seq: number;
  observed_at: string;
  temperature: string;
  humidity: string;
  apparent_temperature: string;
  location: string;
}
interface RestRow {
  seq: number;
  rest_start: string;
  rest_end: string;
  rest_method: string;
}

export default function EditTBMModal({
  record, onClose, onSaved,
}: { record: TBMRecord; onClose: () => void; onSaved: () => void }) {
  // 기본 필드
  const [siteName, setSiteName] = useState(record.site_name);
  const [elevatorName, setElevatorName] = useState(record.elevator_name);
  const [workContent, setWorkContent] = useState(record.work_content);
  const [riskAssessment, setRiskAssessment] = useState(record.risk_assessment);
  const [partsName, setPartsName] = useState(record.parts_name);
  const [passengerTrapped, setPassengerTrapped] = useState(record.passenger_trapped);

  // 폭염 온열질환 예방
  const [heatPrevention, setHeatPrevention] = useState(false);
  const [envReadings, setEnvReadings] = useState<EnvRow[]>([]);
  const [heatRests, setHeatRests] = useState<RestRow[]>([]);

  // 환경지표 스크래치
  const [envTemperature, setEnvTemperature] = useState("");
  const [envHumidity, setEnvHumidity] = useState("");
  const [envApparent, setEnvApparent] = useState("");
  const [envLocation, setEnvLocation] = useState("");
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherHint, setWeatherHint] = useState("");
  const [envSaveHint, setEnvSaveHint] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 기존 env/rest 로드
  useEffect(() => {
    (async () => {
      const [en, hr] = await Promise.all([
        supabase.from("tbm_env_readings").select("*").eq("tbm_id", record.id).order("seq"),
        supabase.from("tbm_heat_rests").select("*").eq("tbm_id", record.id).order("seq"),
      ]);
      const envRows: EnvRow[] = ((en.data ?? []) as TBMEnvReading[]).map((x, i) => ({
        seq: i + 1,
        observed_at: x.observed_at?.slice(0, 5) ?? "",
        temperature: x.temperature != null ? String(x.temperature) : "",
        humidity: x.humidity != null ? String(x.humidity) : "",
        apparent_temperature: x.apparent_temperature != null ? String(x.apparent_temperature) : "",
        location: x.location ?? "",
      }));
      const restRows: RestRow[] = ((hr.data ?? []) as TBMHeatRest[]).map((x, i) => ({
        seq: i + 1,
        rest_start: x.rest_start?.slice(0, 5) ?? "",
        rest_end: x.rest_end?.slice(0, 5) ?? "",
        rest_method: x.rest_method ?? "",
      }));
      setEnvReadings(envRows);
      setHeatRests(restRows.length > 0 ? restRows : [{ seq: 1, rest_start: "", rest_end: "", rest_method: "" }]);
      setHeatPrevention(envRows.length > 0 || restRows.length > 0);
      setLoading(false);
    })();
  }, [record.id]);

  // 온도·습도 변경 시 체감온도 자동 계산 (수동 입력 없을 때만)
  useEffect(() => {
    if (envTemperature === "" || envHumidity === "") return;
    if (envApparent !== "") return;
    const t = Number(envTemperature);
    const h = Number(envHumidity);
    if (Number.isNaN(t) || Number.isNaN(h)) return;
    const apt = calcApparentTemperature(t, h);
    if (apt !== null) setEnvApparent(apt.toFixed(1));
  }, [envTemperature, envHumidity, envApparent]);

  function currentTimeHM(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function saveEnvReading() {
    setEnvSaveHint(""); setError("");
    if (envTemperature === "" && envHumidity === "" && envApparent === "") {
      setError("저장할 온도·습도·체감온도 값이 없습니다. 먼저 값을 입력하거나 실시간 기상정보를 조회하세요.");
      return;
    }
    const at = currentTimeHM();
    setEnvReadings(prev => [
      ...prev,
      { seq: prev.length + 1, observed_at: at, temperature: envTemperature, humidity: envHumidity, apparent_temperature: envApparent, location: envLocation },
    ]);
    setEnvSaveHint(`✓ ${at} 값이 저장되었습니다`);
  }

  async function loadCurrentWeather() {
    setWeatherLoading(true); setWeatherHint(""); setError("");
    try {
      const w = await fetchCurrentWeather();
      setEnvTemperature(w.temperature.toFixed(1));
      setEnvHumidity(Math.round(w.humidity).toString());
      const apt = calcApparentTemperature(w.temperature, w.humidity);
      if (apt !== null) setEnvApparent(apt.toFixed(1));
      setEnvLocation(w.location);
      const t = new Date(w.observedAt);
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      const locSuffix = w.location ? ` · 📍 ${w.location}` : "";
      setWeatherHint(`✓ ${hh}:${mm} 관측값 반영됨${locSuffix}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWeatherLoading(false);
    }
  }

  function updateEnvReading(idx: number, patch: Partial<EnvRow>) {
    setEnvReadings(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }
  function removeEnvReading(idx: number) {
    setEnvReadings(prev => prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, seq: i + 1 })));
  }
  function updateHeatRest(idx: number, patch: Partial<RestRow>) {
    setHeatRests(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }
  function addHeatRest() {
    setHeatRests(prev => [...prev, { seq: prev.length + 1, rest_start: "", rest_end: "", rest_method: "" }]);
  }
  function removeHeatRest(idx: number) {
    setHeatRests(prev => prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, seq: i + 1 })));
  }

  async function save() {
    if (!siteName.trim() || !workContent.trim()) {
      setError("현장명과 작업 내용은 필수입니다.");
      return;
    }
    setSaving(true); setError("");
    try {
      const { error: recErr } = await supabase.from("tbm_records").update({
        site_name: siteName.trim(),
        elevator_name: elevatorName.trim(),
        work_content: workContent.trim(),
        risk_assessment: riskAssessment.trim(),
        parts_name: record.sub_type === "parts" ? partsName.trim() : "",
        passenger_trapped: record.sub_type === "fault" ? passengerTrapped : false,
        updated_at: new Date().toISOString(),
      }).eq("id", record.id);
      if (recErr) throw recErr;

      // env/rest: delete → insert 재구성 (폭염예방 언체크 시엔 삭제만)
      await Promise.all([
        supabase.from("tbm_env_readings").delete().eq("tbm_id", record.id),
        supabase.from("tbm_heat_rests").delete().eq("tbm_id", record.id),
      ]);

      if (heatPrevention) {
        const envRows = envReadings.filter(r =>
          r.temperature !== "" || r.humidity !== "" || r.apparent_temperature !== "" || r.location.trim() !== "" || r.observed_at !== ""
        );
        if (envRows.length > 0) {
          const { error: envErr } = await supabase.from("tbm_env_readings").insert(
            envRows.map((r, i) => ({
              tbm_id: record.id,
              seq: i + 1,
              observed_at: r.observed_at || null,
              temperature: r.temperature === "" ? null : Number(r.temperature),
              humidity: r.humidity === "" ? null : Number(r.humidity),
              apparent_temperature: r.apparent_temperature === "" ? null : Number(r.apparent_temperature),
              location: r.location.trim() || null,
            }))
          );
          if (envErr) throw envErr;
        }

        const restRows = heatRests.filter(r =>
          r.rest_start !== "" || r.rest_end !== "" || r.rest_method.trim() !== ""
        );
        if (restRows.length > 0) {
          const { error: restErr } = await supabase.from("tbm_heat_rests").insert(
            restRows.map((r, i) => ({
              tbm_id: record.id,
              seq: i + 1,
              rest_start: r.rest_start || null,
              rest_end: r.rest_end || null,
              rest_method: r.rest_method.trim() || null,
            }))
          );
          if (restErr) throw restErr;
        }
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100";
  const inputBaseCls = "w-full px-2 py-1.5 text-sm text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded";
  const scratchInfo = heatStressLevel(envApparent === "" ? null : Number(envApparent));
  const aptCellCls = scratchInfo
    ? `border p-0.5 ${scratchInfo.colorClass}`
    : "border border-gray-300 dark:border-gray-600 p-0.5";

  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-full max-w-2xl max-h-[92vh]"
      z={60}
      header={
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-base font-bold text-gray-900 dark:text-white">TBM 수정</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
      }
    >
      {loading ? (
        <div className="p-8 text-center text-sm text-gray-400">불러오는 중…</div>
      ) : (
      <>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <Field label="현장명 *">
            <input type="text" value={siteName} onChange={e => setSiteName(e.target.value)} lang="ko" className={inputCls} />
          </Field>
          <Field label="호기">
            <input type="text" value={elevatorName} onChange={e => setElevatorName(e.target.value)} lang="ko" className={inputCls} />
          </Field>
          {record.sub_type === "parts" && (
            <Field label="교체 부품명">
              <input type="text" value={partsName} onChange={e => setPartsName(e.target.value)} lang="ko" className={inputCls} />
            </Field>
          )}
          {record.sub_type === "fault" && (
            <Field label="승객 갇힘 여부">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input type="checkbox" checked={passengerTrapped} onChange={e => setPassengerTrapped(e.target.checked)} />
                승객 갇힘 발생
              </label>
            </Field>
          )}
          <Field label="작업 내용 *">
            <textarea value={workContent} onChange={e => setWorkContent(e.target.value)} rows={4} lang="ko" className={inputCls + " resize-none"} />
          </Field>
          <Field label="위험요소">
            <textarea value={riskAssessment} onChange={e => setRiskAssessment(e.target.value)} rows={2} lang="ko" className={inputCls + " resize-none"} />
          </Field>

          {/* 폭염 온열질환 예방 토글 */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-600 p-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={heatPrevention}
                onChange={e => setHeatPrevention(e.target.checked)}
                className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-orange-500 focus:ring-orange-400"
              />
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">🥵 폭염 온열질환 예방</span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">(체크 시 환경지표·휴게 실시 확인 편집)</span>
            </label>
          </div>

          {heatPrevention && (
            <>
              {/* 환경 지표 */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-600 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold text-gray-700 dark:text-gray-200">🌡️ 환경 지표</div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={saveEnvReading}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100">
                      💾 내용저장
                    </button>
                    <button type="button" onClick={loadCurrentWeather} disabled={weatherLoading}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 disabled:opacity-50">
                      {weatherLoading ? "⏳ 조회 중..." : "📡 실시간 기상정보"}
                    </button>
                  </div>
                </div>
                {weatherHint && <div className="text-[10px] text-green-600 dark:text-green-400 mb-2">{weatherHint}</div>}
                {envSaveHint && <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mb-2">{envSaveHint}</div>}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-700">
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1">온도(℃)</th>
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1">습도(%)</th>
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1">체감온도</th>
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1">지역정보</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                          <input type="number" step="0.1" value={envTemperature} onChange={e => setEnvTemperature(e.target.value)} className={inputBaseCls} />
                        </td>
                        <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                          <input type="number" step="0.1" value={envHumidity} onChange={e => setEnvHumidity(e.target.value)} className={inputBaseCls} />
                        </td>
                        <td className={aptCellCls}>
                          <div className="flex items-center justify-center gap-1">
                            <input type="number" step="0.1" value={envApparent} onChange={e => setEnvApparent(e.target.value)}
                              className={`w-16 px-1 py-1.5 text-sm text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded ${scratchInfo ? "font-bold" : ""}`} />
                            {scratchInfo && <span className="text-[11px] font-bold">({scratchInfo.label})</span>}
                          </div>
                        </td>
                        <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                          <input type="text" value={envLocation} onChange={e => setEnvLocation(e.target.value)} placeholder="📍 지역" lang="ko" className={inputBaseCls} />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {envReadings.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
                      저장된 기상정보 ({envReadings.length}건)
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-700">
                            <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-20">시각</th>
                            <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-20">온도(℃)</th>
                            <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-20">습도(%)</th>
                            <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-24">체감온도</th>
                            <th className="border border-gray-300 dark:border-gray-600 px-2 py-1">지역정보</th>
                            <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {envReadings.map((r, idx) => {
                            const info = heatStressLevel(r.apparent_temperature === "" ? null : Number(r.apparent_temperature));
                            const aptCls = info
                              ? `border p-0.5 ${info.colorClass}`
                              : "border border-gray-300 dark:border-gray-600 p-0.5";
                            return (
                              <tr key={idx}>
                                <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                                  <input type="time" value={r.observed_at} onChange={e => updateEnvReading(idx, { observed_at: e.target.value })}
                                    className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                                </td>
                                <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                                  <input type="number" step="0.1" value={r.temperature} onChange={e => updateEnvReading(idx, { temperature: e.target.value })}
                                    className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                                </td>
                                <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                                  <input type="number" step="0.1" value={r.humidity} onChange={e => updateEnvReading(idx, { humidity: e.target.value })}
                                    className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                                </td>
                                <td className={aptCls}>
                                  <div className="flex items-center justify-center gap-1">
                                    <input type="number" step="0.1" value={r.apparent_temperature} onChange={e => updateEnvReading(idx, { apparent_temperature: e.target.value })}
                                      className={`w-14 px-1 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded ${info ? "font-bold" : ""}`} />
                                    {info && <span className="text-[10px] font-bold">({info.label})</span>}
                                  </div>
                                </td>
                                <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                                  <input type="text" value={r.location} onChange={e => updateEnvReading(idx, { location: e.target.value })} placeholder="📍 지역" lang="ko"
                                    className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                                </td>
                                <td className="border border-gray-300 dark:border-gray-600 p-0.5 text-center">
                                  <button type="button" onClick={() => removeEnvReading(idx)} title="행 삭제"
                                    className="w-7 h-7 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30">×</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* 온열질환 예방 휴게 */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-600 p-3">
                <div className="text-xs font-bold text-gray-700 dark:text-gray-200 mb-2">🥵 온열질환 예방 휴게 실시 확인</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-700">
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-24">휴게 시작</th>
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-24">휴게 종료</th>
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1">휴게방법</th>
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {heatRests.map((r, idx) => (
                        <tr key={idx}>
                          <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                            <TimeText value={r.rest_start} onChange={v => updateHeatRest(idx, { rest_start: v })} placeholder="HH:MM"
                              className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded placeholder:text-gray-400" />
                          </td>
                          <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                            <TimeText value={r.rest_end} onChange={v => updateHeatRest(idx, { rest_end: v })} placeholder="HH:MM"
                              className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded placeholder:text-gray-400" />
                          </td>
                          <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                            <input type="text" value={r.rest_method} onChange={e => updateHeatRest(idx, { rest_method: e.target.value })} placeholder="예: 그늘 휴식, 냉방실 이동" lang="ko"
                              className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                          </td>
                          <td className="border border-gray-300 dark:border-gray-600 p-0.5 text-center">
                            <button type="button" onClick={() => removeHeatRest(idx)} disabled={heatRests.length <= 1} title="행 삭제"
                              className="w-7 h-7 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-30">×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" onClick={addHeatRest}
                  className="mt-2 w-full py-2 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-300 border border-dashed border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100">
                  + 행 추가
                </button>
              </div>
            </>
          )}

          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            ※ 체크리스트·안전수칙·참가자·사진·서명은 수정 대상이 아닙니다. 필요 시 새로 작성하세요.
          </p>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 text-xs px-3 py-2 rounded">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">취소</button>
          <button type="button" onClick={save} disabled={saving}
            className="px-4 py-2 rounded text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </>
      )}
    </DraggableModal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      {children}
    </div>
  );
}
