import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers });

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
    const { fieldId, year } = (await request.json().catch(() => ({}))) ?? {};
    if (
      typeof fieldId !== "string" ||
      !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(fieldId) ||
      !Number.isInteger(year) ||
      year < 2013 ||
      year >= new Date().getUTCFullYear()
    )
      return reply(
        { error: "Выберите поле и завершённый год с 2013 года." },
        400,
      );
    const { data: field, error: fieldError } = await reader
      .rpc("hls_field_preflight", { p_field: fieldId })
      .maybeSingle();
    if (fieldError) throw fieldError;
    if (!field) return reply({ error: "Поле недоступно." }, 404);
    const preflight = field as { revision: string; reason: string | null };
    const { revision, reason } = preflight;
    const scope = {
      field_id: fieldId,
      provider: "NASA HLS",
      dataset: "hls-v2-ndvi-v1",
      geometry_reference: revision,
    };
    const job = await reader
      .from("earth_observation_jobs")
      .select("status,started_at,completed_at,error_message")
      .match(scope)
      .eq("requested_period", year)
      .maybeSingle();
    if (job.error) throw job.error;
    // A terminal status and its cache are committed together. Read the cache
    // after the status so a finished response cannot carry an older checkpoint.
    const cache = await reader
      .from("field_analytics")
      .select("vegetation_metrics,source_metadata")
      .match(scope)
      .eq("analysis_period", year)
      .maybeSingle();
    if (cache.error) throw cache.error;
    const result = {
      observations: cache.data?.vegetation_metrics?.observations ?? [],
      metadata: cache.data?.source_metadata,
      cached: !!cache.data,
    };
    if (reason) {
      const details: Record<string, string> = {
        area: "Площадь поля превышает ориентир 22 500 га для анализа целиком на сетке 30 м.",
        window:
          "По предварительной оценке прямоугольное окно поля на сетке 30 м превышает лимит 250 000 пикселей. Это возможно и для узкого поля.",
        extent:
          "Граница слишком протяжённая для расчёта растрового окна в соседних зонах UTM.",
        projection: "Для этой границы не удалось оценить окно в проекции UTM.",
      };
      return reply({
        ...result,
        unsupported: true,
        pending: false,
        warning: `NASA HLS не может запустить анализ этого поля. ${details[reason] ?? "Граница не подходит для предварительной оценки."} Поле доступно для климатической аналитики.`,
      });
    }
    if (job.data?.status === "running") {
      const queued =
        job.data.started_at === "-infinity" ||
        Date.parse(job.data.started_at) <= Date.now() - 15 * 60000;
      return reply({
        ...result,
        pending: true,
        queued,
        state: queued ? (cache.data ? "partial" : "queued") : "running",
      });
    }
    const age = Date.now() - Date.parse(job.data?.completed_at ?? "");
    if (job.data?.status === "succeeded" && age < 180 * 86400000)
      return reply({ ...result, state: "succeeded" });
    if (job.data?.status === "failed" && age < 30 * 60000)
      return reply({
        ...result,
        state: "failed",
        warning: job.data.error_message ?? "Не удалось завершить анализ NASA HLS.",
      });
    const writer = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { error } = await writer.rpc("enqueue_hls", {
      p_field: fieldId,
      p_revision: revision,
      p_year: year,
    });
    if (error) throw error;
    return reply({
      ...result,
      pending: true,
      queued: true,
      state: cache.data ? "partial" : "queued",
    });
  } catch {
    // SDK exceptions may contain request details. Do not log raw errors.
    console.error("HLS queue request failed");
    return reply(
      {
        error:
          "Не удалось открыть аналитику NASA HLS. Проверьте настройки сервиса.",
      },
      502,
    );
  }
});
