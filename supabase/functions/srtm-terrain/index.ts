import { createClient } from "npm:@supabase/supabase-js@2";
import {
  classifyTerrain,
  srtmDataset,
  srtmPeriod,
  srtmProduct,
  srtmRevision,
  srtmWindow,
  terrainFromAscii,
  type TerrainPolygon,
  type TerrainResult,
} from "../_shared/srtm.ts";
import { fetchSrtmGrid } from "../_shared/srtm-provider.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (result: TerrainResult, status = 200) =>
  new Response(JSON.stringify(result), { status, headers });
const failed = (message: string, status = 200) =>
  reply({ status: "error", message }, status);
const conflict = "field_id,provider,dataset,geometry_reference,analysis_period";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return failed("Неподдерживаемый метод.", 405);
  try {
    const auth = request.headers.get("Authorization");
    if (!auth) return failed("Войдите в аккаунт.", 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const reader = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const {
      data: { user },
      error: authError,
    } = await reader.auth.getUser();
    if (authError || !user) return failed("Войдите в аккаунт.", 401);
    const { fieldId, expectedRevision } =
      (await request.json().catch(() => null)) ?? {};
    if (
      typeof fieldId !== "string" ||
      !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(fieldId)
    )
      return failed("Выберите сохранённое поле.", 400);
    const { data: field, error: fieldError } = await reader
      .from("field_geojson")
      .select("boundary")
      .eq("id", fieldId)
      .maybeSingle();
    if (fieldError) throw fieldError;
    if (!field) return failed("Поле недоступно.", 404);
    const boundary = field.boundary as TerrainPolygon;
    const fingerprint = JSON.stringify(boundary);
    const geometry = await srtmRevision(boundary);
    if (expectedRevision !== geometry)
      return failed(
        "Граница поля изменилась. Обновите страницу и повторите.",
        409,
      );
    const window = srtmWindow(boundary);
    if (window.reason)
      return reply({ status: "unsupported", message: window.reason });
    const scope = {
      field_id: fieldId,
      provider: "NASA SRTM",
      dataset: srtmDataset,
      geometry_reference: geometry,
    };
    const [cache, job] = await Promise.all([
      reader
        .from("field_analytics")
        .select("terrain_metrics")
        .match(scope)
        .eq("analysis_period", srtmPeriod)
        .maybeSingle(),
      reader
        .from("earth_observation_jobs")
        .select("status,started_at,completed_at,error_message")
        .match(scope)
        .eq("requested_period", srtmPeriod)
        .maybeSingle(),
    ]);
    if (cache.error || job.error) throw cache.error ?? job.error;
    if (cache.data)
      return reply({ ...cache.data.terrain_metrics, cached: true });
    if (
      job.data?.status === "running" &&
      Date.now() - Date.parse(job.data.started_at) < 180000
    )
      return reply({ status: "loading" });
    if (
      job.data?.status === "failed" &&
      Date.now() - Date.parse(job.data.completed_at) < 60000
    )
      return failed(
        job.data.error_message ?? "Источник SRTM недоступен. Повторите позже.",
      );
    const key = Deno.env.get("OPENTOPOGRAPHY_API_KEY");
    if (!key)
      return failed("Для SRTM требуется серверный ключ OpenTopography.");
    const writer = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: jobId, error: claimError } = await writer.rpc(
      "claim_earth_job",
      {
        p_field: fieldId,
        p_provider: scope.provider,
        p_dataset: scope.dataset,
        p_geometry: geometry,
        p_year: srtmPeriod,
      },
    );
    if (claimError) throw claimError;
    if (!jobId) return reply({ status: "loading" });

    const complete = async (error?: string) => {
      const update = await writer
        .from("earth_observation_jobs")
        .update({
          status: error ? "failed" : "succeeded",
          completed_at: new Date().toISOString(),
          error_message: error ?? null,
        })
        .eq("id", jobId);
      if (update.error) throw update.error;
    };
    try {
      // The claim RPC protects concurrent requests. Check again in case a previous
      // execution saved the result after the initial cache read.
      const latest = await reader
        .from("field_analytics")
        .select("terrain_metrics")
        .match(scope)
        .eq("analysis_period", srtmPeriod)
        .maybeSingle();
      if (latest.error) throw latest.error;
      if (latest.data) {
        await complete();
        return reply({ ...latest.data.terrain_metrics, cached: true });
      }
      const provided = await fetchSrtmGrid(window.padded, key);
      if (provided.error) {
        await complete(provided.error);
        return failed(provided.error);
      }
      let result: TerrainResult;
      try {
        result = classifyTerrain(
          terrainFromAscii(provided.text!, boundary, window.bounds),
        );
      } catch {
        const message =
          "OpenTopography вернул неполный или неподдерживаемый формат растра SRTM.";
        await complete(message);
        return failed(message);
      }
      const current = await reader
        .from("field_geojson")
        .select("boundary")
        .eq("id", fieldId)
        .maybeSingle();
      if (current.error) throw current.error;
      if (
        !current.data ||
        JSON.stringify(current.data.boundary) !== fingerprint
      ) {
        const message =
          "Граница поля изменилась. Откройте анализ для новой границы.";
        await complete(message);
        return failed(message);
      }
      const saved = await writer.from("field_analytics").upsert(
        {
          ...scope,
          analysis_period: srtmPeriod,
          terrain_metrics: result,
          source_metadata: {
            product: srtmProduct,
            resolution_arc_seconds: 1,
            access: "OpenTopography Global DEM / AAIGrid",
            doi: "10.5067/MEaSUREs/SRTM/SRTMGL1.003",
            acquisition: "February 2000",
            vertical_reference: "EGM96",
            method:
              "polygon pixel centres; centred differences; WGS84 local metric distances",
            bounds: window.padded,
            retrieved_at: new Date().toISOString(),
          },
        },
        { onConflict: conflict },
      );
      if (saved.error) throw saved.error;
      await complete();
      return reply(result);
    } catch {
      await complete("Не удалось сохранить расчёт SRTM. Повторите позже.");
      return failed("Не удалось сохранить расчёт SRTM. Повторите позже.", 502);
    }
  } catch {
    return failed(
      "Сервис рельефа недоступен. Проверьте развёртывание и повторите позже.",
      502,
    );
  }
});
