import { t, localize } from "../lib/i18n";
import { useState } from "react";
import VegetationOverlay from "./VegetationOverlay";
import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Leaf } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "../lib/supabase";
import type { Field } from "../lib/types";
import {
  earliestSentinelYear,
  type VegetationDay,
} from "../../supabase/functions/_shared/sentinel";
import { Button } from "./ui/button";

type VegetationResponse = {
  observations: VegetationDay[];
  metadata?: {
    attribution: string;
    resolution_m: number;
    scl_resolution_m: number;
  };
  cached?: boolean;
  pending?: boolean;
  warning?: string;
};

export default function VegetationAnalytics({
  field,
  year,
  ownerId,
  demo,
}: {
  field: Field;
  year: number;
  ownerId?: string;
  demo: boolean;
}) {
  const query = useQuery<VegetationResponse>({
    queryKey: ["vegetation", ownerId, field.id, field.boundary, year],
    enabled: !demo && !!ownerId && !!supabase && year >= earliestSentinelYear,
    staleTime: 60000,
    retry: false,
    refetchInterval: (state) =>
      state.state.data?.pending && !state.state.error ? 5000 : false,
    queryFn: async () => {
      const { data, error } = await supabase!.functions.invoke(
        "sentinel-vegetation",
        { body: { fieldId: field.id, year } },
      );
      if (error instanceof FunctionsHttpError) {
        const response = await error.context
          .clone()
          .json()
          .catch(() => null);
        const message =
          response?.error ??
          (error.context.status === 404
            ? t("Функция Sentinel-2 ещё не развёрнута.")
            : t("Сервис Sentinel-2 недоступен."));
        throw new Error(message);
      }
      if (error)
        throw new Error(t("Не удалось связаться с сервисом Sentinel-2."));
      return data;
    },
  });
  const [overlaySelection, setOverlaySelection] = useState<{
    fieldId: string;
    year: number;
    date: string;
  } | null>(null);
  const date =
    overlaySelection?.fieldId === field.id && overlaySelection.year === year
      ? overlaySelection.date
      : "";
  const overlay = useQuery({
    queryKey: [
      "vegetation-overlay",
      ownerId,
      field.id,
      field.boundary,
      year,
      date,
    ],
    enabled: !demo && !!ownerId && !!date && !!supabase,
    staleTime: 3600000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase!.functions.invoke(
        "sentinel-vegetation",
        { body: { fieldId: field.id, year, overlayDate: date } },
      );
      if (error)
        throw new Error(t("Не удалось получить слой NDVI за выбранную дату."));
      return data;
    },
  });
  const rows = query.data?.observations ?? [];
  const valid = rows.filter((row) => row.mean !== null);
  const pixels = valid.reduce((sum, row) => sum + row.validPixels, 0);
  const mean = pixels
    ? valid.reduce((sum, row) => sum + (row.mean ?? 0) * row.validPixels, 0) /
      pixels
    : null;
  const format = (value: number | null) =>
    value === null ? "—" : value.toFixed(3);
  const waiting = query.isFetching || query.data?.pending;
  const warning = query.error?.message ?? query.data?.warning;
  return (
    <div className="stack" style={{ display: "grid", gap: 16 }}>
      <div className="data-note">
        <Leaf size={18} />
        <div>
          <strong>
            Copernicus Sentinel-2 Level-2A · {year}
            {query.data?.cached ? " " + t("· из кэша") : ""}
          </strong>
          <p>
            {t(
              "NDVI = (B08 − B04) / (B08 + B04). Сетка 10 м, маска SCL 20 м. Оставляем растительность, открытый грунт и воду внутри границы поля. Облака, тени облаков, снег и недействительные пиксели исключены.",
            )}
          </p>
          <p>
            {t(
              "NDVI описывает спектральный отклик поверхности. По нему нельзя напрямую определить влажность почвы, урожайность или здоровье растений.",
            )}
          </p>
        </div>
      </div>
      {demo ? (
        <p className="notice">
          {t(
            "Для анализа Sentinel-2 выберите сохранённое поле в своём аккаунте.",
          )}
        </p>
      ) : year < earliestSentinelYear ? (
        <p className="notice">
          {t(
            "Для Sentinel-2 Level-2A в приложении доступны годы с 2017 года. Покрытие зависит от места и даты.",
          )}
        </p>
      ) : (
        <>
          {waiting && !warning && (
            <p role="status">
              {t("Выполняется анализ Sentinel-2 за") + " "}
              {year}
              {" " + t("год…")}
            </p>
          )}
          {warning && (
            <p role="alert" className="notice">
              {localize(warning)}
            </p>
          )}
          {!waiting && !warning && !valid.length && (
            <p className="notice">
              {t("За") + " "}
              {year}
              {" " + t("год нет снимков с пригодными пикселями внутри поля.")}
            </p>
          )}
          {!waiting && warning && (
            <div>
              <Button variant="outline" onClick={() => void query.refetch()}>
                {t("Проверить снова")}
              </Button>
            </div>
          )}
          {valid.length > 0 && (
            <>
              <div className="metric-grid">
                {[
                  [t("Средний NDVI"), format(mean)],
                  [
                    t("Минимальный NDVI"),
                    format(Math.min(...valid.map((row) => row.min!))),
                  ],
                  [
                    t("Максимальный NDVI"),
                    format(Math.max(...valid.map((row) => row.max!))),
                  ],
                  [t("Дни с данными"), String(valid.length)],
                ].map(([label, value]) => (
                  <div key={label} className="card metric">
                    <div>{label}</div>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <section className="card">
                <h3>{t("Сезонная динамика NDVI")}</h3>
                <p>
                  {t(
                    "Дневные мозаики UTC. Среднее за год взвешено по числу пригодных пикселей на каждую дату.",
                  )}
                </p>
                <ResponsiveContainer width="100%" height={275}>
                  <LineChart
                    data={rows.map((row) => ({
                      ...row,
                      day: Date.parse(row.date),
                    }))}
                  >
                    <CartesianGrid vertical={false} stroke="#edf1ed" />
                    <XAxis
                      dataKey="day"
                      type="number"
                      domain={[Date.UTC(year, 0, 1), Date.UTC(year, 11, 31)]}
                      tickFormatter={(value) =>
                        new Date(value).toISOString().slice(5, 10)
                      }
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis domain={[-1, 1]} tick={{ fontSize: 10 }} />
                    <Tooltip
                      labelFormatter={(value) =>
                        new Date(Number(value)).toISOString().slice(0, 10)
                      }
                    />
                    <Line
                      dataKey="mean"
                      name={t("Средний NDVI")}
                      stroke="#4eaa6e"
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </section>
            </>
          )}
          {!!rows.length && (
            <section className="card" style={{ overflowX: "auto" }}>
              <h3>{t("Слой NDVI")}</h3>
              <select
                aria-label={t("Дата слоя NDVI")}
                value={date}
                onChange={(event) =>
                  setOverlaySelection({
                    fieldId: field.id,
                    year,
                    date: event.target.value,
                  })
                }
              >
                <option value="">{t("Выберите дату снимка")}</option>
                {valid.map((row) => (
                  <option key={row.date}>{row.date}</option>
                ))}
              </select>
              {overlay.isFetching && (
                <p role="status">{t("Загружаем слой NDVI…")}</p>
              )}
              {overlay.error && (
                <p role="alert">{localize(overlay.error.message)}</p>
              )}
              {overlay.data && (
                <>
                  <p>
                    {t(
                      "NDVI от −1 (охра) до +1 (зелёный). Прозрачные участки исключены маской. Слой предпросмотра 256 × 256, статистика рассчитана отдельно на сетке 10 м.",
                    )}
                  </p>
                  <VegetationOverlay
                    image={overlay.data.image}
                    coordinates={overlay.data.coordinates}
                  />
                </>
              )}
              <h3>{t("Даты и покрытие поля")}</h3>
              <p>
                {t(
                  "Покрытие — доля пригодных пикселей от числа пикселей внутри границы. «—» означает, что сервис не сообщил размер этой выборки или NDVI недоступен.",
                )}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>{t("Дата UTC")}</th>
                    <th>{t("Среднее")}</th>
                    <th>{t("Мин.")}</th>
                    <th>{t("Макс.")}</th>
                    <th>{t("Пригодные пиксели")}</th>
                    <th>{t("Покрытие")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.date}>
                      <td>{row.date}</td>
                      <td>{format(row.mean)}</td>
                      <td>{format(row.min)}</td>
                      <td>{format(row.max)}</td>
                      <td>{row.validPixels}</td>
                      <td>
                        {row.fieldPixels
                          ? `${((100 * row.validPixels) / row.fieldPixels).toFixed(1)}%`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="caption">{query.data?.metadata?.attribution}</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
