import { t, getLanguage, localize } from "../lib/i18n";
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
    t("Осадки · NASA IMERG через POWER"),
    t("Суточный ряд для ячейки 0,1° у центра поля (UTC)."),
  ],
  "imerg-final": [
    t("Осадки · NASA IMERG Final"),
    t("Оценка осадков за один день из архива GES DISC (UTC)."),
  ],
  smap: [
    t("Влажность поверхности · NASA SMAP"),
    t(
      "Спутниковая оценка для района вокруг поля, сетка 9 км. Проверяются до трёх утренних снимков.",
    ),
  ],
  gldas: [
    t("Вода в почве · NASA GLDAS"),
    t("Модельная оценка для слоя 0–10 см на один момент времени."),
  ],
  nldas: [
    t("Вода в почве · NASA NLDAS"),
    t(
      "Региональная модель для Северной Америки, слой 0–10 см на один момент времени.",
    ),
  ],
  ecostress: [
    t("Температура поверхности · NASA ECOSTRESS"),
    t("Один пригодный снимок поверхности после проверки масок качества."),
  ],
  hls: [
    t("Растительный покров · NASA HLS"),
    t("Отдельные снимки NDVI по полю и доля пригодных пикселей."),
  ],
  sentinel2: [
    t("Покров · Copernicus Sentinel-2"),
    t("Классы поверхности и качества на одном снимке."),
  ],
  srtm: [
    t("Высота · NASA SRTM"),
    t("Средняя высота и диапазон по части поля с покрытием."),
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
  value.toLocaleString(getLanguage(), { maximumFractionDigits: 3 });

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
      return [t("За выбранный период нет пригодных значений осадков.")];
    return [
      t(
        "{0} мм за дни с данными · покрытие {1} из {2} дней · {3} — {4}",
        number(valid.reduce((total, value) => total + value, 0)),
        valid.length,
        rows.length,
        period.start,
        period.end,
      ),
    ];
  }
  if (source === "srtm") {
    const terrain = rows[0];
    return terrain?.mean == null || terrain.min == null || terrain.max == null
      ? []
      : [
          t(
            "Средняя высота {0} м · диапазон {1}–{2} м",
            number(terrain.mean),
            number(terrain.min),
            number(terrain.max),
          ),
          ...(terrain.areaCoverageFraction == null
            ? []
            : [
                t(
                  "Покрытие контура {0}%",
                  number(terrain.areaCoverageFraction * 100),
                ),
              ]),
        ];
  }
  if (source === "sentinel2") {
    const scene = rows[0];
    if (!scene?.sclCounts) return [];
    const classes: Record<string, string> = {
      4: t("растительность"),
      5: t("голая поверхность"),
      6: t("вода"),
    };
    const counts = Object.entries(classes).map(
      ([id, name]) => `${name} ${number(scene.sclCounts?.[id] ?? 0)}`,
    );
    return [
      t(
        "{0} · {1} пикс.",
        scene.date?.slice(0, 10) ?? t("Дата неизвестна"),
        counts.join(" · "),
      ),
    ];
  }
  const units = {
    "imerg-final": t("мм/сутки"),
    smap: t("м³/м³"),
    gldas: t("кг/м²"),
    nldas: t("кг/м²"),
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
        ? " " +
          t("· пригодные пиксели {0} из {1}", row.validPixels, row.fieldPixels)
        : "";
    const label = row.dataset ? `${row.dataset} · ` : "";
    return [
      `${label}${row.date?.slice(0, 10) ?? t("Дата неизвестна")}${time} · ${number(value)} ${units[source]}${coverage}`,
    ];
  });
}

function failure(reason?: string) {
  if (reason === "Requires the local NASA archive pipeline")
    return t("Источник доступен только при локальной обработке архивов NASA.");
  if (reason?.includes("EARTHDATA_TOKEN"))
    return t("Для этого источника серверу нужен доступ NASA Earthdata.");
  if (reason?.includes("application terms"))
    return t("NASA Earthdata требует разрешить доступ к этому архиву.");
  if (/HTTP (401|403)/.test(reason ?? ""))
    return t("Архив не разрешил доступ. Проверьте учётные данные сервера.");
  return t("Источник временно не ответил или вернул непригодные данные.");
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
      <h3>{t(sources[source][0])}</h3>
      <p>{t(sources[source][1])}</p>
      {query.isFetching && <p role="status">{t("Загружаем…")}</p>}
      {query.isError && <p>{localize(query.error.message)}</p>}
      {!query.isError && data?.status === "blocked" && (
        <p>{failure(data.reason)}</p>
      )}
      {!query.isError && data?.status === "no_coverage" && (
        <p>
          {data.reason?.startsWith("NLDAS regional")
            ? t("Поле находится вне зоны покрытия NLDAS.")
            : source === "smap"
              ? t(
                  "В проверенных утренних снимках для этого контура нет значений, прошедших контроль качества.",
                )
              : t(
                  "Для этого контура и выбранного периода нет пригодных данных.",
                )}
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
        <p>{t("Источник не вернул значений для показа.")}</p>
      )}
      {!query.isFetching && (query.isError || data?.status === "blocked") && (
        <button
          type="button"
          className="button outline"
          onClick={() => void query.refetch()}
        >
          {t("Повторить")}
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
