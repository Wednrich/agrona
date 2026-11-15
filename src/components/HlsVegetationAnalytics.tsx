import {
  vegetationInsights,
  type VegetationSample,
} from "../features/field-insights";
import type { RotationPeriod } from "../features/rotation-climate";
import { FieldInsights } from "./FieldInsights";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Leaf } from "lucide-react";
import {
  CartesianGrid,
  Scatter,
  ScatterChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "../lib/supabase";
import type { Field } from "../lib/types";
const earliestHlsYear = 2013;
const hlsWaitMs = 2 * 60 * 1000;
type HlsDay = VegetationSample & {
  acquiredAt: string;
  min: number | null;
  max: number | null;
  waterPixels: number;
};
import { Button } from "./ui/button";

type VegetationResponse = {
  observations: HlsDay[];
  cached?: boolean;
  pending?: boolean;
  queued?: boolean;
  state?: "queued" | "running" | "partial" | "succeeded" | "failed";
  warning?: string;
  unsupported?: boolean;
};

export default function HlsVegetationAnalytics({
  field,
  year,
  ownerId,
  demo,
  insightPeriod,
}: {
  field: Field;
  year: number;
  ownerId?: string;
  demo: boolean;
  insightPeriod?: RotationPeriod;
}) {
  const queryKey = ["hls-vegetation", ownerId, field.id, field.boundary, year];
  const scope = JSON.stringify(queryKey);
  const [pausedScope, setPausedScope] = useState<string | null>(null);
  const paused = pausedScope === scope;
  const query = useQuery<VegetationResponse>({
    queryKey,
    enabled: !demo && !!ownerId && !!supabase && year >= earliestHlsYear,
    staleTime: 60000,
    retry: false,
    refetchOnWindowFocus: !paused,
    refetchOnReconnect: !paused,
    refetchInterval: (state) =>
      !paused && state.state.data?.pending && !state.state.error ? 5000 : false,
    queryFn: async () => {
      const { data, error } = await supabase!.functions.invoke(
        "hls-vegetation",
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
            ? "Функция NASA HLS ещё не развёрнута."
            : "Сервис NASA HLS недоступен.");
        throw new Error(message);
      }
      if (error) throw new Error("Не удалось связаться с сервисом NASA HLS.");
      return data;
    },
  });
  const pending = query.data?.pending === true;
  useEffect(() => {
    if (!pending || paused || query.isError) return;
    const timer = window.setTimeout(() => setPausedScope(scope), hlsWaitMs);
    return () => window.clearTimeout(timer);
  }, [pending, paused, scope, query.isError]);
  const rows = query.data?.observations ?? [];
  const valid = rows.filter(
    (row) => row.mean !== null && row.tileContainsField,
  );
  const pixels = valid.reduce((sum, row) => sum + row.validPixels, 0);
  const mean = pixels
    ? valid.reduce((sum, row) => sum + (row.mean ?? 0) * row.validPixels, 0) /
      pixels
    : null;
  const format = (value: number | null) =>
    value === null ? "—" : value.toFixed(3);
  const waiting = query.isFetching || (pending && !paused && !query.isError);
  const warning =
    query.error?.message ??
    (paused && pending
      ? query.data?.queued
        ? "NASA HLS ещё в очереди. Автоматическая проверка приостановлена."
        : "NASA HLS ещё обрабатывает снимки. Автоматическая проверка приостановлена."
      : query.data?.warning);
  return (
    <div className="stack" style={{ display: "grid", gap: 16 }}>
      {!demo &&
        year >= earliestHlsYear &&
        insightPeriod &&
        !query.data?.pending &&
        (!query.isFetching || rows.length > 0) && (
          <FieldInsights
            title="Заключение по растительности"
            insights={vegetationInsights(rows, insightPeriod)}
          />
        )}
      <div className="data-note">
        <Leaf size={18} />
        <div>
          <strong>
            NASA HLS v2.0 · 30 м · {year}
            {query.data?.cached ? " · из кэша" : ""}
          </strong>
          <p>
            NDVI по отражательной способности HLSL30 (B05/B04) и HLSS30
            (B8A/B04). Облака, тени, снег, высокий аэрозоль и недействительные
            пиксели исключены маской Fmask. Пиксели воды подсчитаны отдельно.
          </p>
          <p>
            NDVI описывает спектральный отклик поверхности. По нему нельзя
            напрямую определить влажность почвы, урожайность или здоровье
            растений.
          </p>
        </div>
      </div>
      {demo ? (
        <p className="notice">
          Для анализа NASA HLS выберите сохранённое поле в своём аккаунте.
        </p>
      ) : year < earliestHlsYear ? (
        <p className="notice">
          Для NASA HLS Level-2A в приложении доступны годы с 2013 года. Покрытие
          зависит от места и даты.
        </p>
      ) : (
        <>
          {waiting && !warning && (
            <p role="status">
              {query.data?.state === "partial"
                ? "Частичные результаты сохранены. Ожидается продолжение анализа"
                : query.data?.queued
                ? "Анализ ожидает запуска"
                : "Выполняется анализ"}{" "}
              NASA HLS за {year} год…
            </p>
          )}
          {warning && (
            <p role="alert" className="notice">
              {warning}
            </p>
          )}
          {!waiting && !warning && !valid.length && (
            <p className="notice">
              {rows.length
                ? "Нет пригодных пикселей на снимках, полностью покрывающих поле."
                : `За ${year} год не найдено снимков с пикселями внутри поля.`}
            </p>
          )}
          {!waiting && warning && !query.data?.unsupported && (
            <div>
              <Button
                variant="outline"
                onClick={() => {
                  setPausedScope(null);
                  void query.refetch();
                }}
              >
                Проверить снова
              </Button>
            </div>
          )}
          {valid.length > 0 && (
            <>
              <div className="metric-grid">
                {[
                  ["Средний NDVI", format(mean)],
                  [
                    "Минимальный NDVI",
                    format(Math.min(...valid.map((row) => row.min!))),
                  ],
                  [
                    "Максимальный NDVI",
                    format(Math.max(...valid.map((row) => row.max!))),
                  ],
                  ["Снимки с данными", String(valid.length)],
                ].map(([label, value]) => (
                  <div key={label} className="card metric">
                    <div>{label}</div>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <section className="card">
                <h3>Сезонная динамика NDVI</h3>
                <p>
                  Каждая точка — отдельный снимок UTC. Среднее за год взвешено
                  по числу пригодных пикселей на снимках, охватывающих всё поле.
                </p>
                <ResponsiveContainer width="100%" height={275}>
                  <ScatterChart>
                    <CartesianGrid vertical={false} stroke="#edf1ed" />
                    <XAxis
                      dataKey="day"
                      name="Дата UTC"
                      type="number"
                      domain={[Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1)]}
                      tickFormatter={(value) =>
                        new Date(value).toISOString().slice(5, 10)
                      }
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis
                      dataKey="mean"
                      name="Средний NDVI"
                      domain={[-1, 1]}
                      tick={{ fontSize: 10 }}
                    />
                    <Tooltip
                      labelFormatter={(value) =>
                        new Date(Number(value)).toISOString().slice(0, 10)
                      }
                    />
                    {(["HLSL30", "HLSS30"] as const).map((dataset, i) => (
                      <Scatter
                        key={dataset}
                        name={dataset}
                        fill={i === 0 ? "#378958" : "#5180bd"}
                        data={valid
                          .filter((row) => row.dataset === dataset)
                          .map((row) => ({
                            ...row,
                            day: Date.parse(row.acquiredAt),
                          }))}
                      />
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
              </section>
            </>
          )}
          {!!rows.length && (
            <section className="card" style={{ overflowX: "auto" }}>
              <h3>Даты и покрытие поля</h3>
              <p>
                Покрытие — доля пригодных пикселей от числа пикселей внутри
                границы. «—» означает, что сервис не сообщил размер этой выборки
                или NDVI недоступен.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Дата UTC</th>
                    <th>Источник</th>
                    <th>Качество</th>
                    <th>Вода, пикс.</th>
                    <th>Среднее</th>
                    <th>Мин.</th>
                    <th>Макс.</th>
                    <th>Пригодные пиксели</th>
                    <th>Покрытие</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.conceptId}>
                      <td>{row.acquiredAt.replace("T", " ").slice(0, 19)}</td>
                      <td title={row.conceptId}>{row.dataset}</td>
                      <td>
                        {!row.tileContainsField
                          ? "Часть поля"
                          : row.validPixels === 0
                            ? "Пиксели исключены маской"
                            : "Прошёл маску"}
                      </td>
                      <td>{row.waterPixels}</td>
                      <td>{format(row.mean)}</td>
                      <td>{format(row.min)}</td>
                      <td>{format(row.max)}</td>
                      <td>{row.validPixels}</td>
                      <td>
                        {row.tileContainsField && row.fieldPixels
                          ? `${((100 * row.validPixels) / row.fieldPixels).toFixed(1)}%`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="caption">
                NASA LP DAAC · HLS v2.0. Для частичного покрытия показана
                статистика внутри части поля, попавшей в снимок.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
