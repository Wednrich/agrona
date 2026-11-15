import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  AdvisorError,
  type AdvisorInput,
} from "../_shared/advisor-contract.ts";
import {
  srtmDataset,
  srtmPeriod,
  srtmRevision,
  type TerrainPolygon,
} from "../_shared/srtm.ts";
import type { ClimateDay } from "../_shared/power.ts";
import {
  dataset as powerDataset,
  provider as powerProvider,
} from "../_shared/power-provider.ts";
import { buildContext, number, type AdvisorSources } from "./context.ts";
import { askDeepSeek } from "./deepseek.ts";
import { createAdvisorHandler, parseInput, record, sha256 } from "./handler.ts";

const session = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};
const url = () => Deno.env.get("SUPABASE_URL")!;
const writer = () =>
  createClient(url(), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: session,
  });
const weatherParams = {
  T2M: "temperature_mean",
  T2M_MIN: "temperature_min",
  T2M_MAX: "temperature_max",
  PRECTOTCORR: "precipitation_mm",
} as const;

type Field = {
  reader: SupabaseClient;
  boundary: TerrainPolygon;
  powerRevision: string;
  hlsRevision: string;
  scenario?: AdvisorSources["scenario"];
};

const scenariosProjection = [
  "crop_sequence",
  "baseline:constraints->currentSequence",
  "maxDays:constraints->maxSeasonDays",
  "planYear:constraints->planYear",
  "irrigation:constraints->irrigation",
  "period:constraints->period",
  "boundary:constraints->sourceSnapshot->boundary->coordinates",
  "score:analysis_result->score",
  "criteria:analysis_result->criteria",
  ...[0, 1, 2].flatMap((i) => [
    `sequence_${i}:analysis_result->comparison->${i}->crop_sequence`,
    `score_${i}:analysis_result->comparison->${i}->analysis_result->score`,
  ]),
].join(",");

function checked<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) throw new AdvisorError("server");
  return data;
}

async function scenarioFor(
  reader: SupabaseClient,
  input: AdvisorInput,
  boundary: TerrainPolygon,
) {
  if (input.mode === "analysis") return undefined;
  let query = reader
    .from("rotation_scenarios")
    .select(scenariosProjection)
    .eq("field_id", input.fieldId);
  query = input.scenarioId
    ? query.eq("id", input.scenarioId)
    : query
        .eq("constraints->period->>year", String(input.year))
        .order("created_at", { ascending: false });
  const result = record(checked(await query.limit(1).maybeSingle()));
  if (!Object.keys(result).length) {
    if (input.mode === "rotation") throw new AdvisorError("scenario");
    return undefined;
  }
  const period = record(result.period);
  const mismatch =
    period.year !== input.year ||
    typeof period.start !== "string" ||
    typeof period.end !== "string" ||
    (input.mode === "rotation" &&
      (period.start !== input.start || period.end !== input.end)) ||
    !Array.isArray(result.boundary) ||
    JSON.stringify(result.boundary) !== JSON.stringify(boundary.coordinates);
  if (mismatch) {
    if (input.mode === "rotation") throw new AdvisorError("period");
    return undefined;
  }
  let dates: AdvisorInput;
  try {
    dates = parseInput({ ...input, start: period.start, end: period.end });
  } catch {
    if (input.mode === "rotation") throw new AdvisorError("period");
    return undefined;
  }
  return {
    sequence: result.crop_sequence,
    score: result.score,
    criteria: result.criteria,
    baseline: result.baseline,
    irrigation: result.irrigation,
    maxDays: result.maxDays,
    planYear: result.planYear,
    start: dates.start,
    end: dates.end,
    comparison: [0, 1, 2].map((i) => ({
      crop_sequence: result[`sequence_${i}`],
      analysis_result: { score: result[`score_${i}`] },
    })),
  };
}

async function weatherFor(
  reader: SupabaseClient,
  input: AdvisorInput,
  powerRevision: string,
) {
  const days = new Map<string, ClimateDay>();
  const columns = await Promise.all(
    Object.entries(weatherParams).map(async ([parameter, key]) => {
      const result = await reader
        .from("earth_observations")
        .select("observation_date,value")
        .eq("field_id", input.fieldId)
        .eq("provider", powerProvider)
        .eq("dataset", powerDataset)
        .eq("geometry_reference", powerRevision)
        .eq("parameter", parameter)
        .gte("observation_date", input.start)
        .lte("observation_date", input.end)
        .limit(366);
      return { key, sample: checked(result) ?? [] };
    }),
  );
  for (const { key, sample } of columns) {
    for (const { observation_date, value } of sample) {
      if (!number(value)) continue;
      const day = days.get(observation_date) ?? {
        observation_date,
        temperature_mean: null,
        temperature_min: null,
        temperature_max: null,
        precipitation_mm: null,
        solar_radiation: null,
      };
      day[key] = value;
      days.set(observation_date, day);
    }
  }
  return [...days.values()].sort((left, right) =>
    left.observation_date.localeCompare(right.observation_date),
  );
}

async function soilFor(boundary: TerrainPolygon) {
  // Use the existing SoilGrids sampler. This request needs neither
  // the caller's bearer token nor any identifier in addition to the geometry.
  try {
    const endpoint =
      Deno.env.get("AGRONA_SOIL_ENDPOINT") ??
      "https://agrona-two.vercel.app/api/soil";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(boundary),
      signal: AbortSignal.timeout(12000),
      redirect: "error",
    });
    return response.ok
      ? await response.json()
      : { status: "source_unavailable" };
  } catch {
    return { status: "source_unavailable" };
  }
}

Deno.serve(
  createAdvisorHandler<Field>({
    async authorize(token, input) {
      const reader = createClient(url(), Deno.env.get("SUPABASE_ANON_KEY")!, {
        auth: session,
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const {
        data: { user },
        error,
      } = await reader.auth.getUser(token);
      if (error?.status && error.status >= 500)
        throw new AdvisorError("server");
      if (error || !user) throw new AdvisorError("sign_in");
      // Both the view and hash RPC use the same owner-only RLS policy.
      const [view, geometry] = await Promise.all([
        reader
          .from("field_geojson")
          .select("boundary")
          .eq("id", input.fieldId)
          .maybeSingle(),
        reader.rpc("hls_field", { p_field: input.fieldId }).maybeSingle(),
      ]);
      const field = checked(view);
      const hlsRevision = record(checked(geometry)).revision;
      if (!field || typeof hlsRevision !== "string")
        throw new AdvisorError("field");
      const boundary = field.boundary as TerrainPolygon;
      const powerRevision = await sha256(JSON.stringify(boundary));
      const scenario = await scenarioFor(reader, input, boundary);
      return {
        userId: user.id,
        revision: await sha256(
          JSON.stringify([powerRevision, hlsRevision, scenario]),
        ),
        field: { reader, boundary, powerRevision, hlsRevision, scenario },
      };
    },
    settings: () => ({
      enabled: Deno.env.get("DEEPSEEK_ENABLED") === "true",
      key: Deno.env.get("DEEPSEEK_API_KEY")?.trim(),
      model:
        Deno.env.get("DEEPSEEK_MODEL") === "deepseek-v4-pro"
          ? "deepseek-v4-pro"
          : "deepseek-flash",
    }),
    async claim(user, field, hash) {
      return checked(
        await writer().rpc("claim_ai_advisor_request", {
          p_user: user,
          p_field: field,
          p_hash: hash,
        }),
      );
    },
    async context({ field }, input) {
      const { reader, boundary, hlsRevision, powerRevision, scenario } = field;
      const fieldId = input.fieldId;
      const selectAnalytics = (key: "vegetation_metrics" | "terrain_metrics") =>
        reader.from("field_analytics").select(key).eq("field_id", fieldId);
      const hlsScope = {
        field_id: fieldId,
        provider: "NASA HLS",
        dataset: "hls-v2-ndvi-v1",
        geometry_reference: hlsRevision,
      };
      const terrainScope = {
        provider: "NASA SRTM",
        dataset: srtmDataset,
        geometry_reference: await srtmRevision(boundary),
      };
      const [weather, hlsJob, hls, terrain, soil, seasons, crops] =
        await Promise.all([
          weatherFor(reader, input, powerRevision),
          reader
            .from("earth_observation_jobs")
            .select("status")
            .match(hlsScope)
            .eq("requested_period", input.year)
            .maybeSingle(),
          selectAnalytics("vegetation_metrics")
            .match(hlsScope)
            .eq("analysis_period", input.year)
            .maybeSingle(),
          selectAnalytics("terrain_metrics")
            .match(terrainScope)
            .eq("analysis_period", srtmPeriod)
            .maybeSingle(),
          soilFor(boundary),
          reader
            .from("field_seasons")
            .select("year,crop_id")
            .eq("field_id", fieldId)
            .lte(
              "year",
              number(scenario?.planYear) ? scenario.planYear - 1 : input.year,
            )
            .order("year", { ascending: false })
            .limit(8),
          reader
            .from("crops")
            .select(
              "id,name,crop_family,water_requirement_min_mm,water_requirement_max_mm",
            ),
        ]);
      return buildContext(input, {
        weather,
        hls: record(record(checked(hls)).vegetation_metrics).observations,
        hlsComplete: checked(hlsJob)?.status === "succeeded",
        terrain: record(checked(terrain)).terrain_metrics,
        soil,
        crops: checked(crops) ?? [],
        seasons: checked(seasons) ?? [],
        scenario,
      });
    },
    infer: askDeepSeek,
    async complete(id, answer, usage) {
      checked(
        await writer()
          .from("ai_advisor_requests")
          .update({
            finished_at: new Date().toISOString(),
            answer,
            prompt_tokens: usage?.prompt,
            completion_tokens: usage?.completion,
          })
          .eq("id", id),
      );
    },
  }),
);
