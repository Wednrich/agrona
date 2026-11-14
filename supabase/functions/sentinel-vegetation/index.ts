import { createClient } from "npm:@supabase/supabase-js@2";
import {
  earliestSentinelYear,
  sentinelDataset,
  sentinelProvider,
} from "../_shared/sentinel.ts";
import {
  fetchSentinelOverlay,
  fetchSentinelYear,
} from "../_shared/sentinel-provider.ts";

declare const EdgeRuntime: { waitUntil(task: Promise<void>): void };

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const minute = 60000;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST")
    return reply({ error: "Method not allowed" }, 405);
  try {
    const auth = request.headers.get("Authorization");
    if (!auth) return reply({ error: "Требуется вход." }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const reader = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const {
      data: { user },
      error: authError,
    } = await reader.auth.getUser();
    if (authError || !user) return reply({ error: "Требуется вход." }, 401);
    const body = await request.json().catch(() => null);
    const { fieldId, year, overlayDate } = body ?? {};
    const currentYear = new Date().getUTCFullYear();
    if (
      typeof fieldId !== "string" ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(fieldId) ||
      !Number.isInteger(year) ||
      year < earliestSentinelYear ||
      year >= currentYear
    )
      return reply(
        { error: "Выберите поле и завершённый год с 2017 года." },
        400,
      );

    const { data: geometry, error: geometryError } = await reader
      .rpc("sentinel_field_geometry", { p_field: fieldId })
      .maybeSingle();
    if (geometryError) throw geometryError;
    if (!geometry)
      return reply(
        { error: "Поле недоступно или находится вне зоны расчёта UTM." },
        404,
      );
    const field = geometry as {
      projected: { type: "Polygon"; coordinates: number[][][] };
      geometry_reference: string;
      epsg: number;
      width_m: number;
      height_m: number;
    };
    if (
      !(field.width_m > 0 && field.height_m > 0) ||
      Math.max(field.width_m, field.height_m) > 10000 ||
      Math.ceil(field.width_m / 10) * Math.ceil(field.height_m / 10) > 250000
    )
      return reply(
        { error: "Граница превышает лимит анализа на сетке 10 м." },
        422,
      );

    const scope = {
      field_id: fieldId,
      provider: sentinelProvider,
      dataset: sentinelDataset,
      geometry_reference: field.geometry_reference,
    };
    const [cached, jobs] = await Promise.all([
      reader
        .from("field_analytics")
        .select("vegetation_metrics,source_metadata,calculated_at")
        .match(scope)
        .eq("analysis_period", year)
        .maybeSingle(),
      reader
        .from("earth_observation_jobs")
        .select("status,started_at,completed_at,error_message")
        .match(scope)
        .eq("requested_period", year)
        .maybeSingle(),
    ]);
    if (cached.error) throw cached.error;
    if (jobs.error) throw jobs.error;
    const cache = cached.data;
    const job = jobs.data;
    const result = {
      observations: cache?.vegetation_metrics.observations ?? [],
      metadata: cache?.source_metadata,
      cached: !!cache,
    };
    if (overlayDate !== undefined) {
      if (
        !result.observations.some(
          (row: { date: string; validPixels: number }) =>
            row.date === overlayDate && row.validPixels > 0,
        )
      )
        return reply(
          { error: "Нет пригодных данных для слоя за выбранную дату." },
          400,
        );
      const clientId = Deno.env.get("CDSE_CLIENT_ID");
      const clientSecret = Deno.env.get("CDSE_CLIENT_SECRET");
      if (!clientId || !clientSecret)
        return reply({ error: "Доступ Copernicus не настроен." }, 503);
      const bounds = geometry.mercator_bounds as [
        number,
        number,
        number,
        number,
      ];
      const image = await fetchSentinelOverlay(
        clientId,
        clientSecret,
        overlayDate,
        geometry.mercator,
        bounds,
      );
      const unproject = (x: number, y: number) => [
        ((x / 6378137) * 180) / Math.PI,
        (Math.atan(Math.sinh(y / 6378137)) * 180) / Math.PI,
      ];
      const [w, s, e, n] = bounds;
      return reply({
        image,
        coordinates: [
          unproject(w, n),
          unproject(e, n),
          unproject(e, s),
          unproject(w, s),
        ],
      });
    }
    if (
      job?.status === "running" &&
      Date.now() - Date.parse(job.started_at) < 3 * minute
    )
      return reply({ ...result, pending: true });
    const ttl = (year === currentYear - 1 ? 7 : 180) * 1440 * minute;
    if (cache && Date.now() - Date.parse(cache.calculated_at) < ttl)
      return reply(result);
    if (
      job?.status === "failed" &&
      Date.now() - Date.parse(job.completed_at) < 30 * minute
    )
      return reply({ ...result, warning: job.error_message });
    const clientId = Deno.env.get("CDSE_CLIENT_ID");
    const clientSecret = Deno.env.get("CDSE_CLIENT_SECRET");
    if (!clientId || !clientSecret)
      return reply({
        ...result,
        warning:
          "Для анализа Sentinel-2 требуется настроить доступ Copernicus на сервере.",
      });
    const writer = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: jobId, error: claimError } = await writer.rpc(
      "claim_earth_job",
      {
        p_field: fieldId,
        p_provider: sentinelProvider,
        p_dataset: sentinelDataset,
        p_geometry: field.geometry_reference,
        p_year: year,
      },
    );
    if (claimError) throw claimError;
    if (!jobId) return reply({ ...result, pending: true });

    EdgeRuntime.waitUntil(
      (async () => {
        try {
          const observations = await fetchSentinelYear(
            clientId,
            clientSecret,
            year,
            field.projected,
            field.epsg,
          );
          const { error } = await writer.rpc("complete_sentinel_job", {
            p_job: jobId,
            p_metrics: { observations },
            p_metadata: {
              source: "Copernicus Sentinel-2 Level-2A",
              dataset: "sentinel-2-l2a",
              resolution_m: 10,
              scl_resolution_m: 20,
              retained_scl: [4, 5, 6],
              retrieval: new Date().toISOString(),
              year,
              epsg: field.epsg,
              method:
                "Daily UTC least-cloud mosaic, B08/B04 surface reflectance, nearest-neighbour, polygon-clipped",
              attribution: `Contains modified Copernicus Sentinel data ${year}`,
            },
          });
          if (error) throw error;
        } catch (error) {
          console.error("Sentinel job failed", jobId, error);
          const warning =
            error instanceof Error && !(error instanceof DOMException)
              ? error.message
              : "Не удалось получить или сохранить статистику Sentinel-2.";
          const { error: writeError } = await writer
            .from("earth_observation_jobs")
            .update({
              status: "failed",
              completed_at: new Date().toISOString(),
              error_message: warning,
            })
            .eq("id", jobId)
            .eq("status", "running");
          if (writeError)
            console.error("Sentinel job status update failed", writeError);
        }
      })(),
    );
    return reply({ ...result, pending: true });
  } catch (error) {
    console.error("Sentinel request failed", error);
    return reply(
      {
        error:
          "Не удалось открыть аналитику Sentinel-2. Проверьте настройки сервиса.",
      },
      502,
    );
  }
});
