import { useEffect, useState } from "react";
import type { Field } from "../lib/types";

type Estimate = {
  status: string;
  dataset?: string;
  retrievedAt?: string;
  data?: {
    depthCm: number[];
    areaCoverageFraction: number;
    mean: Record<string, number | null>;
  }[];
};
const pending = new Map<string, Promise<Estimate>>();

export function cachedSoil(boundary: Field["boundary"]): Estimate | null {
  try {
    const cached = JSON.parse(
      localStorage.getItem(`agrona-soil-v1:${JSON.stringify(boundary)}`) ||
        "null",
    );
    return cached?.status === "ready" &&
      Array.isArray(cached.data) &&
      cached.data.length &&
      Date.now() - Date.parse(cached.retrievedAt) < 30 * 86400000
      ? cached
      : null;
  } catch {
    return null;
  }
}

export function loadSoil(boundary: Field["boundary"]): Promise<Estimate> {
  const key = JSON.stringify(boundary);
  if (pending.has(key)) return pending.get(key)!;
  const cached = cachedSoil(boundary);
  if (cached) return Promise.resolve(cached);
  const request = fetch(import.meta.env.VITE_SOIL_URL || "/api/soil", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: key,
  })
    .then(async (response) => {
      if (!response.ok)
        throw new Error(
          "Не удалось загрузить оценку почвы. Поле можно сохранить.",
        );
      const result = (await response.json()) as Estimate;
      if (!["ready", "no_coverage"].includes(result.status))
        throw new Error("Источник вернул непригодные данные.");
      if (
        result.status === "ready" &&
        (!Array.isArray(result.data) || !result.data.length)
      )
        throw new Error("Источник вернул непригодные данные.");
      try {
        localStorage.setItem(`agrona-soil-v1:${key}`, JSON.stringify(result));
      } catch {
        /* Cache is optional. */
      }
      return result;
    })
    .catch((error) => {
      pending.delete(key);
      throw error;
    });
  pending.set(key, request);
  return request;
}

export default function SoilEstimate({
  boundary,
}: {
  boundary?: Field["boundary"];
}) {
  const key = JSON.stringify(boundary);
  const [state, setState] = useState<{
    key: string;
    result?: Estimate;
    error?: string;
  }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!boundary || !key) return;
    let current = true;
    loadSoil(boundary)
      .then((result) => {
        if (current) setState({ key, result });
      })
      .catch((error) => {
        if (current) setState({ key, error: error.message });
      });
    return () => {
      current = false;
    };
  }, [key, attempt]);
  if (!boundary) return <p>Укажите границу для оценки почвы.</p>;
  if (state?.key !== key)
    return (
      <p role="status">
        Получаем состав почвы по границе поля… Можно сохранить поле сейчас.
      </p>
    );
  if (state.error)
    return (
      <p role="status">
        {state.error}{" "}
        <button
          type="button"
          onClick={() => {
            setState(undefined);
            setAttempt(attempt + 1);
          }}
        >
          Повторить
        </button>
      </p>
    );
  if (state.result?.status === "no_coverage")
    return (
      <p>
        В SoilGrids нет пригодных данных для этого контура. Можно добавить
        сведения своего анализа почвы.
      </p>
    );
  return (
    <section aria-label="Оценка почвы">
      <strong>Состав почвы по SoilGrids</strong>
      {state.result?.data?.map((layer) => (
        <p key={layer.depthCm.join("-")}>
          {layer.depthCm.join("–")} см ·{" "}
          {[
            ["sand", "песок"],
            ["silt", "ил"],
            ["clay", "глина"],
          ]
            .map(
              ([name, label]) =>
                `${label} ${layer.mean[name] == null ? "нет данных" : `${(layer.mean[name]! / 10).toFixed(1)}%`}`,
            )
            .join(" · ")}
          {layer.areaCoverageFraction < 0.99 &&
            ` · покрыто ${(layer.areaCoverageFraction * 100).toFixed(0)}% поля`}
        </p>
      ))}
      <details>
        <summary>Источник и точность</summary>
        <p>
          ISRIC SoilGrids 2.0 · сетка 250 м. Среднее по пересечению с полем.
          Почва внутри участка может различаться. Интервал неопределённости пока
          отсутствует.
        </p>
        <p>Получено {state.result?.retrievedAt?.slice(0, 10)}</p>
      </details>
    </section>
  );
}
