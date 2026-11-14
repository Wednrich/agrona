import { normalizePower } from "./power.ts";

export const powerParameters = {
  T2M: ["temperature_mean", "°C"],
  T2M_MAX: ["temperature_max", "°C"],
  T2M_MIN: ["temperature_min", "°C"],
  PRECTOTCORR: ["precipitation_mm", "mm/day"],
  RH2M: ["humidity", "%"],
  ALLSKY_SFC_SW_DWN: ["solar_radiation", "MJ/m²/day"],
  WS2M: ["wind_speed", "m/s"],
} as const;
export const provider = "NASA POWER";
export const dataset = "daily-ag-v2";

export function spatialResolution(parameter: string) {
  return parameter === "ALLSKY_SFC_SW_DWN" ? "1° × 1°" : "0.5° × 0.625°";
}

export async function fetchPower(
  year: number,
  longitude: number,
  latitude: number,
) {
  const url = new URL("https://power.larc.nasa.gov/api/temporal/daily/point");
  url.search = new URLSearchParams({
    parameters: Object.keys(powerParameters).join(","),
    community: "AG",
    longitude: longitude.toFixed(6),
    latitude: latitude.toFixed(6),
    start: `${year}0101`,
    end: `${year}1231`,
    format: "JSON",
  }).toString();
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      continue;
    }
    if (response.ok) {
      const raw = await response.json();
      const observations = normalizePower(raw, true).filter((row) =>
        row.observation_date.startsWith(`${year}-`),
      );
      if (
        !observations.some((row) =>
          Object.values(powerParameters).some(([key]) => row[key] != null),
        )
      )
        throw new Error("NASA POWER не вернул наблюдения за этот год.");
      return { observations, sourceUrl: url.toString(), upstream: raw.header };
    }
    if (attempt === 2 || (response.status !== 429 && response.status < 500))
      throw new Error(`NASA POWER вернул ошибку HTTP ${response.status}.`);
    const seconds = Number(response.headers.get("Retry-After"));
    if (seconds > 10)
      throw new Error("NASA POWER временно ограничил число запросов.");
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(seconds * 1000, 1000 * 2 ** attempt)),
    );
  }
  throw new Error("NASA POWER недоступен.");
}
