import {
  evaluation,
  overlayEvaluation,
  parseSentinelStatistics,
} from "./sentinel.ts";

const tokenUrl =
  "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const statsUrl = "https://sh.dataspace.copernicus.eu/statistics/v1";

let tokenPromise: Promise<{ value: string; expires: number }> | undefined;

async function requestToken(clientId: string, clientSecret: string) {
  const response = await fetch(tokenUrl, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      `Авторизация Copernicus недоступна (HTTP ${response.status}).`,
    );
  const body = await response.json();
  if (
    typeof body.access_token !== "string" ||
    !Number.isFinite(body.expires_in)
  )
    throw new Error("Copernicus вернул некорректный токен.");
  return {
    value: body.access_token,
    expires: Date.now() + body.expires_in * 1000 - 30000,
  };
}

async function getToken(clientId: string, clientSecret: string) {
  if (tokenPromise && (await tokenPromise).expires < Date.now())
    tokenPromise = undefined;
  tokenPromise ??= requestToken(clientId, clientSecret).catch((error) => {
    tokenPromise = undefined;
    throw error;
  });
  return (await tokenPromise).value;
}

export async function fetchSentinelYear(
  clientId: string,
  clientSecret: string,
  year: number,
  geometry: { type: "Polygon"; coordinates: number[][][] },
  epsg: number,
) {
  const body = {
    input: {
      bounds: {
        geometry,
        properties: { crs: `http://www.opengis.net/def/crs/EPSG/0/${epsg}` },
      },
      data: [
        {
          type: "sentinel-2-l2a",
          dataFilter: { mosaickingOrder: "leastCC" },
          processing: {
            upsampling: "NEAREST",
            downsampling: "NEAREST",
            harmonizeValues: true,
          },
        },
      ],
    },
    aggregation: {
      timeRange: {
        from: `${year}-01-01T00:00:00Z`,
        to: `${year + 1}-01-01T00:00:00Z`,
      },
      aggregationInterval: { of: "P1D" },
      resx: 10,
      resy: 10,
      evalscript: evaluation,
    },
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(statsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await getToken(clientId, clientSecret)}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55000),
    });
    if (response.ok)
      return parseSentinelStatistics(await response.json(), year);
    if (response.status === 401 && attempt === 0) {
      tokenPromise = undefined;
      continue;
    }
    if (response.status === 429)
      throw new Error("Достигнут лимит запросов Copernicus. Попробуйте позже.");
    if (response.status >= 500 && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    throw new Error(`Copernicus не выполнил расчёт (HTTP ${response.status}).`);
  }
  throw new Error("Copernicus недоступен.");
}

export async function fetchSentinelOverlay(
  clientId: string,
  clientSecret: string,
  date: string,
  geometry: { type: "Polygon"; coordinates: number[][][] },
  bounds: [number, number, number, number],
) {
  const next = new Date(Date.parse(date) + 86400000).toISOString();
  const response = await fetch(
    "https://sh.dataspace.copernicus.eu/process/v1",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await getToken(clientId, clientSecret)}`,
      },
      body: JSON.stringify({
        input: {
          bounds: {
            bbox: bounds,
            geometry,
            properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/3857" },
          },
          data: [
            {
              type: "sentinel-2-l2a",
              dataFilter: {
                timeRange: { from: `${date}T00:00:00Z`, to: next },
                mosaickingOrder: "leastCC",
              },
              processing: {
                upsampling: "NEAREST",
                downsampling: "NEAREST",
                harmonizeValues: true,
              },
            },
          ],
        },
        output: {
          width: 256,
          height: 256,
          responses: [{ identifier: "default", format: { type: "image/png" } }],
        },
        evalscript: overlayEvaluation,
      }),
      signal: AbortSignal.timeout(25000),
    },
  );
  if (
    !response.ok ||
    !response.headers.get("Content-Type")?.includes("image/png")
  )
    throw new Error(`Слой NDVI недоступен (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 512000)
    throw new Error("Слой NDVI превышает допустимый размер.");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}
