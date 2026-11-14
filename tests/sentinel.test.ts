import { describe, expect, it } from "vitest";
import {
  evaluation,
  overlayEvaluation,
  parseSentinelStatistics,
} from "../supabase/functions/_shared/sentinel";

function pixel(script: string) {
  return new Function(script + "\nreturn evaluatePixel;")() as (sample: {
    B04: number;
    B08: number;
    SCL: number;
    dataMask: number;
  }) => unknown;
}
const valid = { B04: 0.1, B08: 0.3, SCL: 4, dataMask: 1 };

describe("Sentinel Hub evaluation", () => {
  it("derives NDVI from reflectance and clips invalid pixels for both products", () => {
    const stats = pixel(evaluation);
    const preview = pixel(overlayEvaluation);
    expect(stats(valid)).toEqual({
      ndvi: [expect.closeTo(0.5)],
      dataMask: [1],
    });
    for (const sample of [
      ...[0, 1, 2, 3, 7, 8, 9, 10, 11].map((SCL) => ({ ...valid, SCL })),
      { ...valid, dataMask: 0 },
      { ...valid, B04: 0, B08: 0 },
    ]) {
      expect(stats(sample)).toEqual({ ndvi: [0], dataMask: [0] });
      expect(preview(sample)).toEqual([0, 0, 0, 0]);
    }
  });

  it("uses polygon coverage rather than the bounding-box area", () => {
    const observed = {
      interval: { from: "2025-06-01T00:00:00Z" },
      outputs: {
        ndvi: {
          bands: {
            B0: {
              stats: {
                sampleCount: 100,
                noDataCount: 80,
                min: 0.1,
                mean: 0.3,
                max: 0.6,
              },
            },
          },
        },
      },
    };
    const empty = {
      interval: { from: "2025-06-02T00:00:00Z" },
      outputs: {
        ndvi: {
          bands: {
            B0: {
              stats: {
                sampleCount: 100,
                noDataCount: 100,
                min: null,
                mean: null,
                max: null,
              },
            },
          },
        },
      },
    };
    expect(
      parseSentinelStatistics(
        { status: "OK", geometryPixelCount: 40, data: [observed, empty] },
        2025,
      ),
    ).toEqual([
      {
        date: "2025-06-01",
        validPixels: 20,
        fieldPixels: 40,
        min: 0.1,
        mean: 0.3,
        max: 0.6,
      },
      {
        date: "2025-06-02",
        validPixels: 0,
        fieldPixels: 40,
        min: null,
        mean: null,
        max: null,
      },
    ]);
    expect(
      parseSentinelStatistics({ status: "OK", data: [observed] }, 2025)[0]
        .fieldPixels,
    ).toBeNull();
    expect(() =>
      parseSentinelStatistics({ status: "PARTIAL", data: [observed] }, 2025),
    ).toThrow();
  });
});
