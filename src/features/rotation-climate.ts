import type { Observation } from "../lib/types";
import { average, climateSummary, selectClimatePeriod } from "./climate";

export type RotationPeriod = { year: number; start: string; end: string };
const dayMs = 86_400_000;

export function matchesRotationGeometry(
  reference: unknown,
  fingerprint: string,
  revision: string,
) {
  return reference === revision || reference === fingerprint;
}

export function summarizeRotationClimate(
  rows: Observation[],
  period: RotationPeriod,
) {
  const selected = selectClimatePeriod(
    rows,
    period.year,
    period.start,
    period.end,
  );
  if (!selected)
    throw new Error(
      "Укажите корректные даты в пределах одного исторического года.",
    );
  const number = (value: number | null) =>
    Number.isFinite(value) && value !== -999 ? value : null;
  const ordered = [
    ...new Map(
      selected.daily.map((row) => [
        row.observation_date,
        {
          ...row,
          temperature_mean: number(row.temperature_mean),
          temperature_min: number(row.temperature_min),
          temperature_max: number(row.temperature_max),
          precipitation_mm:
            (row.precipitation_mm ?? -1) >= 0
              ? number(row.precipitation_mm)
              : null,
        },
      ]),
    ).values(),
  ].sort((a, b) => a.observation_date.localeCompare(b.observation_date));
  const coverage = {
    mean: ordered.filter((r) => r.temperature_mean !== null).length,
    min: ordered.filter((r) => r.temperature_min !== null).length,
    max: ordered.filter((r) => r.temperature_max !== null).length,
    rain: ordered.filter((r) => r.precipitation_mm !== null).length,
  };
  let frostFree = 0;
  let longestFrostFree = 0;
  let previous = NaN;
  for (const row of ordered) {
    const date = Date.parse(row.observation_date);
    frostFree =
      row.temperature_min !== null && row.temperature_min > 0
        ? (date - previous === dayMs ? frostFree : 0) + 1
        : 0;
    longestFrostFree = Math.max(longestFrostFree, frostFree);
    previous = date;
  }
  const weather = climateSummary(ordered);
  return {
    ...period,
    days: selected.days,
    coverage,
    mean: average(ordered.map((row) => row.temperature_mean)),
    rain: weather.rain,
    longestDry: coverage.rain ? weather.longestDry : null,
    frostDays: coverage.min
      ? ordered.filter(
          (row) => row.temperature_min !== null && row.temperature_min <= 0,
        ).length
      : null,
    hotDays: coverage.max ? weather.hotDays : null,
    frostFree: coverage.min === selected.days ? longestFrostFree : null,
  };
}
