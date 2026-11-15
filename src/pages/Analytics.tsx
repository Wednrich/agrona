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
    params.get("tab") === "advisor" ? "ИИ-агроном" : params.get("tab") === "sources" ? "Источники" : "Климат",
  );
  const climateTab = !["Растительность", "Источники"].includes(tab);
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
      if (!supabase) throw new Error("Supabase не настроен");
      const { data, error } = await supabase.functions.invoke("nasa-power", {
        body: { fieldId, year },
      });
      if (error) throw new Error(await powerErrorMessage(error));
      if (data?.error) throw new Error(data.error);
      return data;
    },
  });
  if (isLoading) return <div className="page">Загрузка…</div>;
  if (farmsError) return <div className="page error">{farmsError.message}</div>;
  if (!field) return <FieldPicker title="Аналитика полей" route="analytics" />;
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
        ← К карте хозяйства
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ДАННЫЕ, КОТОРЫЕ ПОМОГАЮТ РЕШАТЬ</span>
          <h1>{field.name}</h1>
          <p>
            {Number(field.area_hectares).toFixed(1)} га · Климатическая
            аналитика
          </p>
        </div>
        <div className="row">
          <select
            aria-label="Год наблюдений"
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
              Обновить данные
            </Button>
          )}
          <Link className="button primary" to={"/rotation/" + field.id}>
            Планировать севооборот <ArrowUpRight size={16} />
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
                ? "NASA POWER · сохранённые наблюдения для Северного поля"
                : query.data?.metadata
                  ? `${query.data.metadata.source}${query.data.cached ? " · из кэша" : ""}`
                  : "Климатические наблюдения NASA POWER"}
            </strong>
            <p>
              {storedDemo
                ? "Сохранённый набор за 2025 год для исходной границы Северного поля."
                : "Данные климатической сетки для центра поля. Они не измеряют влажность или состав почвы на вашем участке."}
            </p>
          </div>
        </div>
      )}
      <div className="tabs" role="tablist">
        {[
          "Климат",
          "Вода",
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
            key={x}
          >
            {x}
          </button>
        ))}
      </div>
      {climateTab && (
        <>
          {(query.isFetching || query.data?.pending) && (
            <p role="status">Получаем наблюдения NASA POWER за {year} год…</p>
          )}
          {refreshError && (
            <p role="alert" className="notice">
              {refreshError}
            </p>
          )}
          {!refreshError && !query.error && query.data?.warning && (
            <p role="alert" className="notice">
              {query.data.warning}
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
                Наблюдения NASA POWER за {year} год недоступны.
              </p>
            )}
          {!refreshError && query.error && (
            <p role="alert" className="notice">
              {query.error.message}
            </p>
          )}
        </>
      )}
      {["Климат", "Растительность", "Вода", "Источники"].includes(tab) && (
        <section className="card">
          <div className="row">
            <label>
              Период анализа
              <select
                value={climateMode}
                onChange={(e) =>
                  setClimateMode(e.target.value === "year" ? "year" : "season")
                }
              >
                <option value="season">Вегетационный период</option>
                <option value="year">Полный год</option>
              </select>
            </label>
            {climateMode === "season" && (
              <>
                <label>
                  Культура
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
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Начало сезона
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
                  Конец сезона
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
              Даты приведены для ориентира и не учитывают регион и сорт. Укажите
              фактические даты выращивания в пределах выбранного года.
            </p>
          )}
          {climate ? (
            <>
              <p>
                Период:{" "}
                <strong>
                  {start} — {end}
                </strong>
                . {tab === "Климат" && "Исторические данные NASA POWER."}
              </p>
              {tab === "Климат" &&
                (rows.length > 0 ||
                  (query.data &&
                    !query.isFetching &&
                    !query.data.pending &&
                    !query.data.warning)) && (
                  <p role="status">
                    Доступно дней: {climate.available} из {climate.days}.
                    {climate.absent + climate.partial > 0 &&
                      ` Пропуски: ${climate.absent} дней без записей, ${climate.partial} дней с неполным набором показателей. Расчёты используют доступные значения.`}
                  </p>
                )}
            </>
          ) : (
            <p role="alert" className="notice">
              Укажите обе даты в пределах {year} года. Начало сезона должно быть
              не позже конца.
            </p>
          )}
        </section>
      )}
      {tab === "Климат" && climate && (
        <FieldInsights
          title="Заключения по полю"
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
                  "Средняя температура",
                  fmt(climateStats.mean),
                  "°C",
                  "Среднее за дни с данными показывает, насколько тёплым был выбранный период.",
                ],
                [
                  Droplets,
                  "Осадки за период",
                  fmt(climateStats.rain),
                  "мм",
                  "Сумма осадков за дни с данными. При пропусках фактическая сумма может быть выше.",
                ],
                [
                  Sun,
                  "Средняя радиация",
                  fmt(climateStats.solar),
                  "МДж/м²/сут",
                  "Сколько солнечной энергии в среднем получала поверхность за сутки.",
                ],
                [
                  Thermometer,
                  "Накопленное тепло (GDD)",
                  fmt(climateGdd),
                  "°C·сут",
                  "Сумма превышений средней температуры дня над 5 °C. Это общий ориентир, порог развития зависит от культуры.",
                ],
                [
                  Droplets,
                  "Влажность воздуха на 2 м",
                  fmt(average(climateRows.map((row) => row.humidity ?? null))),
                  "%",
                  "Средняя относительная влажность воздуха над поверхностью.",
                ],
                [
                  Sun,
                  "Скорость ветра на 2 м",
                  fmt(
                    average(climateRows.map((row) => row.wind_speed ?? null)),
                  ),
                  "м/с",
                  "Средняя скорость ветра. По ней нельзя судить о порывах.",
                ],
                [
                  Thermometer,
                  "Минимум / максимум",
                  `${fmt(climateStats.min)} / ${fmt(climateStats.max)}`,
                  "°C",
                  "Самая низкая и самая высокая температуры среди доступных суточных значений.",
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
              <h3>Температура за выбранный период</h3>
              <p>Средние месячные значения · °C</p>
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
                    name="Температура, °C"
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
              <h3>Распределение осадков</h3>
              <p>Сумма за выбранные дни каждого месяца · мм</p>
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
                    name="Осадки, мм"
                    dataKey="rain"
                    fill="#94b6a0"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </section>
          </div>
          <p className="caption">
            NASA POWER · Сетка: метеоданные 0.5° × 0.625°, радиация 1° × 1°. «—»
            означает, что для показателя нет данных за выбранные даты.
          </p>
          {!demo && climateMode === "year" && (
            <section className="card">
              <h3>Сравнение сохранённых лет</h3>
              <p>
                Полные ряды по температуре и осадкам. Квартальные значения
                приведены в порядке январь–март, апрель–июнь, июль–сентябрь,
                октябрь–декабрь.
              </p>
              {history.length ? (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Год</th>
                        <th>Средняя, °C</th>
                        <th>Осадки, мм</th>
                        <th>Температура по кварталам, °C</th>
                        <th>Осадки по кварталам, мм</th>
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
                <p>Сравнение появится после сохранения наблюдений.</p>
              )}
              <p>
                Отклонение от среднего по предыдущим сохранённым годам:
                температура{" "}
                {fmt(
                  tempBaseline !== null &&
                    metrics.mean !== null &&
                    metrics.temperatureDays === expectedDays
                    ? metrics.mean - tempBaseline
                    : null,
                )}{" "}
                °C, осадки{" "}
                {fmt(
                  rainBaseline !== null &&
                    metrics.rain !== null &&
                    metrics.rainDays === expectedDays
                    ? metrics.rain - rainBaseline
                    : null,
                )}{" "}
                мм. Для каждого показателя нужны минимум три полных предыдущих
                года из десяти последних сохранённых.
              </p>
            </section>
          )}
        </>
      )}
      {tab === "Вода" && (
        <div className="chart-grid">
          <section className="card">
            <Droplets color="#719d85" />
            <h2>Водный режим</h2>
            <p>Орошение: {field.irrigation_type || "не указано"}</p>
            {seasons.map((s) => (
              <p key={s.id}>
                {s.year}: {s.irrigation_amount_mm ?? "не указано"} мм по записи
                фермера
              </p>
            ))}
            {rows.length > 0 && (
              <p>
                Самый длинный период с осадками менее 1 мм/сут:{" "}
                <strong>{metrics.longestDry ?? "—"} дней</strong>. Пропуски
                прерывают расчёт.
              </p>
            )}
          </section>
          <section className="card">
            <h2>Что эти данные означают</h2>
            <p>
              Осадки не равны доступной растениям воде. Для оценки полива нужны
              испарение, тип почвы, стадия развития и местные измерения.
            </p>
            <p>Фактическая влажность почвы не измеряется.</p>
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
            Выборки для границы этого поля за {start} — {end}. Снимки и
            модельные оценки описывают отдельные дни или ячейки.
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
        <p role="status">Выберите корректный период на вкладке «Климат».</p>
      )}
      {tab === "Почва" && (
        <section className="card">
          <h2>Почва вашего поля</h2>
          <p>
            Тип почвы: <strong>{field.soil_type || "не указан"}</strong>
          </p>
          <p>Ручной тип почвы указан хозяйством.</p>
          <SoilEstimate boundary={field.boundary} />
          <Link className="button outline" to="/farms">
            Дополнить сведения →
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
              "Сухие периоды",
              `${metrics.longestDry ?? "—"} дней подряд`,
              "Максимальная серия дней с осадками < 1 мм. Пропуски и отсутствующие даты прерывают серию.",
            ],
            [
              "Температурный стресс",
              `${metrics.hotDays ?? "—"} жарких дней`,
              "Количество наблюдаемых дней с максимальной температурой > 35 °C. Порог является скрининговым, а не пределом конкретной культуры.",
            ],
            [
              "Заморозки",
              `${metrics.frostDays ?? "—"} дней`,
              "Количество дней с минимальной температурой ниже 0 °C.",
            ],
            [
              "Сильные осадки",
              `${metrics.heavyRainDays ?? "—"} дней`,
              "Количество дней с осадками не менее 20 мм.",
            ],
          ].map(([title, value, method]) => (
            <section className="card" key={title}>
              <AlertTriangle color="#d59d51" />
              <h2>{title}</h2>
              <strong>{value}</strong>
              <p>{method}</p>
              <p>
                NASA POWER · {period} · 0.5° × 0.625° · {rows.length}/
                {expectedDays} дат. Подсчёт по доступным значениям.
                Климатическая сетка может не отражать микроклимат поля.
                Уязвимость зависит от культуры и фазы роста; вероятность ущерба
                не рассчитывается.
              </p>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
