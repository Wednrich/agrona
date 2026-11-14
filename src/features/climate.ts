import type { Observation } from "../lib/types";
export function average(values: (number | null)[]) {
  const v = values.filter((n): n is number => n !== null && Number.isFinite(n));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
export function climateSummary(observations: Observation[]) {
  const ordered = [...observations].sort((a, b) =>
    a.observation_date.localeCompare(b.observation_date),
  );
  let dry = 0,
    longestDry = 0,
    previous = "";
  for (const o of ordered) {
    const contiguous =
      previous &&
      Date.parse(o.observation_date) - Date.parse(previous) === 86400000;
    dry =
      o.precipitation_mm !== null && o.precipitation_mm < 1
        ? contiguous
          ? dry + 1
          : 1
        : 0;
    longestDry = Math.max(dry, longestDry);
    previous = o.observation_date;
  }
  const rain = observations
    .map((o) => o.precipitation_mm)
    .filter((n): n is number => n !== null);
  const highs = observations
    .map((o) => o.temperature_max)
    .filter((n): n is number => n !== null);
  const lows = observations
    .map((o) => o.temperature_min)
    .filter((n): n is number => n !== null);
  return {
    mean: average(observations.map((o) => o.temperature_mean)),
    max: highs.length ? Math.max(...highs) : null,
    min: lows.length ? Math.min(...lows) : null,
    rain: rain.length ? rain.reduce((a, b) => a + b, 0) : null,
    rainDays: rain.length,
    solar: average(observations.map((o) => o.solar_radiation)),
    longestDry,
    hotDays: highs.filter((n) => n > 35).length,
    missing: observations.filter((o) =>
      [
        o.temperature_mean,
        o.temperature_max,
        o.temperature_min,
        o.precipitation_mm,
        o.solar_radiation,
      ].some((x) => x === null),
    ).length,
  };
}
export function monthly(observations: Observation[]) {
  return Array.from({ length: 12 }, (_, m) => {
    const rows = observations.filter(
      (o) => Number(o.observation_date.slice(5, 7)) === m + 1,
    );
    const summary = climateSummary(rows);
    return {
      month: [
        "Янв",
        "Фев",
        "Мар",
        "Апр",
        "Май",
        "Июн",
        "Июл",
        "Авг",
        "Сен",
        "Окт",
        "Ноя",
        "Дек",
      ][m],
      temperature: summary.mean,
      rain: summary.rain,
      days: rows.length,
      missing: summary.missing,
    };
  });
}

export const cropSeasons = {
  wheat: { label: "Яровая пшеница", start: "05-15", end: "09-15" },
  barley: { label: "Ячмень", start: "05-10", end: "08-31" },
  maize: { label: "Кукуруза", start: "05-20", end: "09-30" },
  sunflower: { label: "Подсолнечник", start: "05-15", end: "10-01" },
  other: { label: "Другая культура", start: "05-01", end: "09-30" },
};
export type SeasonCrop = keyof typeof cropSeasons;

export function suggestedSeason(year: number, crop: SeasonCrop) {
  return {
    start: `${year}-${cropSeasons[crop].start}`,
    end: `${year}-${cropSeasons[crop].end}`,
  };
}

export function selectClimatePeriod(
  rows: Observation[],
  year: number,
  start: string,
  end: string,
) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (!start || !end || start > end || start < yearStart || end > yearEnd)
    return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    new Date(startMs).toISOString().slice(0, 10) !== start ||
    new Date(endMs).toISOString().slice(0, 10) !== end
  )
    return null;
  const days = (endMs - startMs) / 86400000 + 1;
  const daily = rows.filter(
    (row) => row.observation_date >= start && row.observation_date <= end,
  );
  const dates = new Set(daily.map((row) => row.observation_date));
  const completeDates = new Set(
    daily
      .filter((row) =>
        [
          row.temperature_mean,
          row.precipitation_mm,
          row.solar_radiation,
          row.humidity,
          row.wind_speed,
        ].every(Number.isFinite),
      )
      .map((row) => row.observation_date),
  );
  const availableDates = new Set(
    daily
      .filter((row) =>
        [
          row.temperature_mean,
          row.precipitation_mm,
          row.solar_radiation,
          row.humidity,
          row.wind_speed,
        ].some(Number.isFinite),
      )
      .map((row) => row.observation_date),
  );
  const firstMonth = Number(start.slice(5, 7)) - 1;
  const lastMonth = Number(end.slice(5, 7));
  return {
    daily,
    days,
    available: availableDates.size,
    absent: days - dates.size,
    partial: dates.size - completeDates.size,
    series: monthly(daily).slice(firstMonth, lastMonth),
  };
}
