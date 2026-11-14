import type { ClimateDay } from "./power.ts";

export function powerMetrics(rows: ClimateDay[], expectedDays: number) {
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const present = (values: (number | null)[]) =>
    values.filter((v): v is number => v !== null);
  const temperatures = present(rows.map((row) => row.temperature_mean));
  const rain = present(rows.map((row) => row.precipitation_mm));
  const highs = present(rows.map((row) => row.temperature_max));
  const lows = present(rows.map((row) => row.temperature_min));
  let dry = 0;
  let longestDry = 0;
  let previous = 0;
  for (const row of rows) {
    const day = Date.parse(row.observation_date);
    if (day - previous !== 86400000) dry = 0;
    dry =
      row.precipitation_mm !== null && row.precipitation_mm < 1 ? dry + 1 : 0;
    longestDry = Math.max(longestDry, dry);
    previous = day;
  }
  return {
    expectedDays,
    temperatureDays: temperatures.length,
    rainDays: rain.length,
    mean: temperatures.length ? sum(temperatures) / temperatures.length : null,
    rain: rain.length ? sum(rain) : null,
    hotDays: highs.length ? highs.filter((value) => value > 35).length : null,
    frostDays: lows.length ? lows.filter((value) => value < 0).length : null,
    heavyRainDays: rain.length
      ? rain.filter((value) => value >= 20).length
      : null,
    longestDry: rain.length ? longestDry : null,
    gdd5: temperatures.length
      ? sum(temperatures.map((value) => Math.max(0, value - 5)))
      : null,
    seasons: [1, 4, 7, 10].map((start) => {
      const slice = rows.filter((row) => {
        const month = Number(row.observation_date.slice(5, 7));
        return month >= start && month < start + 3;
      });
      const year = Number(rows[0]?.observation_date.slice(0, 4));
      const quarterDays =
        (Date.UTC(year, start + 2, 1) - Date.UTC(year, start - 1, 1)) /
        86400000;
      const temp = present(slice.map((row) => row.temperature_mean));
      const rainfall = present(slice.map((row) => row.precipitation_mm));
      return {
        mean:
          temp.length === quarterDays && temp.length
            ? sum(temp) / temp.length
            : null,
        rain:
          rainfall.length === quarterDays && rainfall.length
            ? sum(rainfall)
            : null,
      };
    }),
  };
}
