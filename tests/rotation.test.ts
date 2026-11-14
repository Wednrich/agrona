import { describe, it, expect } from "vitest";
import { generateRotations } from "../src/features/rotation";
import { crops, initialDemo } from "../src/lib/demo";
const constraints = {
  allowed: crops.map((c) => c.id),
  excluded: [],
  horizon: 3,
  irrigation: false,
  maxSeasonDays: 150,
};
describe("rotation engine", () => {
  it("produces three deterministic strategies", () => {
    const run = () =>
      generateRotations(
        crops,
        initialDemo.seasons,
        "test",
        ["soil"],
        constraints,
      );
    expect(run()).toEqual(run());
    expect(run()).toHaveLength(3);
  });
  it("enforces exclusions on alternatives", () => {
    const result = generateRotations(crops, [], "test", [], {
      ...constraints,
      excluded: [crops[0].id],
    });
    for (const s of result.slice(1))
      expect(s.crop_sequence).not.toContain(crops[0].id);
  });
  it("does not invent alternatives when only one exists", () => {
    const result = generateRotations(crops, [], "test", [], {
      ...constraints,
      allowed: [crops[0].id],
    });
    expect(result[2].analysis_result.warnings[0]).toContain("совпадает");
  });
  it("rejects incompatible constraints", () =>
    expect(() =>
      generateRotations(crops, [], "test", [], {
        ...constraints,
        maxSeasonDays: 1,
      }),
    ).toThrow());
  it("exposes missing climate and economics", () => {
    const result = generateRotations(
      crops,
      [],
      "test",
      ["economy"],
      constraints,
    );
    expect(result[0].analysis_result.warnings.join()).toContain(
      "Климатические наблюдения не загружены",
    );
    expect(result[0].analysis_result.warnings.join()).toContain(
      "экономическая жизнеспособность не оценена",
    );
  });
});
