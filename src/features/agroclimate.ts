import { t } from "../lib/i18n";
import type { Observation } from "../lib/types";

export const modelVersion = "agroclimate-1";
export const fao56 = "https://www.fao.org/4/x0490e/x0490e07.htm";
const durations = "https://www.fao.org/4/s2022e/s2022e02.htm";
const corn =
  "https://www.udel.edu/academics/colleges/canr/cooperative-extension/fact-sheets/corn-growth-stages-and-management/";
type Reference<T> = { value: T; source: string; calibrated: boolean };
const reference = <T>(value: T, source: string): Reference<T> => ({
  value,
  source,
  calibrated: false,
});
type Range = readonly [number, number];
type Thermal = { base: number; cap?: number; floor?: boolean; target?: Range };
export type CropProfile = {
  name: string;
  season: "spring" | "winter";
  version: number;
  days?: Reference<Range>;
  thermal?: Reference<Thermal>;
  sowing?: Reference<{ minSoil: number }>;
  stageFrost?: Reference<
    readonly { start: number; end: number; threshold: number }[]
  >;
  heat?: Reference<number>;
  water?: Reference<Range>;
  stages?: Reference<readonly { days: number; kc: number }[]>;
  photoperiod?: Reference<string>;
};

export const profiles: Record<string, CropProfile> = {
  wheat: {
    name: "Яровая пшеница",
    season: "spring",
    version: 1,
    days: reference([120, 150], durations),
  },
  maize: {
    name: "Кукуруза (зерно)",
    season: "spring",
    version: 1,
    days: reference([125, 180], durations),
    thermal: reference(
      { base: 10, cap: 30, floor: true, target: [2686 / 1.8, 2926 / 1.8] },
      corn,
    ),
    sowing: reference(
      { minSoil: 10 },
      "https://kazniizr.kz/wp-content/uploads/2025/03/rekomendacziya-vesenne-polevyh-rabot_2025.pdf",
    ),
  },
  sunflower: {
    name: "Подсолнечник",
    season: "spring",
    version: 1,
    days: reference([125, 130], durations),
  },
  potato: {
    name: "Картофель",
    season: "spring",
    version: 1,
    days: reference([105, 145], durations),
  },
  barley: {
    name: "Ячмень (яровой)",
    season: "spring",
    version: 1,
    days: reference([120, 150], durations),
  },
};

export const iso = (date: Date) => date.toISOString().slice(0, 10);
export const dateAt = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day));
const dayMs = 86400000;
export const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + dayMs * days);
export const span = (start: Date, count: number) =>
  Array.from({ length: count }, (_, i) => iso(addDays(start, i)));
const rad = Math.PI / 180;
export const present = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function solarDay(date: Date, latitude: number) {
  const day =
    Math.round(
      (date.getTime() - dateAt(date.getUTCFullYear(), 0, 1).getTime()) / dayMs,
    ) + 1;
  const angle = (2 * Math.PI * day) / 365;
  const declination = 0.409 * Math.sin(angle - 1.39);
  const phi = latitude * rad;
  const sunset = Math.acos(
    Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(declination))),
  );
  return {
    daylight: (24 * sunset) / Math.PI,
    altitude: 90 - Math.abs(latitude - declination / rad),
    extraterrestrial:
      ((24 * 60) / Math.PI) *
      0.082 *
      (1 + 0.033 * Math.cos(angle)) *
      (sunset * Math.sin(phi) * Math.sin(declination) +
        Math.cos(phi) * Math.cos(declination) * Math.sin(sunset)),
  };
}

export function degreeDays(
  min: number | null | undefined,
  max: number | null | undefined,
  model?: Thermal,
) {
  if (!model || !present(min) || !present(max) || min > max) return null;
  const limit = (t: number) =>
    Math.min(model.cap ?? Infinity, model.floor ? Math.max(t, model.base) : t);
  return Math.max(0, (limit(min) + limit(max)) / 2 - model.base);
}

const saturation = (t: number) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
export function vapor(row?: Observation) {
  const min = row?.temperature_min,
    max = row?.temperature_max,
    rh = row?.humidity;
  if (
    !present(min) ||
    !present(max) ||
    min > max ||
    !present(rh) ||
    rh < 0 ||
    rh > 100
  )
    return null;
  const es = (saturation(min) + saturation(max)) / 2;
  const ea = (es * rh) / 100; // FAO-56 Eq. 19, approximation with mean RH.
  return { ea, deficit: es - ea };
}

export function penmanMonteith(
  t: number,
  elevation: number,
  wind2m: number,
  netRadiation: number,
  vpd: number,
) {
  const delta = (4098 * saturation(t)) / (t + 237.3) ** 2;
  const gamma = 0.000665 * 101.3 * ((293 - 0.0065 * elevation) / 293) ** 5.26;
  return Math.max(
    0,
    (0.408 * delta * netRadiation +
      ((gamma * 900) / (t + 273)) * wind2m * vpd) /
      (delta + gamma * (1 + 0.34 * wind2m)),
  );
}

export function referenceET(
  row: Observation | undefined,
  latitude: number,
  elevation?: number,
) {
  const moisture = vapor(row);
  if (
    !row ||
    !moisture ||
    !present(elevation) ||
    !present(row.temperature_mean) ||
    !present(row.wind_speed) ||
    row.wind_speed < 0 ||
    !present(row.solar_radiation) ||
    row.solar_radiation < 0
  )
    return null;
  const ra = solarDay(
    new Date(row.observation_date),
    latitude,
  ).extraterrestrial;
  const clear = (0.75 + 0.00002 * elevation) * ra;
  if (clear <= 0 || row.solar_radiation / clear < 0.3) return null;
  const cloud = 1.35 * Math.min(1, row.solar_radiation / clear) - 0.35;
  const outgoing =
    ((4.903e-9 *
      ((row.temperature_max! + 273.16) ** 4 +
        (row.temperature_min! + 273.16) ** 4)) /
      2) *
    (0.34 - 0.14 * Math.sqrt(moisture.ea)) *
    cloud;
  return penmanMonteith(
    row.temperature_mean,
    elevation,
    row.wind_speed,
    0.77 * row.solar_radiation - outgoing,
    moisture.deficit,
  );
}

export function summarize(values: (number | null | undefined)[]) {
  const valid = values.filter(present);
  const total = valid.reduce((a, b) => a + b, 0);
  return {
    total: valid.length ? total : null,
    mean: valid.length ? total / valid.length : null,
    days: valid.length,
    expected: values.length,
  };
}

export function frostSeason(
  rows: Map<string, Observation>,
  year: number,
  latitude: number,
) {
  const start = dateAt(year, latitude < 0 ? 6 : 0, 1);
  const split = iso(
    dateAt(year + (latitude < 0 ? 1 : 0), latitude < 0 ? 0 : 6, 1),
  );
  const next = dateAt(year + 1, start.getUTCMonth(), 1);
  const dates = span(start, (next.getTime() - start.getTime()) / dayMs);
  const valid = dates.filter((d) => present(rows.get(d)?.temperature_min));
  const frosts = valid.filter((d) => rows.get(d)!.temperature_min! <= 0);
  const complete = valid.length === dates.length;
  const last = complete ? frosts.filter((d) => d < split).at(-1) : undefined;
  const first = complete ? frosts.find((d) => d >= split) : undefined;
  return {
    last,
    first,
    days: frosts.length,
    observed: valid.length,
    expected: dates.length,
    free:
      last && first ? (Date.parse(first) - Date.parse(last)) / dayMs - 1 : null,
  };
}

export type Status =
  "favorable" | "risky" | "unfavorable" | "insufficient_data";
export function evaluateWindow(
  rows: Map<string, Observation>,
  start: Date,
  profile: CropProfile,
  latitude: number,
  elevation?: number,
) {
  const model = profile.thermal?.value;
  const timeline = span(start, profile.days?.value[1] ?? 0);
  const heat = timeline.map((date) => {
    const row = rows.get(date);
    return degreeDays(row?.temperature_min, row?.temperature_max, model);
  });
  let cumulative = 0;
  let reached: string | undefined;
  let reachedUpper: string | undefined;
  for (const [i, value] of heat.entries()) {
    if (value === null) break;
    cumulative += value;
    if (model?.target && cumulative >= model.target[0]) reached ??= timeline[i];
    if (model?.target && cumulative >= model.target[1]) {
      reachedUpper = timeline[i];
      break;
    }
  }
  const end = reachedUpper
    ? Math.max(timeline.indexOf(reachedUpper) + 1, profile.days!.value[0])
    : timeline.length;
  const dates = timeline.slice(0, end);
  const daily = dates.map((date) => rows.get(date));
  const radiation = summarize(daily.map((row) => row?.solar_radiation));
  const rain = summarize(daily.map((row) => row?.precipitation_mm));
  const humidity = summarize(daily.map((row) => row?.humidity));
  const vpd = summarize(daily.map((row) => vapor(row)?.deficit));
  const et = daily.map((row) => referenceET(row, latitude, elevation));
  const et0 = summarize(et);
  const kc = profile.stages?.value.flatMap((stage) =>
    Array<number>(stage.days).fill(stage.kc),
  );
  const etc =
    kc?.length === dates.length
      ? summarize(et.map((value, i) => (value === null ? null : value * kc[i])))
      : null;
  let longestDry = 0,
    dry = 0;
  let frost = 0,
    frostCoverage = 0,
    critical = 0,
    hot = 0;
  daily.forEach((row, i) => {
    dry =
      present(row?.precipitation_mm) && row.precipitation_mm < 1 ? dry + 1 : 0;
    longestDry = Math.max(longestDry, dry);
    if (present(row?.temperature_min)) {
      frostCoverage++;
      if (row.temperature_min <= 0) frost++;
      const stage = profile.stageFrost?.value.find(
        (s) => i >= s.start && i < s.end,
      );
      if (stage && row.temperature_min < stage.threshold) critical++;
    }
    if (
      present(row?.temperature_max) &&
      profile.heat &&
      row.temperature_max > profile.heat.value
    )
      hot++;
  });
  const thermal = summarize(heat.slice(0, end));
  const thermalComplete = !!model?.target && thermal.days === end && end > 0;
  const reasons: string[] = [];
  if (!profile.thermal?.calibrated)
    reasons.push(t("Нет тепловой калибровки местного сорта."));
  if (!model?.target)
    reasons.push(
      t("Нет проверенных Tbase и/или целевого GDD для этого профиля."),
    );
  else if (!thermalComplete)
    reasons.push(t("Есть пропуски Tmin или Tmax в расчётном сезоне."));
  else if (!reached)
    reasons.push(t("Тепловой ориентир не достигнут за расчётный сезон."));
  else
    reasons.push(
      t(
        "Историческая температура позволяла достичь справочного теплового ориентира.",
      ),
    );
  if (frost)
    reasons.push(
      t(
        "Дней с Tmin ≤ 0 °C: {0}. Это сигнал для проверки, чувствительность зависит от фазы.",
        frost,
      ),
    );
  if (critical || hot)
    reasons.push(
      t("Дней ниже порога фазы: {0}; выше порога жары: {1}.", critical, hot),
    );
  if (profile.sowing)
    reasons.push(
      t(
        "Проверить температуру почвы на глубине посева (от {0} °C по региональному ориентиру).",
        profile.sowing.value.minSoil,
      ),
    );
  else reasons.push(t("Нет проверенного местного порога для посева."));
  if (profile.season === "winter")
    reasons.push(t("Перезимовка и яровизация требуют отдельной модели."));
  reasons.push(
    t(
      "Обеспеченность влагой неизвестна без запасов почвы, эффективных осадков и полива.",
    ),
  );
  // A reference hybrid or a calendar duration cannot certify a whole crop cycle.
  const status: Status =
    profile.season === "winter" || !thermalComplete
      ? "insufficient_data"
      : !reached
        ? profile.thermal?.calibrated
          ? "unfavorable"
          : "risky"
        : critical || hot || frost
          ? "risky"
          : "insufficient_data";
  return {
    status,
    reasons,
    reachedUpper,
    end: dates.at(-1),
    reached,
    thermal,
    thermalComplete,
    frost,
    frostCoverage,
    radiation,
    rain,
    humidity,
    longestDry,
    vpd,
    et0,
    etc,
    referenceGap:
      et0.days === end && rain.days === end && end > 0
        ? et0.total! - rain.total!
        : null,
  };
}
