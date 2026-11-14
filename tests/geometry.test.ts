import { describe, it, expect } from "vitest";
import { validateBoundary } from "../src/lib/data";
describe("field geometry", () => {
  it("computes hectares", () =>
    expect(
      validateBoundary({
        type: "Polygon",
        coordinates: [
          [
            [69, 51],
            [69.01, 51],
            [69.01, 51.01],
            [69, 51.01],
            [69, 51],
          ],
        ],
      }),
    ).toBeGreaterThan(70));
  it("rejects self intersections", () =>
    expect(() =>
      validateBoundary({
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 1],
            [0, 1],
            [1, 0],
            [0, 0],
          ],
        ],
      }),
    ).toThrow());
  it("rejects unclosed coordinates", () =>
    expect(() =>
      validateBoundary({
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ],
      }),
    ).toThrow());
  it("rejects impossible longitude", () =>
    expect(() =>
      validateBoundary({
        type: "Polygon",
        coordinates: [
          [
            [200, 0],
            [201, 0],
            [201, 1],
            [200, 0],
          ],
        ],
      }),
    ).toThrow());
});
