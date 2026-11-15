import { rotationClimateKey } from "../lib/field-write";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Droplets,
  Leaf,
  ShieldCheck,
  Coins,
  ArrowRight,
  Bookmark,
} from "lucide-react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  generateRotations,
  rotationWeights,
  type RotationDiagnostics,
} from "../features/rotation";
import { summarizeRotationClimate } from "../features/rotation-climate";
import { loadRotationPower } from "../features/rotation-power";
import { selectClimatePeriod, suggestedSeason } from "../features/climate";
import { loadDemoPower } from "../features/demo-power";
import { FieldPicker } from "../components/FieldPicker";
import type { Scenario } from "../lib/types";
import { Button } from "../components/ui/button";
import SoilEstimate, { cachedSoil } from "../components/SoilEstimate";
export default function Rotation() {
  const { fieldId } = useParams();
  const [params] = useSearchParams();
  const startsWithPlan = params.get("mode") === "plan";
  return (
    <RotationForm
      key={`${fieldId}:${startsWithPlan}`}
      fieldId={fieldId}
      startsWithPlan={startsWithPlan}
    />
  );
}

function RotationForm({
  fieldId,
  startsWithPlan,
}: {
  fieldId?: string;
  startsWithPlan: boolean;
}) {
  const { data, error, isLoading, save } = useData();
  const { demo, user } = useAuth();
  const field = data?.fields.find((f) => f.id === fieldId);
  const [step, setStep] = useState(1);
  const [goals, setGoals] = useState(["soil", "water"]);
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [horizon, setHorizon] = useState(3);
  const [irrigation, setIrrigation] = useState<boolean | null>(null);
  const latestYear = new Date().getUTCFullYear() - 1;
  const [year, setYear] = useState(() => (demo ? 2025 : latestYear));
  const [dates, setDates] = useState(() => suggestedSeason(year, "other"));
  const [days, setDays] = useState(150);
  const [manualSequence, setManualSequence] = useState<string[]>([]);
  const [currentPlan, setCurrentPlan] = useState(
    startsWithPlan ? "manual" : "",
  );
  const [fixedYears, setFixedYears] = useState<number[]>([]);
  const [resultRevision, setResultRevision] = useState("");
  const fingerprint = field ? JSON.stringify(field.boundary) : "";
  const inputRevision = JSON.stringify([
    field?.boundary,
    field?.soil_type,
    field?.irrigation_type,
    data?.seasons.filter((s) => s.field_id === fieldId),
    data?.crops,
  ]);
  const resultKey = JSON.stringify([
    demo ? "demo" : user?.id,
    fieldId,
    inputRevision,
  ]);
  const activeStep = resultRevision === resultKey ? step : 1;
  const backLink = useRef<HTMLAnchorElement>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const lastStep = useRef(activeStep);
  useEffect(() => {
    if (!field?.id || !pageHeading.current) return;
    pageHeading.current.focus({ preventScroll: true });
    backLink.current?.scrollIntoView?.({ block: "start" });
  }, [field?.id]);
  useEffect(() => {
    if (lastStep.current === activeStep) return;
    lastStep.current = activeStep;
    const heading =
      activeStep === 1 ? formHeading.current : resultHeading.current;
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView?.({ block: "start" });
  }, [activeStep]);
  const selectedPeriod = selectClimatePeriod([], year, dates.start, dates.end);
  const [strategies, setStrategies] = useState<Scenario[]>([]);
  const [sameSequences, setSameSequences] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const climate = useQuery({
    queryKey: [...rotationClimateKey(demo ? "demo" : user?.id, field), year],
    enabled:
      !!field && Number.isInteger(year) && year >= 1984 && year <= latestYear,
    retry: false,
    staleTime: 300000,
    queryFn: async ({ signal }) => {
      if (demo && field) return (await loadDemoPower(field, year)).observations;
      if (!supabase || !field) return [];
      return loadRotationPower(
        supabase.functions.invoke.bind(supabase.functions),
        field.id,
        year,
        fingerprint,
        signal,
      );
    },
  });
  if (isLoading) return <div className="page">Загрузка…</div>;
  if (error) return <div className="page error">{error.message}</div>;
  if (!field || !data)
    return <FieldPicker title="Планирование севооборота" route="rotation" />;
  const ids = allowed ?? data.crops.map((c) => c.id);
  const water =
    irrigation ??
    (!!field.irrigation_type &&
      !["Без орошения", "Не знаю"].includes(field.irrigation_type));
  const history = data.seasons.filter((s) => s.field_id === fieldId);
  const plans = data.scenarios.filter(
    (plan) =>
      plan.field_id === field.id &&
      plan.crop_sequence.length >= 2 &&
      plan.crop_sequence.length <= 20 &&
      plan.crop_sequence.every((id) =>
        data.crops.some((crop) => crop.id === id),
      ),
  );
  const selectedPlan = plans.find((plan) => plan.id === currentPlan);
  const overview = selectedPeriod
    ? summarizeRotationClimate(climate.data ?? [], { year, ...dates })
    : null;
  function generate() {
    try {
      const plan = plans.find((plan) => plan.id === currentPlan);
      if (
        currentPlan === "manual" &&
        (manualSequence.slice(0, horizon).length !== horizon ||
          manualSequence
            .slice(0, horizon)
            .some((id) => !data!.crops.some((c) => c.id === id)))
      )
        throw new Error("Выберите культуру для каждого года плана.");
      const constraints = {
        allowed: ids,
        excluded,
        horizon,
        irrigation: water,
        maxSeasonDays: days,
        soilType: field!.soil_type,
        soilEstimateAvailable: !!cachedSoil(field!.boundary),
        period: { year, ...dates },
        inputRevision,
        sourceSnapshot: {
          weather: {
            dataset: "NASA POWER daily-ag-v2",
            observations: climate.data ?? [],
            period: { year, ...dates },
          },
          crops: data!.crops,
          boundary: field!.boundary,
          soil: cachedSoil(field!.boundary),
        },
        fixedCrops:
          currentPlan === "manual"
            ? Object.fromEntries(
                fixedYears
                  .filter((i) => i < horizon)
                  .map((i) => [i, manualSequence[i]]),
              )
            : {},
        currentSequence:
          currentPlan === "manual"
            ? manualSequence.slice(0, horizon)
            : plan?.crop_sequence,
        currentName: currentPlan === "manual" ? "Мой план" : plan?.name,
      };
      const diagnostics = import.meta.env.DEV
        ? (details: RotationDiagnostics) => {
            console.debug("[AGRONA rotation]", {
              strategySource: "generateRotations",
              fieldDataSource: demo ? "demo" : "supabase",
              climateDataSource: climate.data?.length
                ? demo
                  ? "bundled-nasa-power"
                  : "nasa-power-cache"
                : climate.isError
                  ? "unavailable"
                  : "no-matching-cache",
              historySeasons: history.length,
              soilProvided:
                !!constraints.soilType && constraints.soilType !== "Не знаю",
              irrigationEnabled: water,
              priorities: goals,
              ...details,
            });
          }
        : undefined;
      const result = generateRotations(
        data!.crops,
        history,
        field!.id,
        goals,
        constraints,
        climate.data ?? [],
        diagnostics,
      );
      setSameSequences(
        resultRevision === resultKey &&
          strategies.length > 0 &&
          JSON.stringify(strategies[0].priorities) !== JSON.stringify(goals) &&
          JSON.stringify(
            strategies.map((strategy) => [
              strategy.name,
              strategy.crop_sequence,
            ]),
          ) ===
            JSON.stringify(
              result.map((strategy) => [strategy.name, strategy.crop_sequence]),
            ),
      );
      setStrategies(result);
      setResultRevision(resultKey);
      setSaved([]);
      setStep(2);
      setMessage("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }
  const fieldOverview = (
    <aside className="card rotation-overview" aria-label="Данные о поле">
      <h2>Данные о поле</h2>
      <details
        className="flow-details"
        key={currentPlan ? "plan" : "explore"}
        open={!currentPlan}
      >
        <summary>Почва и погода</summary>
        <SoilEstimate boundary={field.boundary} />
        <p>
          {field.soil_type || "Ручное уточнение почвы отсутствует"} ·{" "}
          {field.irrigation_type || "Орошение неизвестно"}
        </p>
        <p>
          NASA POWER · {dates.start} — {dates.end}. Погодная сетка 0,5° × 0,625°
          у центра поля, не измерения на участке.
        </p>
        {climate.isFetching ? (
          <p role="status">Загружаем историю погоды NASA POWER…</p>
        ) : (
          overview && (
            <p>
              Осадки за дни с данными:{" "}
              {overview.rain === null
                ? "нет данных"
                : `${overview.rain.toFixed(1)} мм`}
              . Покрытие осадков: {overview.coverage.rain} из {overview.days}{" "}
              дней. Средняя температура:{" "}
              {overview.mean === null
                ? "нет данных"
                : `${overview.mean.toFixed(1)} °C`}
              .
            </p>
          )
        )}
        {overview &&
          Object.values(overview.coverage).some((n) => n < overview.days) &&
          !climate.isFetching && (
            <p>
              Ряд неполный. Пропуски не считаются нулевыми осадками;
              климатические выводы ограничены.
            </p>
          )}
        {climate.error && <p role="alert">{climate.error.message}</p>}
        {climate.isError && (
          <Button variant="outline" onClick={() => void climate.refetch()}>
            Повторить загрузку погоды
          </Button>
        )}
      </details>
      <div className="rotation-history">
        <Link to={`/farms?history=${encodeURIComponent(field.id)}`}>
          {history.length ? "История посевов" : "Добавить историю посевов"}
        </Link>
        {!history.length && (
          <p>
            Истории посевов пока нет. Если прошлые посевы неизвестны, можно
            перейти к плану на будущие годы.
          </p>
        )}
      </div>
    </aside>
  );
  return (
    <main className="page rotation">
      <Link
        className="back-link"
        ref={backLink}
        to={`/map?field=${encodeURIComponent(field.id)}`}
      >
        ← К полю
      </Link>
      <header className="page-heading rotation-heading">
        <div>
          <h1 ref={pageHeading} tabIndex={-1}>
            Севооборот
          </h1>
          <p>
            {field.name} ·{" "}
            {Number(field.area_hectares).toLocaleString("ru-RU", {
              maximumFractionDigits: 1,
            })}{" "}
            га
          </p>
        </div>
      </header>
      {resultRevision && resultRevision !== resultKey && (
        <p role="status">
          Условия поля изменились. Сформируйте сравнение заново.
        </p>
      )}
      {activeStep === 1 ? (
        <div
          className={`rotation-workspace${currentPlan ? "" : " rotation-explore"}`}
        >
          {!currentPlan && fieldOverview}
          <div className="rotation-inputs">
            <section className="card rotation-plan">
              <h2 ref={formHeading} tabIndex={-1}>
                {currentPlan ? "Ваш план по годам" : "Подбор вариантов"}
              </h2>
              <div className="form-grid">
                <label>
                  Текущий план для сравнения
                  <select
                    value={
                      currentPlan === "manual"
                        ? "manual"
                        : (selectedPlan?.id ?? "")
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      setCurrentPlan(value);
                      const plan = plans.find((item) => item.id === value);
                      if (plan) setHorizon(plan.crop_sequence.length);
                    }}
                  >
                    <option value="">
                      Плана пока нет — посмотреть варианты
                    </option>
                    <option value="manual">Ввести мой план по годам</option>
                    {plans.map(
                      (plan) =>
                        plan.id && (
                          <option key={plan.id} value={plan.id}>
                            {plan.name}
                          </option>
                        ),
                    )}
                  </select>
                </label>
                <label>
                  На сколько лет
                  <select
                    value={horizon}
                    onChange={(e) => {
                      if (selectedPlan) {
                        setCurrentPlan("manual");
                        setManualSequence(selectedPlan.crop_sequence);
                        setFixedYears([]);
                      }
                      setHorizon(Number(e.target.value));
                    }}
                  >
                    {Array.from({ length: 19 }, (_, i) => i + 2).map(
                      (length) => (
                        <option key={length}>{length}</option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              {currentPlan === "manual" && (
                <div className="plan-years">
                  {Array.from({ length: horizon }, (_, i) => (
                    <div className="plan-year" key={i}>
                      <label>
                        Год {i + 1}
                        <select
                          aria-label={`Культура на год ${i + 1}`}
                          value={manualSequence[i] ?? ""}
                          onChange={(event) => {
                            const crop = event.target.value;
                            setManualSequence((previous) =>
                              Array.from(
                                { length: Math.max(horizon, previous.length) },
                                (_, index) =>
                                  index === i ? crop : (previous[index] ?? ""),
                              ),
                            );
                          }}
                        >
                          <option value="">Выберите культуру</option>
                          {data.crops.map((crop) => (
                            <option key={crop.id} value={crop.id}>
                              {crop.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          disabled={!manualSequence[i]}
                          checked={fixedYears.includes(i)}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setFixedYears((previous) =>
                              checked
                                ? [...previous, i]
                                : previous.filter((year) => year !== i),
                            );
                          }}
                        />
                        Оставить в альтернативах
                      </label>
                    </div>
                  ))}
                </div>
              )}
              {selectedPlan && (
                <p>
                  {selectedPlan.crop_sequence
                    .map(
                      (id) => data.crops.find((crop) => crop.id === id)?.name,
                    )
                    .join(" → ")}
                </p>
              )}
            </section>
            <section className="card rotation-goals">
              <h2>Что для вас важно?</h2>
              <p>Выберите цели для сравнения вариантов.</p>
              <div className="goal-grid">
                {[
                  [
                    "water",
                    "Экономить воду",
                    "Учитывать потребность культур в воде",
                    Droplets,
                  ],
                  [
                    "soil",
                    "Здоровье почвы",
                    "Разнообразие семейств и бобовые",
                    Leaf,
                  ],
                  [
                    "climate",
                    "Снизить климатический риск",
                    "Учитывать доступную историю погоды",
                    ShieldCheck,
                  ],
                  [
                    "economy",
                    "Экономическая устойчивость",
                    "Выявить, каких данных о затратах не хватает",
                    Coins,
                  ],
                ].map(([id, title, description, Icon]) => {
                  const I = Icon as typeof Leaf;
                  return (
                    <button
                      key={String(id)}
                      aria-pressed={goals.includes(String(id))}
                      className={
                        "goal " + (goals.includes(String(id)) ? "selected" : "")
                      }
                      onClick={() => {
                        const key = String(id);
                        setGoals(
                          goals.includes(key)
                            ? goals.filter((g) => g !== key)
                            : [...goals, key],
                        );
                      }}
                    >
                      <I />
                      <strong>{String(title)}</strong>
                      <span>{String(description)}</span>
                      <i>{goals.includes(String(id)) ? "✓" : "+"}</i>
                    </button>
                  );
                })}
              </div>
            </section>
            <details className="card flow-details rotation-settings">
              <summary>Настройки сезона и ограничения</summary>
              <div className="form-grid">
                <label>
                  Длина доступного сезона, дней
                  <input
                    type="number"
                    min={1}
                    max={366}
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  />
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={water}
                    onChange={(e) => setIrrigation(e.target.checked)}
                  />{" "}
                  Доступно орошение
                </label>
              </div>
              <p className="caption">
                Если доступность полива неизвестна, оставьте отметку снятой:
                наличие достаточного объёма воды не предполагается.
              </p>
              <h3>Исторический сезон NASA POWER</h3>
              <div className="form-grid">
                <label>
                  Год наблюдений
                  <input
                    type="number"
                    min={1984}
                    max={latestYear}
                    value={year}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setYear(next);
                      setDates(suggestedSeason(next, "other"));
                    }}
                  />
                </label>
                <label>
                  Начало периода
                  <input
                    type="date"
                    value={dates.start}
                    onChange={(event) =>
                      setDates({ ...dates, start: event.target.value })
                    }
                  />
                </label>
                <label>
                  Конец периода
                  <input
                    type="date"
                    value={dates.end}
                    onChange={(event) =>
                      setDates({ ...dates, end: event.target.value })
                    }
                  />
                </label>
              </div>
              <p className="caption">
                При подборе культур учитывается меньшая из двух величин: длина
                доступного сезона и длительность выбранного периода.
              </p>
              <h3>Культуры для подбора</h3>
              <div className="crop-options">
                {data.crops.map((crop) => (
                  <label className="check-label" key={crop.id}>
                    <input
                      type="checkbox"
                      checked={
                        ids.includes(crop.id) && !excluded.includes(crop.id)
                      }
                      onChange={(event) => {
                        if (event.target.checked) {
                          setAllowed([
                            ...ids.filter((id) => id !== crop.id),
                            crop.id,
                          ]);
                          setExcluded(excluded.filter((id) => id !== crop.id));
                        } else {
                          setAllowed(ids.filter((id) => id !== crop.id));
                        }
                      }}
                    />
                    {crop.name}
                  </label>
                ))}
              </div>
            </details>
            {!selectedPeriod && (
              <p className="error">
                В настройках сезона укажите даты в пределах выбранного года.
              </p>
            )}
            {(!Number.isInteger(days) || days < 1 || days > 366) && (
              <p className="error">
                В настройках укажите длину сезона от 1 до 366 дней.
              </p>
            )}
            <div className="rotation-submit">
              {message && (
                <p role="status" className="rotation-message">
                  {message}
                </p>
              )}
              <Button
                disabled={
                  climate.isFetching ||
                  !selectedPeriod ||
                  !Number.isInteger(year) ||
                  year < 1984 ||
                  year > latestYear ||
                  !Number.isInteger(days) ||
                  days < 1 ||
                  days > 366
                }
                onClick={generate}
              >
                {climate.isFetching
                  ? "Загружаем погоду…"
                  : currentPlan
                    ? "Сравнить планы"
                    : "Подобрать варианты"}{" "}
                <ArrowRight size={16} />
              </Button>
            </div>
          </div>
          {currentPlan && fieldOverview}
        </div>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <h2 ref={resultHeading} tabIndex={-1}>
                {strategies[0]?.constraints.currentSequence
                  ? "Сравнение планов"
                  : "Варианты для поля"}
              </h2>
              <p>
                Для решения о посеве уточните сорт и местные сроки посева и
                уборки.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setStep(1);
                setMessage("");
              }}
            >
              Изменить план и цели
            </Button>
          </div>
          {message && (
            <p role="status" className="rotation-message">
              {message}
            </p>
          )}
          {!!strategies.length && sameSequences && (
            <p className="notice">
              После пересчёта последовательности остались прежними.
            </p>
          )}
          {!strategies.length && (
            <p className="notice" role="status">
              Ни одна культура не подходит под выбранный список и длину сезона.
              Измените ограничения или выберите сохранённый план, чтобы сравнить
              его с условиями.
            </p>
          )}
          {strategies.length > 0 && strategies.length < 3 && (
            <p className="notice" role="status">
              {strategies[0].analysis_result.warnings[0]}
            </p>
          )}
          <div
            className={`strategy-grid${strategies[0]?.constraints.currentSequence ? " strategy-comparison" : ""}`}
          >
            {strategies.map((s, i) => (
              <article className="card strategy" key={s.name}>
                <span className="eyebrow">
                  {s.constraints.currentSequence
                    ? i === 0
                      ? "ВАШ ПЛАН"
                      : `ВАРИАНТ 0${i}`
                    : `КАНДИДАТ ${i + 1}`}
                </span>
                <h2>{s.name}</h2>
                <div className="sequence">
                  {s.crop_sequence.map((id, y) => (
                    <div key={y}>
                      <span>
                        {Number.isFinite(Number(s.constraints.planYear))
                          ? Number(s.constraints.planYear) + y
                          : `Год ${y + 1}`}
                      </span>
                      <strong>
                        {data.crops.find((c) => c.id === id)?.name}
                      </strong>
                      {i > 0 && !!s.constraints.currentSequence && (
                        <small>
                          {id === strategies[0].crop_sequence[y]
                            ? "Без изменений"
                            : `Вместо: ${data.crops.find((c) => c.id === strategies[0].crop_sequence[y])?.name ?? "неизвестно"}`}
                        </small>
                      )}
                    </div>
                  ))}
                </div>
                <h3>Что показывает сравнение</h3>
                <ul>
                  {s.analysis_result.reasons.slice(0, 4).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <details className="flow-details strategy-details">
                  <summary>Риски, данные и расчёт</summary>
                  {s.analysis_result.reasons.length > 4 && (
                    <ul>
                      {s.analysis_result.reasons.slice(4).map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                  <p>
                    Справочная оценка за сезон:{" "}
                    <strong>{s.analysis_result.score}</strong> балла.
                  </p>
                  <p className="caption">
                    Веса критериев: почва ×{rotationWeights(s.priorities).soil},
                    вода ×{rotationWeights(s.priorities).water}, климат ×
                    {rotationWeights(s.priorities).climate}.
                  </p>
                  {s.analysis_result.criteria && (
                    <p className="caption">
                      Почва и история {s.analysis_result.criteria.soil} · Вода{" "}
                      {s.analysis_result.criteria.water} · Климат{" "}
                      {s.analysis_result.criteria.climate ?? "нет данных"}
                    </p>
                  )}
                  {!!s.analysis_result.risks?.length && (
                    <>
                      <h3>Риски и ограничения</h3>
                      <ul className="warnings">
                        {s.analysis_result.risks.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <h3>Использованные данные</h3>
                  <ul>
                    {s.analysis_result.sources?.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <h3>Каких данных не хватает</h3>
                  <ul className="warnings">
                    {s.analysis_result.warnings.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </details>
                <Button
                  variant="outline"
                  disabled={saving || saved.includes(s.name)}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await save("rotation_scenarios", {
                        ...s,
                        analysis_result: {
                          ...s.analysis_result,
                          comparison: strategies.map(
                            ({ analysis_result, ...item }) => {
                              const { comparison: _, ...analysis } =
                                analysis_result;
                              return { ...item, analysis_result: analysis };
                            },
                          ),
                        },
                      } as unknown as Record<string, unknown>);
                      setSaved([...saved, s.name]);
                      setMessage("Сценарий и сравнение сохранены");
                    } catch (e) {
                      setMessage(String(e));
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  <Bookmark size={15} />
                  {saved.includes(s.name)
                    ? "Сохранено"
                    : i === 0
                      ? "Сохранить сравнение"
                      : "Сохранить этот вариант"}
                </Button>
              </article>
            ))}
          </div>
        </>
      )}
      <section className="saved-scenarios">
        <h2>Сохранённые сценарии</h2>
        {data.scenarios.some((s) => s.field_id === field.id) && (
          <p className="caption">
            Это снимки прошлых расчётов. Для текущих приоритетов сформируйте
            стратегии выше.
          </p>
        )}
        {data.scenarios
          .filter((s) => s.field_id === field.id)
          .map((s, i) => (
            <details className="card" key={s.id ?? i}>
              <summary>{s.name}</summary>
              <p>
                {s.constraints.inputRevision
                  ? s.constraints.inputRevision === inputRevision
                    ? "Снимок соответствует текущим данным поля."
                    : "Условия поля изменились. Требуется пересчёт."
                  : "Старый результат: версия исходных данных неизвестна. Требуется пересчёт."}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  const c = s.constraints;
                  setGoals(s.priorities);
                  if (
                    typeof c.horizon === "number" &&
                    c.horizon >= 2 &&
                    c.horizon <= 20
                  )
                    setHorizon(c.horizon);
                  if (Array.isArray(c.allowed))
                    setAllowed(
                      c.allowed.filter(
                        (id): id is string => typeof id === "string",
                      ),
                    );
                  if (Array.isArray(c.excluded))
                    setExcluded(
                      c.excluded.filter(
                        (id): id is string => typeof id === "string",
                      ),
                    );
                  if (typeof c.irrigation === "boolean")
                    setIrrigation(c.irrigation);
                  setFixedYears(
                    Object.keys(
                      (c.fixedCrops ?? {}) as Record<string, string>,
                    ).map(Number),
                  );
                  if (typeof c.maxSeasonDays === "number")
                    setDays(c.maxSeasonDays);
                  const period = c.period as
                    { year?: number; start?: string; end?: string } | undefined;
                  if (
                    period &&
                    typeof period.year === "number" &&
                    typeof period.start === "string" &&
                    typeof period.end === "string"
                  ) {
                    setYear(period.year);
                    setDates({ start: period.start, end: period.end });
                  }
                  if (
                    Array.isArray(c.currentSequence) &&
                    c.currentSequence.every((id) => typeof id === "string")
                  ) {
                    setManualSequence(c.currentSequence);
                    setCurrentPlan("manual");
                  } else setCurrentPlan("");
                  setSaved([]);
                  setSameSequences(false);
                  setStrategies(
                    s.analysis_result.comparison?.length
                      ? s.analysis_result.comparison
                      : [s],
                  );
                  setResultRevision(resultKey);
                  setStep(2);
                  setMessage(
                    s.constraints.inputRevision === inputRevision
                      ? "Открыт сохранённый снимок сравнения."
                      : "Открыт прошлый результат. Данные изменились или их версия неизвестна — пересчитайте перед использованием.",
                  );
                }}
              >
                Открыть сохранённое сравнение
              </Button>
              <p>
                {s.crop_sequence
                  .map(
                    (id) =>
                      data.crops.find((c) => c.id === id)?.name ??
                      "Неизвестная культура",
                  )
                  .join(" → ")}
              </p>
              <ul>
                {s.analysis_result.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p>{s.analysis_result.warnings.join(" ")}</p>
            </details>
          ))}
        {!data.scenarios.some((s) => s.field_id === field.id) && (
          <p>Сохраните стратегию, чтобы вернуться к ней позже.</p>
        )}
      </section>
    </main>
  );
}
