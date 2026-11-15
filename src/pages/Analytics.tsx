import { t, localize } from "../lib/i18n";
import GrowingCalendar from "../components/GrowingCalendar";
import { TerrainAnalytics } from "../components/TerrainAnalytics";
import { FieldInsights } from "../components/FieldInsights";
import {
  climateInsights,
  fieldContextInsights,
} from "../features/field-insights";
import { loadDemoPower, usesStoredDemoPower } from "../features/demo-power";
import SoilEstimate from "../components/SoilEstimate";
import {
  FieldDataSources,
  waterSources,
  satelliteSources,
} from "../components/FieldDataSources";
import VegetationAnalytics from "../components/VegetationAnalytics";
import { FieldPicker } from "../components/FieldPicker";
import { useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import {
  Thermometer,
  Droplets,
  Sun,
  ArrowUpRight,
  AlertTriangle,
} from "lucide-react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { powerErrorMessage } from "../lib/power-error";
import { supabase } from "../lib/supabase";
import { powerMetrics } from "../../supabase/functions/_shared/power-metrics";
type PowerMetrics = ReturnType<typeof powerMetrics>;
import {
  average,
  climateSummary,
  cropSeasons,
  suggestedSeason,
  selectClimatePeriod,
  type SeasonCrop,
} from "../features/climate";
import type { Observation } from "../lib/types";
import { Button } from "../components/ui/button";
import { AiAdvisorChat, ExplainAdvisor } from "../components/AiAdvisor";
export default function Analytics() {
  const { fieldId } = useParams();
  const { data: farms, isLoading, error: farmsError } = useData();
  const { demo, user } = useAuth();
  const field = farms?.fields.find((f) => f.id === fieldId);
  const [params] = useSearchParams();
  const [tab, setTab] = useState(() =>
    params.get("tab") === "calendar"
      ? "Календарь выращивания"
      : params.get("tab") === "advisor"
        ? "ИИ-агроном"
        : params.get("tab") === "sources"
          ? "Источники"
          : "Климат",
  );
  const climateTab = ![
    "Растительность",
    "Источники",
    "Календарь выращивания",
  ].includes(tab);
  const [year, setYear] = useState(
    demo ? 2025 : new Date().getUTCFullYear() - 1,
  );
  const [climateMode, setClimateMode] = useState<"season" | "year">("season");
  const [crop, setCrop] = useState<SeasonCrop>("wheat");
  const [dates, setDates] = useState(() => suggestedSeason(year, "wheat"));
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const query = useQuery<{
    observations: Observation[];
    metadata?: {
      source: string;
      period: string;
      retrieved_at: string;
      resolution?: { weather: string; solar: string };
    };
    metrics?: PowerMetrics;
    history?: { analysis_period: number; climate_metrics: PowerMetrics }[];
    pending?: boolean;
    warning?: string;
    cached: boolean;
  }>({
    queryKey: [
      "earth-analytics",
      demo ? "demo" : user?.id,
      fieldId,
      field?.boundary,
      year,
    ],
    enabled: !!field && climateTab,
    staleTime: 60_000,
    refetchInterval: (query) => (query.state.data?.pending ? 5000 : false),
    retry: 1,
    queryFn: async () => {
      if (demo && field) return loadDemoPower(field, year);
      if (!supabase) throw new Error(t("Supabase не настроен"));
      const { data, error } = await supabase.functions.invoke("nasa-power", {
        body: { fieldId, year },
      });
      if (error) throw new Error(await powerErrorMessage(error));
      if (data?.error) throw new Error(data.error);
      return data;
    },
  });
  if (isLoading) return <div className="page">{t("Загрузка…")}</div>;
  if (farmsError)
    return <div className="page error">{localize(farmsError.message)}</div>;
  if (!field)
    return <FieldPicker title={t("Аналитика полей")} route="analytics" />;
  const rows = query.data?.observations ?? [];
  const expectedDays =
    (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
  const metrics = query.data?.metrics ?? powerMetrics(rows, expectedDays);
  const period = query.data?.metadata?.period ?? String(year);
  const history = query.data?.history ?? [];
  const comparisons = history
    .filter((entry) => entry.analysis_period < year)
    .slice(-10);
  const baselineTemps = comparisons
    .filter(({ climate_metrics: m }) => m.temperatureDays === m.expectedDays)
    .map(({ climate_metrics: m }) => m.mean);
  const baselineRain = comparisons
    .filter(({ climate_metrics: m }) => m.rainDays === m.expectedDays)
    .map(({ climate_metrics: m }) => m.rain);
  const tempBaseline =
    baselineTemps.length >= 3 ? average(baselineTemps) : null;
  const rainBaseline = baselineRain.length >= 3 ? average(baselineRain) : null;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const start = climateMode === "year" ? yearStart : dates.start;
  const end = climateMode === "year" ? yearEnd : dates.end;
  const climate = selectClimatePeriod(
    tab === "Климат" ? rows : [],
    year,
    start,
    end,
  );
  const climateRows = climate?.daily ?? [];
  const climateStats = climateSummary(climateRows);
  const climateGdd = powerMetrics(climateRows, climate?.days ?? 0).gdd5;
  const fmt = (n: number | null) => (n === null ? "—" : n.toFixed(1));
  const insightPeriod = { year, start, end };
  const advisorScope = { fieldId: field.id, ...insightPeriod };
  const advisorKey = `${user?.id}:${field.id}:${start}:${end}`;
  const hasAdvisorPeriod = !!selectClimatePeriod([], year, start, end);
  const storedDemo = demo && usesStoredDemoPower(field, year);
  const seasons = farms?.seasons.filter((s) => s.field_id === field.id) ?? [];
  return (
    <main className="page analytics">
      <Link to="/map" className="back-link">
        {t("← К карте хозяйства")}
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {t("ДАННЫЕ, КОТОРЫЕ ПОМОГАЮТ РЕШАТЬ")}
          </span>
          <h1>{demo ? t(field.name) : field.name}</h1>
          <p>
            {Number(field.area_hectares).toFixed(1)}
            {" " + t("га · Климатическая аналитика")}
          </p>
        </div>
        <div className="row">
          <select
            aria-label={t("Год наблюдений")}
            value={year}
            onChange={(e) => {
              const nextYear = Number(e.target.value);
              setYear(nextYear);
              setDates(suggestedSeason(nextYear, crop));
              setRefreshError("");
            }}
          >
            {(demo
              ? [2025]
              : Array.from(
                  { length: new Date().getUTCFullYear() - 1984 },
                  (_, i) => new Date().getUTCFullYear() - 1 - i,
                )
            ).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
          {!demo && climateTab && (
            <Button
              variant="outline"
              disabled={refreshing || query.isFetching || query.data?.pending}
              onClick={async () => {
                setRefreshing(true);
                setRefreshError("");
                try {
                  const { error } = await supabase!.functions.invoke(
                    "nasa-power",
                    { body: { fieldId, year, refresh: true } },
                  );
                  if (error) throw error;
                  await query.refetch();
                } catch (error) {
                  setRefreshError(await powerErrorMessage(error));
                } finally {
                  setRefreshing(false);
                }
              }}
            >
              {t("Обновить данные")}
            </Button>
          )}
          <Link className="button primary" to={"/rotation/" + field.id}>
            {t("Планировать севооборот") + " "}
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </div>
      {!demo && tab !== "ИИ-агроном" && hasAdvisorPeriod && (
        <ExplainAdvisor key={advisorKey} scope={advisorScope} />
      )}
      {climateTab && (
        <div className="data-note">
          <Sun size={18} />
          <div>
            <strong>
              {storedDemo
                ? t("NASA POWER · сохранённые наблюдения для Северного поля")
                : query.data?.metadata
                  ? `${query.data.metadata.source}${query.data.cached ? " " + t("· из кэша") : ""}`
                  : t("Климатические наблюдения NASA POWER")}
            </strong>
            <p>
              {storedDemo
                ? t(
                    "Сохранённый набор за 2025 год для исходной границы Северного поля.",
                  )
                : t(
                    "Данные климатической сетки для центра поля. Они не измеряют влажность или состав почвы на вашем участке.",
                  )}
            </p>
          </div>
        </div>
      )}
      <div className="tabs" role="tablist">
        {[
          "Климат",
          "Вода",
          "Календарь выращивания",
          "Растительность",
          "Почва",
          "Риски",
          "Источники",
          "ИИ-агроном",
        ].map((x) => (
          <button
            role="tab"
            aria-selected={tab === x}
            className={tab === x ? "active" : ""}
            onClick={() => setTab(x)}
            key={t(x)}
          >
            {x}
          </button>
        ))}
      </div>
      {climateTab && (
        <>
          {(query.isFetching || query.data?.pending) && (
            <p role="status">
              {t("Получаем наблюдения NASA POWER за") + " "}
              {year}
              {" " + t("год…")}
            </p>
          )}
          {refreshError && (
            <p role="alert" className="notice">
              {localize(refreshError)}
            </p>
          )}
          {!refreshError && !query.error && query.data?.warning && (
            <p role="alert" className="notice">
              {localize(query.data.warning)}
            </p>
          )}
          {!refreshError &&
            !query.error &&
            !query.data?.warning &&
            !rows.length &&
            !query.isFetching &&
            !query.data?.pending &&
            ["Климат", "Вода", "Риски"].includes(tab) && (
              <p className="notice">
                {t("Наблюдения NASA POWER за") + " "}
                {year}
                {" " + t("год недоступны.")}
              </p>
            )}
          {!refreshError && query.error && (
            <p role="alert" className="notice">
              {localize(query.error.message)}
            </p>
          )}
        </>
      )}
      {["Климат", "Растительность", "Вода", "Источники"].includes(tab) && (
        <section className="card">
          <div className="row">
            <label>
              {t("Период анализа")}
              <select
                value={climateMode}
                onChange={(e) =>
                  setClimateMode(e.target.value === "year" ? "year" : "season")
                }
              >
                <option value="season">{t("Вегетационный период")}</option>
                <option value="year">{t("Полный год")}</option>
              </select>
            </label>
            {climateMode === "season" && (
              <>
                <label>
                  {t("Культура")}
                  <select
                    value={crop}
                    onChange={(e) => {
                      const selected = e.target.value as SeasonCrop;
                      setCrop(selected);
                      setDates(suggestedSeason(year, selected));
                    }}
                  >
                    {Object.entries(cropSeasons).map(([id, option]) => (
                      <option key={id} value={id}>
                        {t(option.label)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Начало сезона")}
                  <input
                    type="date"
                    min={yearStart}
                    max={yearEnd}
                    value={dates.start}
                    onChange={(e) =>
                      setDates({ ...dates, start: e.target.value })
                    }
                  />
                </label>
                <label>
                  {t("Конец сезона")}
                  <input
                    type="date"
                    min={yearStart}
                    max={yearEnd}
                    value={dates.end}
                    onChange={(e) =>
                      setDates({ ...dates, end: e.target.value })
                    }
                  />
                </label>
              </>
            )}
          </div>
          {climateMode === "season" && (
            <p className="caption">
              {t(
                "Даты приведены для ориентира и не учитывают регион и сорт. Укажите фактические даты выращивания в пределах выбранного года.",
              )}
            </p>
          )}
          {climate ? (
            <>
              <p>
                {t("Период:")}{" "}
                <strong>
                  {start} — {end}
                </strong>
                . {tab === "Климат" && t("Исторические данные NASA POWER.")}
              </p>
              {tab === "Климат" &&
                (rows.length > 0 ||
                  (query.data &&
                    !query.isFetching &&
                    !query.data.pending &&
                    !query.data.warning)) && (
                  <p role="status">
                    {t("Доступно дней:") + " "}
                    {climate.available}
                    {" " + t("из") + " "}
                    {climate.days}.
                    {climate.absent + climate.partial > 0 &&
                      " " +
                        t(
                          "Пропуски: {0} дней без записей, {1} дней с неполным набором показателей. Расчёты используют доступные значения.",
                          climate.absent,
                          climate.partial,
                        )}
                  </p>
                )}
            </>
          ) : (
            <p role="alert" className="notice">
              {t("Укажите обе даты в пределах") + " "}
              {year}
              {" " + t("года. Начало сезона должно быть не позже конца.")}
            </p>
          )}
        </section>
      )}
      {tab === "Календарь выращивания" && (
        <GrowingCalendar
          key={field.id}
          field={field}
          owner={user?.id}
          demo={demo}
        />
      )}
      {tab === "Климат" && climate && (
        <FieldInsights
          title={t("Заключения по полю")}
          insights={[
            ...((query.isFetching || query.data?.pending) && !rows.length
              ? []
              : climateInsights(rows, insightPeriod)),
            ...fieldContextInsights(
              field,
              seasons,
              farms?.crops ?? [],
              insightPeriod,
              demo,
            ),
          ]}
        />
      )}
      {tab === "Климат" && climate && climate.available > 0 && (
        <>
          <div className="metric-grid">
            {(
              [
                [
                  Thermometer,
                  t("Средняя температура"),
                  fmt(climateStats.mean),
                  "°C",
                  t(
                    "Среднее за дни с данными показывает, насколько тёплым был выбранный период.",
                  ),
                ],
                [
                  Droplets,
                  t("Осадки за период"),
                  fmt(climateStats.rain),
                  t("мм"),
                  t(
                    "Сумма осадков за дни с данными. При пропусках фактическая сумма может быть выше.",
                  ),
                ],
                [
                  Sun,
                  t("Средняя радиация"),
                  fmt(climateStats.solar),
                  t("МДж/м²/сут"),
                  t(
                    "Сколько солнечной энергии в среднем получала поверхность за сутки.",
                  ),
                ],
                [
                  Thermometer,
                  t("Накопленное тепло (GDD)"),
                  fmt(climateGdd),
                  t("°C·сут"),
                  t(
                    "Сумма превышений средней температуры дня над 5 °C. Это общий ориентир, порог развития зависит от культуры.",
                  ),
                ],
                [
                  Droplets,
                  t("Влажность воздуха на 2 м"),
                  fmt(average(climateRows.map((row) => row.humidity ?? null))),
                  "%",
                  t(
                    "Средняя относительная влажность воздуха над поверхностью.",
                  ),
                ],
                [
                  Sun,
                  t("Скорость ветра на 2 м"),
                  fmt(
                    average(climateRows.map((row) => row.wind_speed ?? null)),
                  ),
                  t("м/с"),
                  t("Средняя скорость ветра. По ней нельзя судить о порывах."),
                ],
                [
                  Thermometer,
                  t("Минимум / максимум"),
                  `${fmt(climateStats.min)} / ${fmt(climateStats.max)}`,
                  "°C",
                  t(
                    "Самая низкая и самая высокая температуры среди доступных суточных значений.",
                  ),
                ],
              ] as const
            ).map(([Icon, label, value, unit, explanation]) => (
              <div className="card metric" key={label}>
                <div>
                  <span>{label}</span>
                  <Icon size={18} />
                </div>
                <strong>
                  {value} <small>{unit}</small>
                </strong>
                <p className="caption">{explanation}</p>
              </div>
            ))}
          </div>
          <div className="chart-grid">
            <section className="card">
              <h3>{t("Температура за выбранный период")}</h3>
              <p>{t("Средние месячные значения · °C")}</p>
              <ResponsiveContainer width="100%" height={270}>
                <AreaChart data={climate.series}>
                  <defs>
                    <linearGradient
                      id="climate-fill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#62d68b"
                        stopOpacity={0.35}
                      />
                      <stop offset="100%" stopColor="#62d68b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#edf1ed" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    width={30}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip />
                  <Area
                    name={t("Температура, °C")}
                    dataKey="temperature"
                    stroke="#4eaa6e"
                    fill="url(#climate-fill)"
                    strokeWidth={2}
                    connectNulls={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </section>
            <section className="card">
              <h3>{t("Распределение осадков")}</h3>
              <p>{t("Сумма за выбранные дни каждого месяца · мм")}</p>
              <ResponsiveContainer width="100%" height={270}>
                <BarChart data={climate.series}>
                  <CartesianGrid vertical={false} stroke="#edf1ed" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    width={30}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip />
                  <Bar
                    name={t("Осадки, мм")}
                    dataKey="rain"
                    fill="#94b6a0"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </section>
          </div>
          <p className="caption">
            {t(
              "NASA POWER · Сетка: метеоданные 0.5° × 0.625°, радиация 1° × 1°. «—» означает, что для показателя нет данных за выбранные даты.",
            )}
          </p>
          {!demo && climateMode === "year" && (
            <section className="card">
              <h3>{t("Сравнение сохранённых лет")}</h3>
              <p>
                {t(
                  "Полные ряды по температуре и осадкам. Квартальные значения приведены в порядке январь–март, апрель–июнь, июль–сентябрь, октябрь–декабрь.",
                )}
              </p>
              {history.length ? (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Год")}</th>
                        <th>{t("Средняя, °C")}</th>
                        <th>{t("Осадки, мм")}</th>
                        <th>{t("Температура по кварталам, °C")}</th>
                        <th>{t("Осадки по кварталам, мм")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map(
                        ({ analysis_period, climate_metrics: m }) => (
                          <tr key={analysis_period}>
                            <td>{analysis_period}</td>
                            <td>
                              {fmt(
                                m.temperatureDays === m.expectedDays
                                  ? m.mean
                                  : null,
                              )}
                            </td>
                            <td>
                              {fmt(
                                m.rainDays === m.expectedDays ? m.rain : null,
                              )}
                            </td>
                            <td>
                              {m.seasons?.map((s) => fmt(s.mean)).join(" / ")}
                            </td>
                            <td>
                              {m.seasons?.map((s) => fmt(s.rain)).join(" / ")}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>{t("Сравнение появится после сохранения наблюдений.")}</p>
              )}
              <p>
                {t(
                  "Отклонение от среднего по предыдущим сохранённым годам: температура",
                )}{" "}
                {fmt(
                  tempBaseline !== null &&
                    metrics.mean !== null &&
                    metrics.temperatureDays === expectedDays
                    ? metrics.mean - tempBaseline
                    : null,
                )}{" "}
                {t("°C, осадки")}{" "}
                {fmt(
                  rainBaseline !== null &&
                    metrics.rain !== null &&
                    metrics.rainDays === expectedDays
                    ? metrics.rain - rainBaseline
                    : null,
                )}{" "}
                {t(
                  "мм. Для каждого показателя нужны минимум три полных предыдущих года из десяти последних сохранённых.",
                )}
              </p>
            </section>
          )}
        </>
      )}
      {tab === "Вода" && (
        <div className="chart-grid">
          <section className="card">
            <Droplets color="#719d85" />
            <h2>{t("Водный режим")}</h2>
            <p>
              {t("Орошение:") + " "}
              {localize(field.irrigation_type) || t("не указано")}
            </p>
            {seasons.map((s) => (
              <p key={s.id}>
                {s.year}: {s.irrigation_amount_mm ?? t("не указано")}
                {" " + t("мм по записи фермера")}
              </p>
            ))}
            {rows.length > 0 && (
              <p>
                {t("Самый длинный период с осадками менее 1 мм/сут:")}{" "}
                <strong>
                  {metrics.longestDry ?? "—"}
                  {" " + t("дней")}
                </strong>
                {t(". Пропуски прерывают расчёт.")}
              </p>
            )}
          </section>
          <section className="card">
            <h2>{t("Что эти данные означают")}</h2>
            <p>
              {t(
                "Осадки не равны доступной растениям воде. Для оценки полива нужны испарение, тип почвы, стадия развития и местные измерения.",
              )}
            </p>
            <p>{t("Фактическая влажность почвы не измеряется.")}</p>
          </section>
        </div>
      )}
      {tab === "Вода" && climate && (
        <FieldDataSources
          field={field}
          period={insightPeriod}
          selected={waterSources}
        />
      )}
      {tab === "Источники" && climate && (
        <>
          <p>
            {t("Выборки для границы этого поля за") + " "}
            {start} — {end}
            {t(
              ". Снимки и модельные оценки описывают отдельные дни или ячейки.",
            )}
          </p>
          <FieldDataSources
            field={field}
            period={insightPeriod}
            selected={satelliteSources}
          />
        </>
      )}
      {tab === "Растительность" && (
        <VegetationAnalytics
          field={field}
          year={year}
          ownerId={user?.id}
          demo={demo}
          insightPeriod={insightPeriod}
        />
      )}
      {hasAdvisorPeriod && (
        <div hidden={tab !== "ИИ-агроном"}>
          <AiAdvisorChat key={advisorKey} scope={advisorScope} demo={demo} />
        </div>
      )}
      {tab === "ИИ-агроном" && !hasAdvisorPeriod && (
        <p role="status">
          {t("Выберите корректный период на вкладке «Климат».")}
        </p>
      )}
      {tab === "Почва" && (
        <section className="card">
          <h2>{t("Почва вашего поля")}</h2>
          <p>
            {t("Тип почвы:") + " "}
            <strong>{localize(field.soil_type) || t("не указан")}</strong>
          </p>
          <p>{t("Ручной тип почвы указан хозяйством.")}</p>
          <SoilEstimate boundary={field.boundary} />
          <Link className="button outline" to="/farms">
            {t("Дополнить сведения →")}
          </Link>
        </section>
      )}
      {tab === "Почва" && (
        <TerrainAnalytics field={field} ownerId={user?.id} demo={demo} />
      )}
      {tab === "Почва" && (
        <FieldDataSources
          field={field}
          period={insightPeriod}
          selected={["srtm"]}
        />
      )}
      {tab === "Риски" && rows.length > 0 && (
        <div className="chart-grid">
          {[
            [
              t("Сухие периоды"),
              t("{0} дней подряд", metrics.longestDry ?? "—"),
              t(
                "Максимальная серия дней с осадками < 1 мм. Пропуски и отсутствующие даты прерывают серию.",
              ),
            ],
            [
              t("Температурный стресс"),
              t("{0} жарких дней", metrics.hotDays ?? "—"),
              t(
                "Количество наблюдаемых дней с максимальной температурой > 35 °C. Порог является скрининговым, а не пределом конкретной культуры.",
              ),
            ],
            [
              t("Заморозки"),
              t("{0} дней", metrics.frostDays ?? "—"),
              t("Количество дней с минимальной температурой ниже 0 °C."),
            ],
            [
              t("Сильные осадки"),
              t("{0} дней", metrics.heavyRainDays ?? "—"),
              t("Количество дней с осадками не менее 20 мм."),
            ],
          ].map(([title, value, method]) => (
            <section className="card" key={title}>
              <AlertTriangle color="#d59d51" />
              <h2>{title}</h2>
              <strong>{value}</strong>
              <p>{method}</p>
              <p>
                NASA POWER · {period} · 0.5° × 0.625° · {rows.length}/
                {expectedDays}
                {" " +
                  t(
                    "дат. Подсчёт по доступным значениям. Климатическая сетка может не отражать микроклимат поля. Уязвимость зависит от культуры и фазы роста; вероятность ущерба не рассчитывается.",
                  )}
              </p>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
