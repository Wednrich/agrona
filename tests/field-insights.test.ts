import { setLanguage } from "../src/lib/i18n";
import { describe, expect, it } from "vitest";
import {
  climateInsights,
  fieldContextInsights,
  vegetationInsights,
  type VegetationSample,
} from "../src/features/field-insights";
import { initialDemo } from "../src/lib/demo";
import type { Observation } from "../src/lib/types";

setLanguage("ru");

const period = { year: 2025, start: "2025-05-01", end: "2025-05-20" };
const row = (day: number, values: Partial<Observation> = {}): Observation => ({
  observation_date: `2025-05-${String(day).padStart(2, "0")}`,
  temperature_min: 5,
  temperature_mean: 18,
  temperature_max: 26,
  precipitation_mm: 0.3,
  solar_radiation: null,
  ...values,
});
const sample = (
  date: string,
  mean: number,
  variants: Partial<VegetationSample> = {},
): VegetationSample => ({
  date,
  conceptId: date,
  mean,
  dataset: "HLSS30",
  tileContainsField: true,
  fieldPixels: 100,
  validPixels: 90,
  ...variants,
});

describe("field conclusions", () => {
  it("detects historical hot, freezing and dry conditions only in the selected period", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row(
        i + 1,
        i === 0
          ? { temperature_min: -1 }
          : i === 19
            ? { temperature_max: 37 }
            : {},
      ),
    );
    const season = climateInsights(
      [...rows, row(21, { temperature_max: 39 })],
      period,
    );
    expect(season.map((item) => item.id)).toEqual([
      "dry-spell",
      "heat",
      "frost",
      "season-weather",
    ]);
    expect(season.find((item) => item.id === "heat")?.observation).toContain(
      "1 из 20",
    );
    expect(season.find((item) => item.id === "dry-spell")?.limits).toContain(
      "корневой зоны",
    );
    const annual = climateInsights(
      [...rows, row(21, { temperature_max: 39 })],
      { ...period, start: "2025-01-01", end: "2025-12-31" },
    );
    expect(annual.find((item) => item.id === "heat")?.observation).toContain(
      "2 из 21",
    );
  });
  it("warns about missing data, ignores fill values and breaks dry spells on a gap", () => {
    const partial = Array.from({ length: 20 }, (_, i) =>
      row(i + 1, { temperature_min: -999, temperature_mean: null }),
    );
    partial.splice(9, 1);
    const result = climateInsights(partial, period);
    expect(result.map((item) => item.id)).toEqual(["climate-coverage"]);
    expect(result[0].confidence).toBe("Недостаточно данных");
    expect(climateInsights([], { ...period, start: "2025-13-02" })).toEqual([]);
  });

  it("compares only distinct dates from a comparable HLS product and time window", () => {
    const rows = [
      sample("2025-05-01", 0.2),
      sample("2025-05-08", 0.3),
      sample("2025-05-19", 0.5),
      sample("2025-05-01", 0.9, { validPixels: 80 }),
      sample("2025-05-18", 0.9, { validPixels: 79 }),
      sample("2025-05-20", 0.9, { dataset: "HLSL30" }),
      sample("2025-05-21", 0.9),
      sample("2025-05-20", 0.9, { tileContainsField: false }),
    ];
    const [result] = vegetationInsights(rows, period);
    expect(result.observation).toContain("+0,3");
    expect(result.confidence).toBe("Умеренная");
    expect(result.limits).toContain("NDVI не измеряет влажность");
    expect(vegetationInsights(rows.slice(2), period)[0].confidence).toBe(
      "Недостаточно данных",
    );
    expect(
      vegetationInsights(
        [rows[0], rows[1], { ...rows[2], fieldPixels: 101 }],
        period,
      )[0].confidence,
    ).toBe("Недостаточно данных");
  });

  it("uses only field history available by the selected season end", () => {
    const [field] = initialDemo.fields;
    const [record] = initialDemo.seasons;
    const seasons = [
      { ...record, year: 2024, planting_date: null },
      { ...record, year: 2025, planting_date: "2025-05-10" },
      { ...record, year: 2026 },
      { ...record, year: 2025, field_id: "unrelated" },
    ];
    const result = fieldContextInsights(
      field,
      seasons,
      initialDemo.crops,
      period,
      false,
    );
    expect(result[0].observation).toContain("га");
    expect(result[1].observation).toContain("Poaceae");
    expect(result[1].period).toContain("2024–2025");
    expect(
      fieldContextInsights(
        field,
        seasons,
        initialDemo.crops,
        { ...period, end: "2025-05-09" },
        false,
      )[1].confidence,
    ).toBe("Недостаточно данных");
  });
});
