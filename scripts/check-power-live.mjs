import assert from "node:assert/strict";
import { fetchPower } from "../supabase/functions/_shared/power-provider.ts";
import { powerMetrics } from "../supabase/functions/_shared/power-metrics.ts";

const { observations } = await fetchPower(2025, 69.3695, 51.197);
assert.equal(observations.length, 365);
assert.equal(observations[0].observation_date, "2025-01-01");
assert.equal(observations.at(-1).observation_date, "2025-12-31");
for (const key of [
  "temperature_mean",
  "temperature_max",
  "temperature_min",
  "precipitation_mm",
  "solar_radiation",
  "humidity",
  "wind_speed",
]) {
  assert.ok(
    observations.some((row) => Number.isFinite(row[key])),
    key,
  );
}
const result = powerMetrics(observations, 365);
assert.ok(result.temperatureDays > 0 && result.rainDays > 0);
console.log(
  "NASA POWER live adapter verified:",
  observations.length,
  "days, all seven parameters, and derived metrics.",
);
