export const sentinelProvider = "Copernicus Sentinel Hub";
export const sentinelDataset = "sentinel-2-l2a-ndvi-v1";
export const earliestSentinelYear = 2017;
const sceneEvaluation = `//VERSION=3
function setup() {
  return {
    input: [{bands: ["B04", "B08", "SCL", "dataMask"],
             units: ["REFLECTANCE", "REFLECTANCE", "DN", "DN"]}],
    output: OUTPUT,
    mosaicking: "SIMPLE"
  };
}
function evaluatePixel(s) {
  // Only vegetation, bare ground and water. Includes no cloud/shadow/snow classes.
  const sum = s.B08 + s.B04;
  const valid = s.dataMask === 1 && [4, 5, 6].includes(s.SCL) &&
    Number.isFinite(sum) && s.B04 >= 0 && s.B08 >= 0 && sum > 0;
  const ndvi = valid ? (s.B08 - s.B04) / sum : 0;
  RESULT
}`;

export const evaluation = sceneEvaluation
  .replace(
    "OUTPUT",
    '[{id: "ndvi", bands: 1, sampleType: "FLOAT32"}, {id: "dataMask", bands: 1}]',
  )
  .replace("RESULT", "return {ndvi: [ndvi], dataMask: [valid ? 1 : 0]};");

export const overlayEvaluation = sceneEvaluation
  .replace("OUTPUT", '{bands: 4, sampleType: "UINT8"}')
  .replace(
    "RESULT",
    "if (!valid) return [0, 0, 0, 0]; const t = (ndvi + 1) / 2; return [Math.round(220 * (1 - t)), Math.round(100 + 135 * t), 38, 220];",
  );

export type VegetationDay = {
  date: string;
  mean: number | null;
  min: number | null;
  max: number | null;
  validPixels: number;
  fieldPixels: number | null;
};

export function parseSentinelStatistics(
  input: unknown,
  year: number,
): VegetationDay[] {
  const response = input as {
    status?: string;
    geometryPixelCount?: number;
    data?: Array<{
      interval?: { from?: string };
      error?: unknown;
      outputs?: {
        ndvi?: {
          bands?: {
            B0?: {
              stats?: {
                sampleCount: number;
                noDataCount: number;
                mean: number;
                min: number;
                max: number;
              };
            };
          };
        };
      };
    }>;
  };
  if (response?.status !== "OK" || !Array.isArray(response.data))
    throw new Error(
      "Copernicus вернул неполный ответ. Повторите запрос позже.",
    );

  const fieldPixels = response.geometryPixelCount;
  const dates = new Set<string>();
  return response.data
    .map((interval) => {
      const date = interval.interval?.from?.slice(0, 10);
      const stats = interval.outputs?.ndvi?.bands?.B0?.stats;
      if (
        !date ||
        !date.startsWith(`${year}-`) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        dates.has(date) ||
        interval.error ||
        !stats
      )
        throw new Error("Некорректный интервал в ответе Copernicus.");
      dates.add(date);
      const { sampleCount, noDataCount, mean, min, max } = stats;
      const validPixels = sampleCount - noDataCount;
      if (
        ![sampleCount, noDataCount].every(Number.isSafeInteger) ||
        noDataCount < 0 ||
        validPixels < 0
      )
        throw new Error(
          "Некорректное количество пикселей в ответе Copernicus.",
        );
      if (
        validPixels > 0 &&
        (![min, mean, max].every(
          (value) => Number.isFinite(value) && value >= -1 && value <= 1,
        ) ||
          min > mean ||
          mean > max)
      )
        throw new Error("Некорректные значения NDVI в ответе Copernicus.");
      return {
        date,
        validPixels,
        fieldPixels:
          typeof fieldPixels === "number" &&
          Number.isSafeInteger(fieldPixels) &&
          fieldPixels > 0 &&
          fieldPixels >= validPixels
            ? fieldPixels
            : null,
        min: validPixels ? min : null,
        mean: validPixels ? mean : null,
        max: validPixels ? max : null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
