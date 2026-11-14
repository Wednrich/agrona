import { rotationClimateKey } from "../lib/field-write";
import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Droplets,
  Leaf,
  ShieldCheck,
  Coins,
  Check,
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
import { matchesRotationGeometry } from "../features/rotation-climate";
import { selectClimatePeriod, suggestedSeason } from "../features/climate";
import { initialDemo } from "../lib/demo";
import { FieldPicker } from "../components/FieldPicker";
import type { Scenario, Observation } from "../lib/types";
import { Button } from "../components/ui/button";
export default function Rotation() {
  const { fieldId } = useParams();
  return <RotationForm key={fieldId} fieldId={fieldId} />;
}

function RotationForm({ fieldId }: { fieldId?: string }) {
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
  const [currentPlan, setCurrentPlan] = useState("");
  const [resultRevision, setResultRevision] = useState("");
  const fingerprint = field ? JSON.stringify(field.boundary) : "";
  const resultKey = JSON.stringify([
    demo ? "demo" : user?.id,
    fieldId,
    fingerprint,
  ]);
  const activeStep = resultRevision === resultKey ? step : 1;
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
    queryFn: async () => {
      if (demo) {
        if (
          year !== 2025 ||
          fieldId !== initialDemo.fields[0].id ||
          fingerprint !== JSON.stringify(initialDemo.fields[0].boundary)
        )
          return [];
        const response = await fetch("/demo-power-2025.json");
        if (!response.ok) throw new Error("Демо-наблюдения недоступны");
        return (await response.json()).observations as Observation[];
      }
      if (!supabase || !field) return [];
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(fingerprint),
      );
      const revision = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const { data: cached, error } = await supabase.functions.invoke(
        "nasa-power",
        {
          body: { fieldId, year, cacheOnly: true },
        },
      );
      if (error) throw error;
      if (
        matchesRotationGeometry(
          cached?.metadata?.geometry,
          fingerprint,
          revision,
        )
      ) {
        return (cached?.observations ?? []) as Observation[];
      }
      return [];
    },
  });
  if (isLoading) return <div className="page">Загрузка…</div>;
  if (error) return <div className="page error">{error.message}</div>;
  if (!field || !data)
    return <FieldPicker title="Планирование севооборота" route="rotation" />;
  const ids = allowed ?? data.crops.map((c) => c.id);
  const water =
    irrigation ??
    (!!field.irrigation_type && field.irrigation_type !== "Без орошения");
  const history = data.seasons.filter((s) => s.field_id === fieldId);
  const plans = data.scenarios.filter(
    (plan) =>
      plan.field_id === field.id &&
      plan.crop_sequence.length === horizon &&
      plan.crop_sequence.every((id) =>
        data.crops.some((crop) => crop.id === id),
      ),
  );
  function generate() {
    try {
      const plan = plans.find((plan) => plan.id === currentPlan);
      const constraints = {
        allowed: ids,
        excluded,
        horizon,
        irrigation: water,
        maxSeasonDays: days,
        soilType: field!.soil_type,
        period: { year, ...dates },
        currentSequence: plan?.crop_sequence,
        currentName: plan?.name,
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
  return (
    <main className="page rotation">
      <Link className="back-link" to={"/analytics/" + field.id}>
        ← Аналитика поля
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">СЛЕДУЮЩИЙ СЕЗОН НАЧИНАЕТСЯ СЕГОДНЯ</span>
          <h1>Севооборот с перспективой</h1>
          <p>
            {field.name} · {Number(field.area_hectares).toFixed(1)} га
          </p>
        </div>
        <span className="rule-badge">Прозрачная модель · v2.0</span>
      </div>
      <div className="steps">
        {["Ваши цели", "Стратегии", "Сравнение"].map((name, i) => (
          <div className={activeStep >= i + 1 ? "active" : ""} key={name}>
            <span>{activeStep > i + 1 ? <Check size={14} /> : i + 1}</span>
            {name}
          </div>
        ))}
      </div>
      <p role="status" className="error">
        {message}
      </p>
      {activeStep === 1 ? (
        <>
          <section className="card">
            <span className="eyebrow">ШАГ 01</span>
            <h2>Что важно для вашего хозяйства?</h2>
            <p>Выберите приоритеты. Они определят вес правил при сравнении.</p>
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
          <section className="card constraints">
            <h2>Условия и ограничения</h2>
            <div className="form-grid">
              <label>
                Горизонт планирования
                <select
                  value={horizon}
                  onChange={(e) => setHorizon(Number(e.target.value))}
                >
                  {[2, 3, 4, 5, 10, 15, 20].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
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
              <label>
                Текущий план для сравнения
                <select
                  value={
                    plans.some((plan) => plan.id === currentPlan)
                      ? currentPlan
                      : ""
                  }
                  onChange={(event) => setCurrentPlan(event.target.value)}
                >
                  <option value="">Текущий план не указан</option>
                  {plans
                    .filter((plan) => plan.id)
                    .map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <p className="caption">
              Даты по умолчанию ориентировочные. Для отбора используется меньшая
              из двух величин: указанная длина сезона и длина выбранного
              периода.
            </p>
            {!selectedPeriod && (
              <p className="error">Укажите даты в пределах выбранного года.</p>
            )}
            <h3>Допустимые культуры</h3>
            <div className="crop-options">
              {data.crops.map((c) => (
                <label className="check-label" key={c.id}>
                  <input
                    type="checkbox"
                    checked={ids.includes(c.id)}
                    onChange={(e) =>
                      setAllowed(
                        e.target.checked
                          ? [...ids, c.id]
                          : ids.filter((id) => id !== c.id),
                      )
                    }
                  />
                  {c.name}
                </label>
              ))}
            </div>
            <h3>Исключить культуры</h3>
            <div className="crop-options">
              {data.crops.map((c) => (
                <label className="check-label" key={c.id}>
                  <input
                    type="checkbox"
                    checked={excluded.includes(c.id)}
                    onChange={(e) =>
                      setExcluded(
                        e.target.checked
                          ? [...excluded, c.id]
                          : excluded.filter((id) => id !== c.id),
                      )
                    }
                  />
                  {c.name}
                </label>
              ))}
            </div>
            <p className="caption">
              {history.length} записей в истории.{" "}
              {climate.data?.length
                ? "Доступен климатический кэш для этого поля и выбранного года. В расчёт войдут только дни выбранного периода."
                : "Нет наблюдений для выбранного года и границы. Загрузить год можно во вкладке «Климат»; расчёт также доступен без климатических данных."}
            </p>
            {climate.error && (
              <p className="error">Не удалось загрузить историю климата.</p>
            )}
            <Button
              disabled={
                climate.isLoading ||
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
              Сформировать стратегии <ArrowRight size={16} />
            </Button>
          </section>
        </>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <h2>
                {activeStep === 2
                  ? "Стратегии для следующего сезона"
                  : "Сравните условия, а не обещания"}
              </h2>
              <p>
                Результаты основаны на правилах. Предпочтительный вариант не
                назначается без местной проверки.
              </p>
            </div>
            <Button variant="outline" onClick={() => setStep(1)}>
              Изменить приоритеты
            </Button>
          </div>
          {!!strategies.length && (
            <p className="caption">
              Веса сравнения: почва ×{rotationWeights(goals).soil}, вода ×
              {rotationWeights(goals).water}, климат ×
              {rotationWeights(goals).climate}.
              {sameSequences &&
                " После пересчёта последовательности остались прежними."}
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
          <div className="strategy-grid">
            {strategies.map((s, i) => (
              <article className="card strategy" key={s.name}>
                <span className="eyebrow">
                  {i === 0 ? "ТОЧКА ОТСЧЁТА" : `ВАРИАНТ 0${i}`}
                </span>
                <h2>{s.name}</h2>
                <p>
                  <strong>{s.analysis_result.score}</strong> балла за сезон по
                  выбранным весам
                </p>
                {s.analysis_result.criteria && (
                  <p className="caption">
                    Почва и история {s.analysis_result.criteria.soil} · Вода{" "}
                    {s.analysis_result.criteria.water} · Климат{" "}
                    {s.analysis_result.criteria.climate ?? "нет данных"}
                  </p>
                )}
                <div className="sequence">
                  {s.crop_sequence.map((id, y) => (
                    <div key={y}>
                      <span>{Number(s.constraints.planYear) + y}</span>
                      <strong>
                        {data.crops.find((c) => c.id === id)?.name}
                      </strong>
                      <Leaf size={15} />
                    </div>
                  ))}
                </div>
                {(activeStep === 3 || strategies.length === 1) && (
                  <>
                    <h3>Преимущества и основания</h3>
                    <ul>
                      {s.analysis_result.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
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
                    <details>
                      <summary>Как рассчитан порядок</summary>
                      <p>
                        Справочные требования культур, повторы в истории и
                        климатические сигналы оцениваются по отдельности.
                        Выбранный приоритет удваивает вес критерия, а при поиске
                        каждой альтернативы её акцент дополнительно усиливается.
                        Общий балл на карточке рассчитан по одинаковым весам для
                        всех планов.
                      </p>
                    </details>
                  </>
                )}
                <Button
                  variant="outline"
                  disabled={saving || saved.includes(s.name)}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await save(
                        "rotation_scenarios",
                        s as unknown as Record<string, unknown>,
                      );
                      setSaved([...saved, s.name]);
                      setMessage("Сценарий сохранён");
                    } catch (e) {
                      setMessage(String(e));
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  <Bookmark size={15} />
                  {saved.includes(s.name) ? "Сохранено" : "Сохранить сценарий"}
                </Button>
              </article>
            ))}
          </div>
          {activeStep === 2 && strategies.length > 1 && (
            <Button onClick={() => setStep(3)}>
              Перейти к сравнению <ArrowRight size={16} />
            </Button>
          )}
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
