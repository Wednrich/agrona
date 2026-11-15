import { t } from "../lib/i18n";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { centerOfMass } from "@turf/turf";
import type { Field, Observation } from "../lib/types";
import { supabase } from "../lib/supabase";
import { loadRotationPower } from "../features/rotation-power";
import {
  dateAt,
  evaluateWindow,
  fao56,
  frostSeason,
  iso,
  modelVersion,
  profiles,
  solarDay,
  span,
  summarize,
  type Status,
} from "../features/agroclimate";

const labels: Record<Status, string> = {
  favorable: "Благоприятно",
  risky: "Есть риск",
  unfavorable: "Не подходит",
  insufficient_data: "Недостаточно данных",
};
const monthName = new Intl.DateTimeFormat("ru", {
  month: "long",
  timeZone: "UTC",
});
const fmt = (value: number | null) =>
  value == null
    ? "—"
    : value.toLocaleString("ru", { maximumFractionDigits: 1 });

export default function GrowingCalendar({
  field,
  owner,
  demo,
}: {
  field: Field;
  owner?: string;
  demo: boolean;
}) {
  const last = new Date().getUTCFullYear() - 1;
  const latitude = centerOfMass(field.boundary).geometry.coordinates[1];
  const [crop, setCrop] = useState("maize");
  const [year, setYear] = useState(last - 1);
  const [date, setDate] = useState(latitude < 0 ? "10-01" : "05-01");
  const [elevation, setElevation] = useState("");
  const [load, setLoad] = useState(false);
  const profile = profiles[crop];
  const years = [last - 4, last - 3, last - 2, last - 1, last];
  const fingerprint = JSON.stringify(field.boundary);
  const weather = useQuery({
    queryKey: ["calendar-power", owner, field.id, fingerprint, last],
    enabled: !!owner && !!supabase && !demo && load,
    staleTime: 24 * 3600_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const result: { rows: Observation[]; missing: number[] } = {
        rows: [],
        missing: [],
      };
      // Limit pressure on the shared POWER loader. A failed year does not hide the rest.
      for (const y of years.slice().reverse()) {
        try {
          result.rows.push(
            ...(await loadRotationPower(
              (name, options) =>
                supabase!.functions.invoke(name, { ...options, signal }),
              field.id,
              y,
              fingerprint,
              signal,
            )),
          );
        } catch {
          signal.throwIfAborted();
          result.missing.push(y);
        }
      }
      return result;
    },
  });
  const rows = useMemo(
    () => new Map(weather.data?.rows.map((row) => [row.observation_date, row])),
    [weather.data],
  );
  const [month, day] = date.split("-").map(Number);
  const height =
    elevation.trim() && Number(elevation) >= -500 && Number(elevation) <= 9000
      ? Number(elevation)
      : undefined;
  const start = dateAt(year, month - 1, day);
  const window = evaluateWindow(rows, start, profile, latitude, height);
  const comparison = years
    .map((y) => dateAt(y, month - 1, day))
    .filter((d) => d.getUTCMonth() === month - 1)
    .map((d) => evaluateWindow(rows, d, profile, latitude, height));
  const complete = comparison.filter((result) => result.thermalComplete);
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, m) => {
        const days = span(
          dateAt(year, m, 1),
          dateAt(year, m + 1, 0).getUTCDate(),
        );
        const statuses = days.map(
          (d) => evaluateWindow(rows, new Date(d), profile, latitude).status,
        );
        return {
          days,
          statuses,
          solar: summarize(days.map((d) => rows.get(d)?.solar_radiation)),
        };
      }),
    [rows, year, profile],
  );
  const sources = [
    ...new Set(
      Object.values(profile).flatMap((value) =>
        typeof value === "object" && "source" in value
          ? [String(value.source)]
          : [],
      ),
    ),
  ];
  const solar = solarDay(start, latitude);
  const totals = (stat: ReturnType<typeof summarize>, unit: string) =>
    t("{0} {1} · {2}/{3} дн.", fmt(stat.total), unit, stat.days, stat.expected);
  return (
    <section
      className="card"
      role="tabpanel"
      aria-label={t("Календарь выращивания")}
    >
      <h2>{t("Календарь выращивания")}</h2>
      <p>
        NASA POWER · {years[0]}–{last}
        {t(
          ". Оценки климатической сетки у центра поля: погода 0,5° × 0,625°, радиация 1° × 1°. Исторические условия не являются прогнозом.",
        )}
      </p>
      {demo ? (
        <p>
          {t(
            "История NASA доступна для сохранённого поля после входа. Здесь доступны астрономические расчёты.",
          )}
        </p>
      ) : (
        <button
          type="button"
          className="button"
          disabled={weather.isFetching}
          onClick={() => (load ? void weather.refetch() : setLoad(true))}
        >
          {weather.isFetching
            ? t("Получаем исторические годы…")
            : load
              ? t("Повторить загрузку NASA POWER")
              : t("Загрузить пять лет NASA POWER")}
        </button>
      )}
      {!!weather.data?.missing.length && (
        <p>
          {t("Недоступные годы:") + " "}
          {weather.data.missing.join(", ")}.
        </p>
      )}
      <div className="calendar-controls">
        <label>
          {t("Культура")}
          <select
            value={crop}
            onChange={(event) => setCrop(event.target.value)}
          >
            {Object.entries(profiles).map(([id, item]) => (
              <option key={id} value={id}>
                {t(item.name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Дата пробного посева")}
          <input
            type="date"
            min={`${years[0]}-01-01`}
            max={`${last}-12-31`}
            value={iso(start)}
            onChange={(event) => {
              const value = event.target.value;
              if (
                !value ||
                Number(value.slice(0, 4)) < years[0] ||
                Number(value.slice(0, 4)) > last
              )
                return;
              setYear(Number(value.slice(0, 4)));
              setDate(value.slice(5));
            }}
          />
        </label>
        <label>
          {t("Известная высота поля, м")}
          <input
            type="number"
            min="-500"
            max="9000"
            value={elevation}
            onChange={(event) => setElevation(event.target.value)}
            placeholder={t("Для расчёта ET₀")}
          />
        </label>
      </div>
      <div className="calendar-months">
        {months.map(({ days, statuses, solar }, m) => (
          <div key={m} className="calendar-month">
            <strong>{monthName.format(dateAt(year, m, 15))}</strong>
            <small>
              {fmt(solar.mean)}
              {" " + t("МДж/м²/сутки ·") + " "}
              {solar.days}/{solar.expected}
              {" " + t("дн.")}
            </small>
            <div className="calendar-days">
              {days.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  data-status={statuses[i]}
                  aria-pressed={d === iso(start)}
                  title={`${d} · ${t(labels[statuses[i]])}`}
                  onClick={() => setDate(d.slice(5))}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p>
        {t(
          "Цвет относится к дате посева. Условный период роста для выбранной даты:",
        )}{" "}
        {iso(start)} — {window.end ?? "—"}.
      </p>
      <p>
        {Object.values(labels)
          .map((label) => t(label))
          .join(" · ")}
      </p>
      <h3>
        {t(labels[window.status])} · {iso(start)}
      </h3>
      <ul>
        {window.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <p>
        {t("Верхняя граница теплового ориентира достигнута в")}{" "}
        {complete.filter((result) => result.reachedUpper).length}
        {" " + t("из")} {complete.length}
        {" " +
          t("лет с полной информацией для тепловой проверки. Проверено") +
          " "}
        {comparison.length}
        {" " + t("календарно сопоставимых дат.")}
      </p>
      <p>
        GDD: {totals(window.thermal, t("°C·сут"))} ·{" "}
        {profile.thermal
          ? t(
              "Tbase {0} °C, цель {1}–{2} °C·сут",
              profile.thermal.value.base,
              fmt(profile.thermal.value.target?.[0] ?? null),
              fmt(profile.thermal.value.target?.[1] ?? null),
            )
          : t("порог неизвестен")}{" "}
        {t("· достижение нижней / верхней границы:") + " "}
        {window.reached ?? "—"} / {window.reachedUpper ?? "—"}.
      </p>
      <p>
        {t("Длина дня") + " "}
        {fmt(solar.daylight)}
        {" " + t("ч · Солнце в полдень")} {fmt(solar.altitude)}
        {t("° · суточная радиация")}{" "}
        {fmt(rows.get(iso(start))?.solar_radiation ?? null)}
        {" " + t("МДж/м²/сутки. Радиация за условный сезон:") + " "}
        {totals(window.radiation, t("МДж/м²"))}.
      </p>
      <p>
        {t("Осадки") + " "}
        {totals(window.rain, t("мм"))}
        {" " + t("· наблюдавшийся сухой отрезок (&lt; 1 мм/сутки)") + " "}
        {window.rain.days ? window.longestDry : "—"}
        {" " + t("дн. · влажность воздуха") + " "}
        {fmt(window.humidity.mean)}
        {t("% · средний VPD")} {fmt(window.vpd.mean)}
        {" " + t("кПа.")}
      </p>
      <p>
        ET₀ {totals(window.et0, t("мм"))} · ETc{" "}
        {window.etc
          ? totals(window.etc, t("мм"))
          : t("— (нет подтверждённого Kc и длительности фаз)")}{" "}
        {t("· ET₀ минус осадки") + " "}
        {fmt(window.referenceGap)}
        {" " +
          t(
            "мм. Это метеорологическая разность. Для оценки запасов влаги нужны характеристики почвы и полив.",
          )}
      </p>
      <h3>{t("Исторические заморозки")}</h3>
      {years.map((y) => {
        const frost = frostSeason(rows, y, latitude);
        const radiation = summarize(
          [...rows.values()]
            .filter((row) => row.observation_date.startsWith(String(y)))
            .map((row) => row.solar_radiation),
        );
        return (
          <p key={y}>
            {y}
            {latitude < 0 ? `–${y + 1}` : ""}
            {" " + t("· последний весенний:")} {frost.last ?? "—"}
            {" " + t("· первый осенний:") + " "}
            {frost.first ?? "—"}
            {" " + t("· без заморозков:") + " "}
            {frost.free ?? "—"}
            {" " + t("дн. · Tmin ≤ 0 °C:")} {frost.observed ? frost.days : "—"}{" "}
            ({frost.observed}/{frost.expected}
            {" " + t("дн.) · радиация за календарный") + " "}
            {y}: {fmt(radiation.total)}
            {" " + t("МДж/м² (")}
            {radiation.days}/{dateAt(y, 1, 29).getUTCMonth() === 1 ? 366 : 365}
            {" " + t("дн.).")}
          </p>
        );
      })}
      <p>
        {t("Модель") + " "}
        {modelVersion}
        {t(", профиль v")}
        {profile.version}
        {t(
          ". Длина дня рассчитана геометрически, без учёта рельефа горизонта и рефракции. Высота для ET₀ берётся из введённого значения.",
        ) + " "}
        <a href={fao56}>{t("Методика FAO-56")}</a>.
      </p>
      <ul>
        {sources.map((source, i) => (
          <li key={source}>
            <a href={source}>
              {t("Справочный источник профиля") + " "}
              {i + 1}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
