import { describe, expect, it, vi } from "vitest";
import {
  classifyTerrain,
  srtmRevision,
  srtmWindow,
  terrainFromAscii,
  type TerrainPolygon,
} from "../supabase/functions/_shared/srtm";
import { fetchSrtmGrid } from "../supabase/functions/_shared/srtm-provider";

const step = 1 / 3600;
function rectangle(
  west: number,
  south: number,
  east: number,
  north: number,
): TerrainPolygon {
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}
const field = rectangle(
  69 - step / 2,
  51 - step / 2,
  69 + 2.5 * step,
  51 + 2.5 * step,
);
const grid = (value: (x: number, y: number) => number, width = 5) =>
  [
    `ncols ${width}`,
    "nrows 5",
    `xllcenter ${69 - step}`,
    `yllcenter ${51 - step}`,
    `cellsize ${step}`,
    "NODATA_value -9999",
    ...Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: width }, (_, x) => value(x, y)).join(" "),
    ),
  ].join("\n");
function calculate(body: string) {
  const window = srtmWindow(field);
  if (!window.bounds) throw new Error(window.reason);
  return terrainFromAscii(body, field, window.bounds);
}

describe("SRTM raster", () => {
  it("calculates height and zero slope on flat terrain across an integer degree", () => {
    const metrics = calculate(grid(() => 125));
    expect(metrics).toEqual({
      cells: 9,
      elevationCells: 9,
      slopeCells: 9,
      elevation: { min: 125, max: 125, mean: 125 },
      slope: { min: 0, max: 0, mean: 0 },
    });
    expect(classifyTerrain(metrics).status).toBe("ready");
  });

  it("computes slope in degrees using east-west distance at field latitude", () => {
    const metrics = calculate(grid((x) => 100 + x * 10));
    expect(metrics.elevation).toEqual({ min: 110, max: 130, mean: 120 });
    expect(metrics.slope?.mean).toBeCloseTo(27.18, 1);
    expect(metrics.slope?.max).toBeGreaterThanOrEqual(metrics.slope!.mean);
  });

  it("excludes NoData from height and from the slope stencil", () => {
    const metrics = calculate(
      grid((x, y) => (x === 2 && y === 2 ? -9999 : 100)),
    );
    expect(metrics.elevationCells).toBe(8);
    expect(metrics.slopeCells).toBe(4);
    expect(classifyTerrain(metrics).status).toBe("insufficient");
    expect(calculate(grid(() => -32768)).elevation).toBeNull();
  });

  it("counts missing field cells when the response is spatially clipped", () => {
    const metrics = calculate(grid(() => 100, 3));
    expect(metrics.cells).toBe(9);
    expect(metrics.elevationCells).toBe(6);
    expect(metrics.slopeCells).toBe(3);
    expect(classifyTerrain(metrics).status).toBe("insufficient");
    expect(() => calculate("ncols 1\nnrows 1\n")).toThrow();
  });

  it("keys the result to the geometry and rejects oversized or unsupported fields", async () => {
    const revised = rectangle(69, 51, 69.001, 51.001);
    expect(await srtmRevision(structuredClone(field))).toBe(
      await srtmRevision(field),
    );
    expect(await srtmRevision(revised)).not.toBe(await srtmRevision(field));
    expect(srtmWindow(rectangle(58, 50, 59, 51)).reason).toContain("12 000");
    expect(srtmWindow(rectangle(58, 62, 58.001, 62.001)).reason).toContain(
      "покрытия",
    );
  });
});

describe("OpenTopography adapter", () => {
  const bounds = { west: 69, south: 51, east: 69.01, north: 51.01 };
  it("requests the documented DEM raster once", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("grid"));
    expect(await fetchSrtmGrid(bounds, "server-key", request)).toEqual({
      text: "grid",
    });
    expect(request).toHaveBeenCalledTimes(1);
    const url = new URL(String(request.mock.calls[0][0]));
    expect(url.searchParams.get("demtype")).toBe("SRTMGL1");
    expect(url.searchParams.get("outputFormat")).toBe("AAIGrid");
  });

  it("handles quota errors and timeouts without returning the key or provider body", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("server-key", { status: 429 }));
    expect(await fetchSrtmGrid(bounds, "server-key", request)).toEqual({
      error: expect.stringContaining("Лимит"),
    });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockRejectedValue(new Error("server-key"));
    expect(await fetchSrtmGrid(bounds, "server-key", request)).toEqual({
      error: expect.stringContaining("время ожидания"),
    });
  });

  it("rejects oversized responses", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("x".repeat(524289)));
    expect(await fetchSrtmGrid(bounds, "server-key", request)).toEqual({
      error: expect.stringContaining("превышает лимит"),
    });
  });
});
