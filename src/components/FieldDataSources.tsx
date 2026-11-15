import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import type { Field } from "../lib/types";
import {
  loadFieldSource,
  type DataPeriod,
  type FieldSource,
  type SourceResult,
} from "../features/live-field-data";

export const waterSources = ["imerg-power", "smap", "gldas", "nldas"] as const;
export const satelliteSources = [
  "imerg-final",
  "smap",
  "ecostress",
  "gldas",
  "nldas",
  "hls",
  "sentinel2",
  "srtm",
] as const;

const sources = {
  "imerg-power": [
    "Осадки · NASA IMERG через POWER",
    "Суточный ряд для ячейки 0,1° у центра поля (UTC).",
  ],
  "imerg-final": [
    "Осадки · NASA IMERG Final",
    "Оценка осадков за один день из архива GES DISC (UTC).",
  ],
  smap: [
    "Влажность поверхности · NASA SMAP",
    "Спутниковая оценка для района вокруг поля, сетка 9 км. Проверяются до трёх утренних снимков.",
  ],
  gldas: [
    "Вода в почве · NASA GLDAS",
    "Модельная оценка для слоя 0–10 см на один момент времени.",
  ],
  nldas: [
    "Вода в почве · NASA NLDAS",
    "Региональная модель для Северной Америки, слой 0–10 см на один момент времени.",
  ],
  ecostress: [
    "Температура поверхности · NASA ECOSTRESS",
    "Один пригодный снимок поверхности после проверки масок качества.",
  ],
  hls: [
    "Растительный покров · NASA HLS",
    "Отдельные снимки NDVI по полю и доля пригодных пикселей.",
  ],
  sentinel2: [
    "Покров · Copernicus Sentinel-2",
    "Классы поверхности и качества на одном снимке.",
  ],
  srtm: [
    "Высота · NASA SRTM",
    "Средняя высота и диапазон по части поля с покрытием.",
  ],
} satisfies Record<Exclude<FieldSource, "soilgrids">, [string, string]>;

type SourceId = keyof typeof sources;
type Row = {
  date?: string;
  granuleId?: string;
  granule?: string;
  dataset?: string;
  value?: number | null;
  mean?: number;
  min?: number;
  max?: number;
  validPixels?: number;
  fieldPixels?: number;
  areaCoverageFraction?: number;
  IMERG_PRECTOT?: number | null;
  sclCounts?: Record<string, number>;
};
const number = (value: number) =>
  value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });

function descriptions(
  source: SourceId,
  result: SourceResult,
  period: DataPeriod,
) {
  const rows = (
    Array.isArray(result.data) ? result.data : [result.data]
  ).filter(Boolean) as Row[];
  if (source === "imerg-power") {
    const valid = rows.flatMap((row) =>
      typeof row?.IMERG_PRECTOT === "number" ? [row.IMERG_PRECTOT] : [],
    );
    if (!valid.length)
      return ["За выбранный период нет пригодных значений осадков."];
    return [
      `${number(valid.reduce((total, value) => total + value, 0))} мм за дни с данными · покрытие ${valid.length} из ${rows.length} дней · ${period.start} — ${period.end}`,
    ];
  }
  if (source === "srtm") {
    const terrain = rows[0];
    return terrain?.mean == null || terrain.min == null || terrain.max == null
      ? []
      : [
          `Средняя высота ${number(terrain.mean)} м · диапазон ${number(terrain.min)}–${number(terrain.max)} м`,
          ...(terrain.areaCoverageFraction == null
            ? []
            : [
                `Покрытие контура ${number(terrain.areaCoverageFraction * 100)}%`,
              ]),
        ];
  }
  if (source === "sentinel2") {
    const scene = rows[0];
    if (!scene?.sclCounts) return [];
    const classes: Record<string, string> = {
      4: "растительность",
      5: "голая поверхность",
      6: "вода",
    };
    const counts = Object.entries(classes).map(
      ([id, name]) => `${name} ${number(scene.sclCounts?.[id] ?? 0)}`,
    );
    return [
      `${scene.date?.slice(0, 10) ?? "Дата неизвестна"} · ${counts.join(" · ")} пикс.`,
    ];
  }
  const units = {
    "imerg-final": "мм/сутки",
    smap: "м³/м³",
    gldas: "кг/м²",
    nldas: "кг/м²",
    ecostress: "°C",
    hls: "NDVI",
  };
  return rows.flatMap((row) => {
    const value = row.value ?? row.mean;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      row.validPixels === 0
    )
      return [];
    const time =
      source === "gldas" || source === "nldas"
        ? ` ${row.date?.slice(11, 16) ?? ""} UTC`
        : "";
    const coverage =
      row.fieldPixels && row.validPixels != null
        ? ` · пригодные пиксели ${row.validPixels} из ${row.fieldPixels}`
        : "";
    const label = row.dataset ? `${row.dataset} · ` : "";
    return [
      `${label}${row.date?.slice(0, 10) ?? "Дата неизвестна"}${time} · ${number(value)} ${units[source]}${coverage}`,
    ];
  });
}

function failure(reason?: string) {
  if (reason === "Requires the local NASA archive pipeline")
    return "Источник доступен только при локальной обработке архивов NASA.";
  if (reason?.includes("EARTHDATA_TOKEN"))
    return "Для этого источника серверу нужен доступ NASA Earthdata.";
  if (reason?.includes("application terms"))
    return "NASA Earthdata требует разрешить доступ к этому архиву.";
  if (/HTTP (401|403)/.test(reason ?? ""))
    return "Архив не разрешил доступ. Проверьте учётные данные сервера.";
  return "Источник временно не ответил или вернул непригодные данные.";
}

function SourceCard({
  field,
  period,
  source,
}: {
  field: Field;
  period: DataPeriod;
  source: SourceId;
}) {
  const { demo, user } = useAuth();
  const requestPeriod = source === "srtm" ? undefined : period;
  const query = useQuery({
    queryKey: [
      "field-source",
      demo ? "demo" : user?.id,
      field.id,
      field.boundary,
      source,
      requestPeriod,
    ],
    queryFn: ({ signal }) =>
      loadFieldSource(source, field.boundary, requestPeriod, field.id, signal),
    retry: false,
    staleTime: (query) =>
      query.state.data?.status === "blocked" ? 0 : 30 * 60 * 1000,
  });
  const data = query.data;
  const lines =
    !query.error && data?.status === "ready"
      ? descriptions(source, data, period)
      : [];
  return (
    <article className="card field-source-card">
      <h3>{sources[source][0]}</h3>
      <p>{sources[source][1]}</p>
      {query.isFetching && <p role="status">Загружаем…</p>}
      {query.isError && <p>{query.error.message}</p>}
      {!query.isError && data?.status === "blocked" && (
        <p>{failure(data.reason)}</p>
      )}
      {!query.isError && data?.status === "no_coverage" && (
        <p>
          {data.reason?.startsWith("NLDAS regional")
            ? "Поле находится вне зоны покрытия NLDAS."
            : source === "smap"
              ? "В проверенных утренних снимках для этого контура нет значений, прошедших контроль качества."
              : "Для этого контура и выбранного периода нет пригодных данных."}
        </p>
      )}
      {lines.length > 0 && (
        <ul>
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
      {data?.status === "ready" && !lines.length && !query.isError && (
        <p>Источник не вернул значений для показа.</p>
      )}
      {!query.isFetching && (query.isError || data?.status === "blocked") && (
        <button
          type="button"
          className="button outline"
          onClick={() => void query.refetch()}
        >
          Повторить
        </button>
      )}
    </article>
  );
}

export function FieldDataSources({
  field,
  period,
  selected,
}: {
  field: Field;
  period: DataPeriod;
  selected: readonly SourceId[];
}) {
  return (
    <div className="chart-grid field-source-grid">
      {selected.map((source) => (
        <SourceCard
          key={source}
          field={field}
          period={period}
          source={source}
        />
      ))}
    </div>
  );
}
