export type TerrainPolygon = { type: "Polygon"; coordinates: number[][][] };
type Bounds = { west: number; south: number; east: number; north: number };
export const srtmProduct = "SRTMGL1.003";
export const srtmDataset = srtmProduct + "/pixel-centres-v1";
export const srtmPeriod = 2000;
const cell = 1 / 3600;
const maxCells = 12_000;
const maxVertices = 1000;

export async function srtmRevision(polygon: TerrainPolygon) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(polygon.coordinates)),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function srtmWindow(polygon: TerrainPolygon) {
  const points = polygon.coordinates.flat();
  const x = points.map(([lon]) => lon);
  const y = points.map(([, lat]) => lat);
  const bounds = {
    west: Math.min(...x),
    east: Math.max(...x),
    south: Math.min(...y),
    north: Math.max(...y),
  };
  const padded = {
    west: bounds.west - 2 * cell,
    east: bounds.east + 2 * cell,
    south: Math.max(-56, bounds.south - 2 * cell),
    north: Math.min(60, bounds.north + 2 * cell),
  };
  if (
    bounds.east - bounds.west >= 180 ||
    padded.west < -180 ||
    padded.east > 180
  )
    return {
      reason:
        "Граница у линии перемены дат. Этот случай пока не поддерживается.",
    } as const;
  if (bounds.south < -56 || bounds.north > 60)
    return {
      reason: "Поле выходит за пределы покрытия SRTM (56° ю. ш. – 60° с. ш.).",
    } as const;
  const columns = Math.ceil((padded.east - padded.west) / cell) + 2;
  const rows = Math.ceil((padded.north - padded.south) / cell) + 2;
  if (columns * rows > maxCells || points.length > maxVertices)
    return {
      reason:
        "Окно поля превышает 12 000 ячеек SRTM или граница содержит более 1 000 вершин. Лимит применён к прямоугольному окну, включая запас для уклона.",
    } as const;
  return { bounds, padded } as const;
}

type Grid = {
  width: number;
  height: number;
  westCenter: number;
  southCenter: number;
  step: number;
  missing: number;
  values: Float64Array;
};

function readGrid(body: string): Grid {
  const header = new Map<string, number>();
  const lines = body.trim().split(/\r?\n/);
  let i = 0;
  for (; i < lines.length; i++) {
    const [key, value] = lines[i].trim().split(/\s+/);
    if (
      !/^(ncols|nrows|[xy]ll(?:corner|center)|cellsize|nodata_value)$/i.test(
        key,
      )
    )
      break;
    header.set(key.toLowerCase(), Number(value));
  }
  const get = (key: string) => header.get(key) ?? NaN;
  const width = get("ncols"),
    height = get("nrows"),
    step = get("cellsize");
  const westCenter = header.get("xllcenter") ?? get("xllcorner") + step / 2;
  const southCenter = header.get("yllcenter") ?? get("yllcorner") + step / 2;
  const missing = header.get("nodata_value") ?? -9999;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > maxCells ||
    Math.abs(step - cell) > 1e-8 ||
    ![step, westCenter, southCenter, missing].every(Number.isFinite)
  )
    throw new Error("Некорректная сетка SRTM от поставщика.");
  const tokens = lines.slice(i).join(" ").trim().split(/\s+/);
  if (tokens.length !== width * height)
    throw new Error("Растр SRTM получен не полностью.");
  const values = Float64Array.from(tokens, Number);
  if (!values.every(Number.isFinite))
    throw new Error("Некорректные значения растра SRTM.");
  return { width, height, westCenter, southCenter, step, missing, values };
}

function insideRing(x: number, y: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j],
      [bx, by] = ring[i];
    if (ax === bx && ay === by) continue;
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (
      Math.abs(cross) < 1e-14 &&
      x >= Math.min(ax, bx) &&
      x <= Math.max(ax, bx) &&
      y >= Math.min(ay, by) &&
      y <= Math.max(ay, by)
    )
      return true;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  return inside;
}

export type TerrainRange = { min: number; max: number; mean: number };
export type TerrainMetrics = {
  cells: number;
  elevationCells: number;
  slopeCells: number;
  elevation: TerrainRange | null;
  slope: TerrainRange | null;
};
function summarize(values: number[]): TerrainRange | null {
  return values.length
    ? {
        min: Math.min(...values),
        max: Math.max(...values),
        mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      }
    : null;
}

export function terrainFromAscii(
  body: string,
  polygon: TerrainPolygon,
  bounds: Bounds,
): TerrainMetrics {
  const grid = readGrid(body);
  const { width, height, westCenter, southCenter, step } = grid;
  const northCenter = southCenter + (height - 1) * step;
  // A cropped response may omit outer NoData margins. Count expected pixel centres
  // on the returned lattice even when their cells fall outside the returned array.
  const x0 = Math.ceil((bounds.west - westCenter) / step - 1e-7);
  const x1 = Math.floor((bounds.east - westCenter) / step + 1e-7);
  const y0 = Math.ceil((northCenter - bounds.north) / step - 1e-7);
  const y1 = Math.floor((northCenter - bounds.south) / step + 1e-7);
  if (
    grid.westCenter - step / 2 > bounds.east ||
    grid.westCenter + (width - 0.5) * step < bounds.west ||
    grid.southCenter - step / 2 > bounds.north ||
    northCenter + step / 2 < bounds.south
  )
    throw new Error("Сетка SRTM не пересекает запрошенное поле.");
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > maxCells)
    throw new Error("Возвращённая сетка SRTM превышает лимит.");
  const valueAt = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return null;
    const value = grid.values[y * width + x];
    return value === grid.missing || value === -32768 ? null : value;
  };
  const [shell, ...holes] = polygon.coordinates;
  const elevations: number[] = [],
    slopes: number[] = [];
  let cells = 0;
  const radians = (step * Math.PI) / 180;
  for (let y = y0; y <= y1; y++) {
    const lat = northCenter - y * step;
    const phi = (lat * Math.PI) / 180;
    const q = 1 - 0.00669437999014 * Math.sin(phi) ** 2;
    const dx = ((6378137 * Math.cos(phi)) / Math.sqrt(q)) * radians;
    const dy = ((6378137 * (1 - 0.00669437999014)) / q ** 1.5) * radians;
    for (let x = x0; x <= x1; x++) {
      const lon = westCenter + x * step;
      if (
        !insideRing(lon, lat, shell) ||
        holes.some((ring) => insideRing(lon, lat, ring))
      )
        continue;
      cells++;
      const z = valueAt(x, y);
      if (z === null) continue;
      elevations.push(z);
      const west = valueAt(x - 1, y),
        east = valueAt(x + 1, y);
      const north = valueAt(x, y - 1),
        south = valueAt(x, y + 1);
      if (west === null || east === null || north === null || south === null)
        continue;
      slopes.push(
        (Math.atan(
          Math.hypot((east - west) / (2 * dx), (north - south) / (2 * dy)),
        ) *
          180) /
          Math.PI,
      );
    }
  }
  return {
    cells,
    elevationCells: elevations.length,
    slopeCells: slopes.length,
    elevation: summarize(elevations),
    slope: summarize(slopes),
  };
}

export type TerrainResult = {
  status: "ready" | "insufficient" | "unsupported" | "loading" | "error";
  message?: string;
  metrics?: TerrainMetrics;
  cached?: boolean;
};

export function classifyTerrain(metrics: TerrainMetrics): TerrainResult {
  if (metrics.elevationCells < 4 || metrics.slopeCells < 4)
    return {
      status: "insufficient",
      metrics,
      message:
        "Для оценки нужны хотя бы четыре пригодные ячейки высоты и четыре ячейки уклона. Поле может быть слишком маленьким или содержать пропуски.",
    };
  if (
    metrics.elevationCells / metrics.cells < 0.8 ||
    metrics.slopeCells / metrics.cells < 0.8
  )
    return {
      status: "insufficient",
      metrics,
      message:
        "Покрытие высоты или уклона ниже 80%. Доступные значения описывают только пригодную часть поля.",
    };
  return { status: "ready", metrics };
}
