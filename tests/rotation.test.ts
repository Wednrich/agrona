import { describe, it, expect } from "vitest";
import { generateRotations, type Constraints } from "../src/features/rotation";
import {
  matchesRotationGeometry,
  summarizeRotationClimate,
} from "../src/features/rotation-climate";
import { rotationClimateKey } from "../src/lib/field-write";
import { crops, initialDemo } from "../src/lib/demo";
import type { Observation, Season } from "../src/lib/types";

const constraints: Constraints = {
  allowed: crops.map((c) => c.id),
  excluded: [],
  horizon: 3,
  irrigation: false,
  maxSeasonDays: 150,
};
const startYear = new Date().getUTCFullYear() + 1;
const season = (year: number, crop: number): Season => ({
  ...initialDemo.seasons[0],
  year,
  crop_id: crops[crop].id,
});
const period = { year: 2025, start: "2025-05-01", end: "2025-09-30" };
const run = (
  overrides: Partial<Constraints> = {},
  history: Season[] = [],
  priorities: string[] = [],
  observations: Observation[] = [],
) =>
  generateRotations(
    crops,
    history,
    "test",
    priorities,
    { ...constraints, ...overrides },
    observations,
  );

describe("rotation engine", () => {
  it("keeps a fixed crop in every alternative and rejects contradictory exclusions", () => {
    const crop = crops.find((c) => c.growing_season_days <= 150)!;
    const options = { fixedCrops: { 1: crop.id } };
    expect(run(options).every((s) => s.crop_sequence[1] === crop.id)).toBe(
      true,
    );
    expect(() => run({ ...options, excluded: [crop.id] })).toThrow(
      "Закреплённая культура",
    );
  });
  it("produces three deterministic and distinct strategies and uses a selected plan", () => {
    const currentSequence = [crops[3].id, crops[0].id, crops[3].id];
    const result = run({ currentSequence });
    expect(result).toEqual(run({ currentSequence }));
    expect(new Set(result.map((item) => item.crop_sequence.join())).size).toBe(
      3,
    );
    expect(result[0].crop_sequence).toEqual(currentSequence);
    expect(result[0].name).toContain("Текущий план");
    expect(run()[0].analysis_result.reasons.join()).toContain(
      "Текущий план неизвестен",
    );
  });

  it("uses earlier history as well as the latest crop and penalizes same crops more than families", () => {
    const currentSequence = Array(3).fill(crops[0].id);
    const latest = season(startYear - 1, 2);
    const getSoil = (history: Season[]) =>
      run({ currentSequence }, history)[0].analysis_result.criteria!.soil;
    expect(
      getSoil([latest, season(startYear - 2, 0), season(startYear - 3, 0)]),
    ).toBeLessThan(getSoil([latest, season(startYear - 2, 1)]));
    expect(getSoil([latest, season(startYear - 2, 1)])).toBeLessThan(
      getSoil([latest]),
    );
    expect(
      run({ currentSequence }, [latest])[0].analysis_result.risks?.join(),
    ).toContain("семейства — 2");
    expect(
      run({ currentSequence }, [latest])[0].analysis_result.warnings.join(),
    ).toContain("История неполная");
  });

  it("uses real predecessors without filling gaps and credits legumes", () => {
    const currentSequence = [crops[0].id, crops[3].id, crops[0].id];
    const recentLegume = run({ currentSequence }, [
      season(startYear - 1, 2),
    ])[0];
    const oldLegume = run({ currentSequence }, [season(startYear - 2, 2)])[0];
    expect(recentLegume.analysis_result.criteria!.soil).toBeGreaterThan(
      oldLegume.analysis_result.criteria!.soil,
    );
  });

  it("enforces crop exclusions and season length for alternatives even when the baseline fails", () => {
    const result = run({
      excluded: [crops[0].id],
      maxSeasonDays: 105,
      currentSequence: Array(3).fill(crops[0].id),
    });
    expect(result[0].analysis_result.risks?.join()).toContain("не подходит");
    for (const strategy of result.slice(1)) {
      expect(
        strategy.crop_sequence.every((id) =>
          [crops[1].id, crops[2].id].includes(id),
        ),
      ).toBe(true);
    }
  });

  it("returns fewer plans when alternatives cannot be distinct", () => {
    expect(run({ allowed: [] })).toEqual([]);
    const result = run({ allowed: [crops[0].id] });
    expect(result).toHaveLength(1);
    expect(result[0].analysis_result.warnings[0]).toContain("Ограничения");
  });

  it("changes comparison weights with farmer priorities and exposes missing inputs", () => {
    const currentSequence = Array(3).fill(crops[0].id);
    const unw = run({ period, currentSequence })[0].analysis_result;
    const water = run({ period, currentSequence }, [], ["water", "economy"])[0]
      .analysis_result;
    expect(water.score).toBeLessThan(unw.score);
    expect(water.criteria?.climate).toBeNull();
    expect(water.warnings.join()).toContain(
      "Климатические наблюдения не загружены",
    );
    expect(water.warnings.join()).toContain(
      "экономическая жизнеспособность не оценена",
    );
  });

  it("offers a soil alternative when climate prioritization has no usable observations", () => {
    const result = run({ period }, [], ["climate"]);
    expect(result[2].name).toContain("здоровье почвы");
    expect(result[2].analysis_result.warnings.join()).toContain(
      "недостаточно для отдельной климатической альтернативы",
    );
  });

  it("handles a larger catalog and 20-year horizon", () => {
    const catalog = Array.from({ length: 60 }, (_, i) => ({
      ...crops[i % crops.length],
      id: `crop-${i}`,
    }));
    const result = generateRotations(
      catalog,
      [],
      "test",
      ["water", "climate"],
      {
        ...constraints,
        allowed: catalog.map((c) => c.id),
        horizon: 20,
      },
    );
    expect(result).toHaveLength(3);
    expect(
      result.every(({ crop_sequence }) => crop_sequence.length === 20),
    ).toBe(true);
  }, 3000);
});

describe("rotation climate", () => {
  const day = (
    date: string,
    low = 6,
    rain = 0,
    high = 25,
    mean = 15,
  ): Observation => ({
    observation_date: date,
    precipitation_mm: rain,
    temperature_max: high,
    temperature_min: low,
    temperature_mean: mean,
    solar_radiation: null,
  });
  it("filters dates, keeps missing days and splits dry sequences on gaps", () => {
    const summary = summarizeRotationClimate(
      [
        day("2025-04-30", -2, 100),
        day("2025-05-01", -2),
        day("2025-05-02", 6),
        day("2025-05-04", 6, 0, 39),
        day("2024-05-02", -3, 100),
      ],
      period,
    );
    expect(summary).toMatchObject({
      rain: 0,
      longestDry: 2,
      frostDays: 1,
      hotDays: 1,
      frostFree: null,
      coverage: { mean: 3, min: 3, max: 3, rain: 3 },
    });
  });

  it("applies climate screening from a complete series and never treats irrigation as sufficient water", () => {
    const observations = Array.from({ length: 153 }, (_, i) =>
      day(
        new Date(Date.UTC(2025, 4, i + 1)).toISOString().slice(0, 10),
        i === 75 ? -2 : 5,
        0,
        37,
        9,
      ),
    );
    const currentSequence = Array(3).fill(crops[2].id);
    const baseline = run({ period, currentSequence }, [], [], observations)[0]
      .analysis_result;
    expect(baseline.criteria!.climate).toBeLessThan(-4);
    expect(baseline.risks?.join()).toContain("без заморозков");
    expect(baseline.risks?.join()).toContain("сухой отрезок");
    expect(baseline.risks?.join()).toContain("35 °C");
    const irrigated = run(
      { period, currentSequence, irrigation: true, soilType: "Песчаная почва" },
      [],
      [],
      observations,
    )[0].analysis_result;
    expect(irrigated.risks?.join()).toContain("супесчаной");
    expect(irrigated.sources?.join()).toContain(
      "Объём и график подачи неизвестны",
    );
  });

  it("isolates the cache by boundary and year and rejects stale source metadata", () => {
    const field = initialDemo.fields[0];
    const updated = structuredClone(field);
    updated.boundary.coordinates[0][1][0] += 0.01;
    expect([...rotationClimateKey("user", field), 2025]).not.toEqual([
      ...rotationClimateKey("user", updated),
      2025,
    ]);
    expect([...rotationClimateKey("user", field), 2025]).not.toEqual([
      ...rotationClimateKey("user", field),
      2024,
    ]);
    expect(
      matchesRotationGeometry(
        JSON.stringify(field.boundary),
        JSON.stringify(updated.boundary),
        "new",
      ),
    ).toBe(false);
    expect(
      matchesRotationGeometry("old", JSON.stringify(updated.boundary), "new"),
    ).toBe(false);
    expect(
      matchesRotationGeometry("new", JSON.stringify(updated.boundary), "new"),
    ).toBe(true);
  });
});

it("shows exactly one distinct alternative when only one sequence is allowed beside the farmer plan", () => {
  const result = run({
    allowed: [crops[0].id],
    currentSequence: Array(3).fill(crops[1].id),
  });
  expect(result).toHaveLength(2);
  expect(result[0].crop_sequence).toEqual(Array(3).fill(crops[1].id));
  expect(result[1].crop_sequence).toEqual(Array(3).fill(crops[0].id));
});
