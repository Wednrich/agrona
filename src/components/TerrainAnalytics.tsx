import { useQuery } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import {
  srtmRevision,
  type TerrainResult,
} from "../../supabase/functions/_shared/srtm";
import { FieldInsights } from "./FieldInsights";
import { supabase } from "../lib/supabase";
import type { Field } from "../lib/types";
import { Button } from "./ui/button";

export function TerrainAnalytics({
  field,
  ownerId,
  demo,
}: {
  field: Field;
  ownerId?: string;
  demo: boolean;
}) {
  const query = useQuery<TerrainResult>({
    queryKey: ["srtm-terrain", ownerId, field.id, field.boundary],
    enabled: !demo && !!ownerId && !!supabase,
    staleTime: Infinity,
    retry: false,
    refetchInterval: (state) =>
      state.state.data?.status === "loading" && !state.state.error
        ? 5000
        : false,
    queryFn: async () => {
      const expectedRevision = await srtmRevision(field.boundary);
      const { data, error } = await supabase!.functions.invoke("srtm-terrain", {
        body: { fieldId: field.id, expectedRevision },
      });
      if (error instanceof FunctionsHttpError) {
        const response = await error.context
          .clone()
          .json()
          .catch(() => null);
        throw new Error(
          response?.message ??
            "Сервис рельефа недоступен. Проверьте развёртывание.",
        );
      }
      if (error) throw new Error("Нет соединения с сервисом рельефа.");
      return data;
    },
  });
  const result = query.data;
  const metrics = result?.metrics;
  const format = (value: number) =>
    new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
  const waiting = query.isFetching || result?.status === "loading";
  return (
    <section className="card field-insights" aria-label="Рельеф">
      <h2>Рельеф</h2>
      <p className="caption">
        NASA SRTMGL1 v003 · 1 угловая секунда (около 30 м по широте) · февраль
        2000 · OpenTopography{result?.cached ? " · из кэша" : ""}
      </p>
      {demo && <p>Для анализа рельефа откройте сохранённое поле в аккаунте.</p>}
      {waiting && <p role="status">Загружаем и рассчитываем рельеф…</p>}
      {query.error && (
        <p className="error" role="alert">
          {query.error.message}
        </p>
      )}
      {result?.message && !waiting && (
        <p className="notice" role="status">
          {result.message}
        </p>
      )}
      {!waiting && (query.error || result?.status === "error") && (
        <Button variant="outline" onClick={() => void query.refetch()}>
          Повторить
        </Button>
      )}
      {metrics && (
        <>
          {result.status === "ready" && <p role="status">Готово</p>}
          <p>
            Пригодные ячейки: высота {metrics.elevationCells} из {metrics.cells}
            , уклон {metrics.slopeCells} из {metrics.cells}.
          </p>
          <dl>
            <dt>Высота над геоидом EGM96, мин. / макс. / средняя</dt>
            <dd>
              {metrics.elevation
                ? [
                    metrics.elevation.min,
                    metrics.elevation.max,
                    metrics.elevation.mean,
                  ]
                    .map(format)
                    .join(" / ") + " м"
                : "Недостаточно данных"}
            </dd>
            <dt>Уклон, средний / максимальный</dt>
            <dd>
              {metrics.slope
                ? [metrics.slope.mean, metrics.slope.max]
                    .map(format)
                    .join(" / ") + "°"
                : "Недостаточно данных"}
            </dd>
          </dl>
          {result.status === "ready" && metrics.elevation && metrics.slope && (
            <FieldInsights
              title="Заключение по рельефу"
              insights={[
                {
                  id: "srtm-terrain",
                  observation: `Перепад высот в выборке ${format(metrics.elevation.max - metrics.elevation.min)} м, средний уклон ${format(metrics.slope.mean)}°, максимальный ${format(metrics.slope.max)}°.`,
                  meaning:
                    "Перепад и наклон могут влиять на поверхностный сток, равномерность полива и работу техники.",
                  action:
                    "Сверьте низкие и наклонные участки на месте. При выборе мер против эрозии учитывайте почву, покров и следы стока.",
                  source: "NASA SRTMGL1 v003 · 1″",
                  period: "Съёмка в феврале 2000 года",
                  limits:
                    "Уклон рассчитан по соседним ячейкам растра. Мелкие неровности, изменения после съёмки и фактическая эрозия требуют наземной проверки.",
                  confidence: "Умеренная",
                },
              ]}
            />
          )}
        </>
      )}
      <p className="caption">
        Статистика по центрам ячеек внутри границы. Мелкие канавы и современные
        изменения рельефа могут отсутствовать. Долготный размер ячейки
        уменьшается с широтой.
      </p>
    </section>
  );
}
