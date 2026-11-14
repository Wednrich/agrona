import { area, kinks, polygon } from "@turf/turf";
import type { Polygon } from "geojson";

export function validateBoundary(boundary: unknown) {
  if (
    !boundary ||
    typeof boundary !== "object" ||
    !("type" in boundary) ||
    !("coordinates" in boundary) ||
    boundary.type !== "Polygon" ||
    !Array.isArray(boundary.coordinates) ||
    boundary.coordinates.length !== 1
  )
    throw new Error("Нужен полигон без внутренних колец.");
  const ring = boundary.coordinates[0];
  if (
    !Array.isArray(ring) ||
    ring.length === 0 ||
    ring.length > 10000 ||
    ring.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        !p.every(Number.isFinite) ||
        Math.abs(p[0]) > 180 ||
        Math.abs(p[1]) > 90,
    ) ||
    JSON.stringify(ring[0]) !== JSON.stringify(ring[ring.length - 1])
  )
    throw new Error("Некорректные координаты или незамкнутая граница.");
  const vertices = ring.slice(0, -1);
  const distinct = new Set(vertices.map((point) => point.join(","))).size;
  if (distinct < 3) throw new Error("Нужны хотя бы три разные точки.");
  if (distinct !== vertices.length)
    throw new Error("Удалите повторяющиеся точки контура.");
  const p = polygon(boundary.coordinates);
  if (kinks(p).features.length)
    throw new Error("Граница пересекает себя. Измените порядок точек.");
  const squareMeters = area(p);
  if (squareMeters < 1) throw new Error("Площадь поля слишком мала.");
  return squareMeters / 10000;
}

export type CoordinateRow = { latitude: string; longitude: string };
export type BoundaryPreview = { geometry: Polygon; hectares: number };
export const emptyCoordinate = (): CoordinateRow => ({
  latitude: "",
  longitude: "",
});

export function polygonFromCoordinates(rows: CoordinateRow[]): BoundaryPreview {
  if (rows.length < 3) throw new Error("Добавьте хотя бы три разные точки.");
  const ring = rows.map(({ latitude, longitude }, index) => [
    decimalCoordinate(longitude, 180, "долгота", index),
    decimalCoordinate(latitude, 90, "широта", index),
  ]);
  if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) {
    ring.push([...ring[0]]);
  }
  return previewBoundary({ type: "Polygon", coordinates: [ring] });
}

function decimalCoordinate(
  raw: string,
  limit: number,
  label: string,
  index: number,
) {
  const decimal = raw.trim().replace(",", ".");
  const value = Number(decimal);
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(decimal) ||
    Math.abs(value) > limit
  ) {
    throw new Error(
      `Точка ${index + 1}: ${label} должна быть числом от −${limit} до ${limit}.`,
    );
  }
  return value;
}

export function coordinatesFromPolygon(geometry?: Polygon): CoordinateRow[] {
  return geometry
    ? geometry.coordinates[0].slice(0, -1).map(([longitude, latitude]) => ({
        latitude: String(latitude),
        longitude: String(longitude),
      }))
    : Array.from({ length: 3 }, emptyCoordinate);
}

export function previewBoundary(value: unknown): BoundaryPreview {
  const hectares = validateBoundary(value);
  // Use the same geometry shape for all inputs and for the analysis cache key.
  return {
    geometry: { type: "Polygon", coordinates: (value as Polygon).coordinates },
    hectares,
  };
}

export function readFieldGeoJSON(text: string): BoundaryPreview {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(
      "Не удалось прочитать GeoJSON. Проверьте формат файла или текста.",
    );
  }
  if (value && typeof value === "object" && "type" in value) {
    if (value.type === "FeatureCollection") {
      if (
        !("features" in value) ||
        !Array.isArray(value.features) ||
        value.features.length !== 1
      ) {
        throw new Error("GeoJSON должен содержать границу одного поля.");
      }
      value = value.features[0];
    }
    if (
      value &&
      typeof value === "object" &&
      "type" in value &&
      value.type === "Feature"
    ) {
      value = "geometry" in value ? value.geometry : null;
    }
  }
  return previewBoundary(value);
}
