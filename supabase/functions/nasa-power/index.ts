import { createClient } from "npm:@supabase/supabase-js@2";
import { bbox, centerOfMass } from "npm:@turf/turf@7.2.0";
import {
  dataset,
  fetchPower,
  powerParameters,
  provider,
  spatialResolution,
} from "../_shared/power-provider.ts";
import { powerMetrics } from "../_shared/power-metrics.ts";

declare const EdgeRuntime: { waitUntil(task: Promise<void>): void };

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Требуется вход" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const db = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser();
    if (authError || !user) return json({ error: "Требуется вход" }, 401);
    const { fieldId, year, refresh, cacheOnly } = await req.json();
    const currentYear = new Date().getUTCFullYear();
    if (
      typeof fieldId !== "string" ||
      !Number.isInteger(year) ||
      year < 1984 ||
      year >= currentYear
    )
      return json({ error: "Выберите завершённый год с 1984 года" }, 400);
    // The caller's RLS access is checked before constructing the service client.
    const { data: field, error: fieldError } = await db
      .from("field_geojson")
      .select("id,boundary")
      .eq("id", fieldId)
      .maybeSingle();
    if (fieldError) throw fieldError;
    if (!field) return json({ error: "Поле недоступно" }, 404);
    const [lon, lat] = centerOfMass(field.boundary).geometry.coordinates;
    const bounds = bbox(field.boundary);
    const geometryHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(field.boundary)),
    );
    const geometry = Array.from(new Uint8Array(geometryHash), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    const scope = {
      field_id: fieldId,
      provider,
      dataset,
      geometry_reference: geometry,
    };
    const { data: cache, error: cacheError } = await db
      .from("field_analytics")
      .select("climate_metrics,source_metadata,calculated_at")
      .match(scope)
      .eq("analysis_period", year)
      .maybeSingle();
    if (cacheError) throw cacheError;

    const observations: Record<string, unknown>[] = [];
    if (cache) {
      const rows = new Map<string, Record<string, unknown>>();
      const deadline = `${year + 1}-01-01`;
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await db
          .from("earth_observations")
          .select("parameter,observation_date,value")
          .match(scope)
          .gte("observation_date", `${year}-01-01`)
          .lt("observation_date", deadline)
          .order("observation_date")
          .order("parameter")
          .range(offset, offset + 499);
        if (error) throw error;
        for (const row of data) {
          const param =
            powerParameters[row.parameter as keyof typeof powerParameters];
          if (!param) continue;
          const day = rows.get(row.observation_date) ?? {
            observation_date: row.observation_date,
          };
          day[param[0]] = row.value;
          rows.set(row.observation_date, day);
        }
        if (data.length < 500) break;
      }
      observations.push(...rows.values());
    }
    const { data: history, error: historyError } = await db
      .from("field_analytics")
      .select("analysis_period,climate_metrics")
      .match(scope)
      .order("analysis_period");
    if (historyError) throw historyError;
    const result = {
      observations,
      metadata: cache?.source_metadata,
      metrics: cache?.climate_metrics,
      history,
      cached: !!cache,
    };
    if (!cache) {
      const { data: legacy, error } = await db
        .from("analysis_results")
        .select("result,source_metadata")
        .eq("field_id", fieldId)
        .eq("analysis_type", `power-v1-${year}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (
        legacy?.source_metadata?.geometry === JSON.stringify(field.boundary)
      ) {
        result.observations = legacy.result.observations;
        result.metadata = legacy.source_metadata;
        result.cached = true;
      }
    }
    if (cacheOnly === true) return json(result);
    const { data: job, error: jobError } = await db
      .from("earth_observation_jobs")
      .select("status,started_at,error_message")
      .match(scope)
      .eq("requested_period", year)
      .maybeSingle();
    if (jobError) throw jobError;
    if (
      job?.status === "running" &&
      Date.now() - Date.parse(job.started_at) < 180000
    )
      return json({ ...result, pending: true });
    const ttl = year === currentYear - 1 ? 7 * 86400000 : 180 * 86400000;
    if (!refresh && cache && Date.now() - Date.parse(cache.calculated_at) < ttl)
      return json(result);
    if (
      !refresh &&
      job?.status === "failed" &&
      Date.now() - Date.parse(job.started_at) < 30 * 60000
    )
      return json({ ...result, warning: job.error_message });

    const writer = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: jobId, error: claimError } = await writer.rpc(
      "claim_earth_job",
      {
        p_field: fieldId,
        p_provider: provider,
        p_dataset: dataset,
        p_geometry: geometry,
        p_year: year,
      },
    );
    if (claimError) throw claimError;
    if (!jobId) {
      const { data: latest, error } = await db
        .from("earth_observation_jobs")
        .select("status,error_message")
        .match(scope)
        .eq("requested_period", year)
        .single();
      if (error) throw error;
      return json({
        ...result,
        pending:
          latest.status === "running" ||
          (!cache && latest.status === "succeeded"),
        warning:
          latest.status === "failed"
            ? "Повторите запрос через минуту."
            : undefined,
      });
    }
    EdgeRuntime.waitUntil(
      (async () => {
        try {
          const retrieved = await fetchPower(year, lon, lat);
          const days = retrieved.observations;
          const expectedDays =
            (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
          const metrics = powerMetrics(days, expectedDays);
          const metadata = {
            source: provider,
            dataset,
            geometry,
            retrieved_at: new Date().toISOString(),
            period: `${days[0].observation_date} — ${days.at(-1)!.observation_date}`,
            centroid: [lon, lat],
            bbox: bounds,
            url: retrieved.sourceUrl,
            upstream: retrieved.upstream,
            method: "Polygon centroid sampled on the native provider grid",
            resolution: {
              weather: spatialResolution("T2M"),
              solar: spatialResolution("ALLSKY_SFC_SW_DWN"),
            },
          };
          const rows = days.flatMap((day) =>
            Object.entries(powerParameters).map(([parameter, [key, unit]]) => ({
              parameter,
              unit,
              observation_date: day.observation_date,
              value: day[key] ?? null,
              spatial_resolution: spatialResolution(parameter),
            })),
          );
          const { error } = await writer.rpc("complete_power_job", {
            p_job: jobId,
            p_observations: rows,
            p_metrics: metrics,
            p_metadata: metadata,
          });
          if (error) throw error;
        } catch (error) {
          console.error("POWER job failed", jobId, error);
          const { error: updateError } = await writer
            .from("earth_observation_jobs")
            .update({
              status: "failed",
              completed_at: new Date().toISOString(),
              error_message:
                error instanceof Error
                  ? error.message
                  : "Не удалось сохранить наблюдения NASA POWER.",
            })
            .eq("id", jobId)
            .eq("status", "running");
          if (updateError)
            console.error("Failed to update POWER job", jobId, updateError);
        }
      })(),
    );
    return json({ ...result, pending: true });
  } catch (error) {
    console.error("POWER request failed", error);
    return json({ error: "Не удалось открыть наблюдения NASA POWER." }, 502);
  }
});
