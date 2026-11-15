import { t, getLanguage, localize } from "../lib/i18n";
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
        if (error.context.status === 404)
          throw new Error(
            t(
              "Расчёт уклона пока недоступен. Оценка высоты SRTM загружается отдельно.",
            ),
          );
        const response = await error.context
          .clone()
          .json()
          .catch(() => null);
        throw new Error(
          response?.message ??
            t("Сервис рельефа недоступен. Проверьте развёртывание."),
        );
      }
      if (error) throw new Error(t("Нет соединения с сервисом рельефа."));
      return data;
    },
  });
  const result = query.data;
  const metrics = result?.metrics;
  const format = (value: number) =>
    new Intl.NumberFormat(getLanguage(), { maximumFractionDigits: 1 }).format(
      value,
    );
  const waiting = query.isFetching || result?.status === "loading";
  return (
    <section className="card field-insights" aria-label={t("Рельеф")}>
      <h2>{t("Рельеф")}</h2>
      <p className="caption">
        {t(
          "NASA SRTMGL1 v003 · 1 угловая секунда (около 30 м по широте) · февраль 2000 · OpenTopography",
        )}
        {result?.cached ? " " + t("· из кэша") : ""}
      </p>
      {demo && (
        <p>
          {t(
            "Расчёт уклона доступен в аккаунте. Оценка высоты SRTM загружается отдельно.",
          )}
        </p>
      )}
      {waiting && <p role="status">{t("Загружаем и рассчитываем рельеф…")}</p>}
      {query.error && (
        <p className="error" role="alert">
          {localize(query.error.message)}
        </p>
      )}
      {result?.message && !waiting && (
        <p className="notice" role="status">
          {localize(result.message)}
        </p>
      )}
      {!waiting && (query.error || result?.status === "error") && (
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t("Повторить")}
        </Button>
      )}
      {metrics && (
        <>
          {result.status === "ready" && <p role="status">{t("Готово")}</p>}
          <p>
            {t("Пригодные ячейки: высота") + " "}
            {metrics.elevationCells}
            {" " + t("из") + " "}
            {metrics.cells}
            {t(", уклон") + " "}
            {metrics.slopeCells}
            {" " + t("из") + " "}
            {metrics.cells}.
          </p>
          <dl>
            <dt>{t("Высота над геоидом EGM96, мин. / макс. / средняя")}</dt>
            <dd>
              {metrics.elevation
                ? [
                    metrics.elevation.min,
                    metrics.elevation.max,
                    metrics.elevation.mean,
                  ]
                    .map(format)
                    .join(" / ") +
                  (" " + t("м"))
                : t("Недостаточно данных")}
            </dd>
            <dt>{t("Уклон, средний / максимальный")}</dt>
            <dd>
              {metrics.slope
                ? [metrics.slope.mean, metrics.slope.max]
                    .map(format)
                    .join(" / ") + "°"
                : t("Недостаточно данных")}
            </dd>
          </dl>
          {result.status === "ready" && metrics.elevation && metrics.slope && (
            <FieldInsights
              title={t("Заключение по рельефу")}
              insights={[
                {
                  id: "srtm-terrain",
                  observation: t(
                    "Перепад высот в выборке {0} м, средний уклон {1}°, максимальный {2}°.",
                    format(metrics.elevation.max - metrics.elevation.min),
                    format(metrics.slope.mean),
                    format(metrics.slope.max),
                  ),
                  meaning: t(
                    "Перепад и наклон могут влиять на поверхностный сток, равномерность полива и работу техники.",
                  ),
                  action: t(
                    "Сверьте низкие и наклонные участки на месте. При выборе мер против эрозии учитывайте почву, покров и следы стока.",
                  ),
                  source: "NASA SRTMGL1 v003 · 1″",
                  period: t("Съёмка в феврале 2000 года"),
                  limits: t(
                    "Уклон рассчитан по соседним ячейкам растра. Мелкие неровности, изменения после съёмки и фактическая эрозия требуют наземной проверки.",
                  ),
                  confidence: "Умеренная",
                },
              ]}
            />
          )}
        </>
      )}
      <p className="caption">
        {t(
          "Статистика по центрам ячеек внутри границы. Мелкие канавы и современные изменения рельефа могут отсутствовать. Долготный размер ячейки уменьшается с широтой.",
        )}
      </p>
    </section>
  );
}
