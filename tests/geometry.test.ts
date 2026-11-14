import { describe, it, expect } from "vitest";
import {
  validateBoundary,
  polygonFromCoordinates,
  coordinatesFromPolygon,
  readFieldGeoJSON,
} from "../src/lib/field-boundary";
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

describe("coordinate and GeoJSON entry", () => {
  const rows = [
    { latitude: "43.2389", longitude: "76,8897" },
    { latitude: "43.2389", longitude: "76.8997" },
    { latitude: "43.2489", longitude: "76.8997" },
    { latitude: "43.2489", longitude: "76.8897" },
  ];

  it("orders longitude before latitude and closes the polygon", () => {
    const { geometry } = polygonFromCoordinates(rows);
    expect(geometry).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [76.8897, 43.2389],
          [76.8997, 43.2389],
          [76.8997, 43.2489],
          [76.8897, 43.2489],
          [76.8897, 43.2389],
        ],
      ],
    });
    expect(polygonFromCoordinates([...rows, rows[0]]).geometry).toEqual(
      geometry,
    );
    expect(
      polygonFromCoordinates(coordinatesFromPolygon(geometry)).geometry,
    ).toEqual(geometry);
  });

  it.each([
    { latitude: "91", longitude: "76" },
    { latitude: "43", longitude: "181" },
    { latitude: "", longitude: "76" },
    { latitude: "43°", longitude: "76" },
  ])("rejects invalid coordinates %j", (row) => {
    expect(() => polygonFromCoordinates([row, ...rows.slice(1)])).toThrow(
      /Точка 1/,
    );
  });

  it("requires three distinct points", () => {
    expect(() => polygonFromCoordinates([rows[0], rows[1], rows[0]])).toThrow(
      /три разные точки/,
    );
  });

  it("rejects a crossing and computes the preview hectares for the valid order", () => {
    expect(() =>
      polygonFromCoordinates([rows[0], rows[2], rows[1], rows[3]]),
    ).toThrow(/пересекает себя/);
    const { geometry, hectares } = polygonFromCoordinates(rows);
    expect(hectares).toBeGreaterThan(89);
    expect(hectares).toBeLessThan(91);
    expect(hectares).toBe(validateBoundary(geometry));
  });

  it("imports a single polygon wrapped in a GeoJSON feature or collection", () => {
    const preview = polygonFromCoordinates(rows);
    const feature = {
      type: "Feature",
      geometry: preview.geometry,
      properties: { name: "Test" },
    };
    expect(readFieldGeoJSON(JSON.stringify(feature))).toEqual(preview);
    expect(
      readFieldGeoJSON(
        JSON.stringify({ type: "FeatureCollection", features: [feature] }),
      ),
    ).toEqual(preview);
    expect(() =>
      readFieldGeoJSON(
        JSON.stringify({
          type: "FeatureCollection",
          features: [feature, feature],
        }),
      ),
    ).toThrow(/одного поля/);
    expect(() =>
      readFieldGeoJSON('{"type":"Polygon","coordinates":[null]}'),
    ).toThrow(/координаты/);
  });
});
