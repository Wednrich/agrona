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
import { generateRotations } from "../features/rotation";
import { FieldPicker } from "../components/FieldPicker";
import type { Scenario, Observation } from "../lib/types";
import { Button } from "../components/ui/button";
export default function Rotation() {
  const { fieldId } = useParams();
  const { data, error, isLoading, save } = useData();
  const { demo } = useAuth();
  const field = data?.fields.find((f) => f.id === fieldId);
  const [step, setStep] = useState(1);
  const [goals, setGoals] = useState(["soil", "water"]);
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [horizon, setHorizon] = useState(3);
  const [irrigation, setIrrigation] = useState<boolean | null>(null);
  const [days, setDays] = useState(150);
  const [strategies, setStrategies] = useState<Scenario[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const climate = useQuery({
    queryKey: ["rotation-climate", fieldId, demo],
    enabled: !!field,
    queryFn: async () => {
      if (demo) {
        if (fieldId !== "demo-field-1") return [];
        const response = await fetch("/demo-power-2025.json");
        if (!response.ok) throw new Error("Демо-наблюдения недоступны");
        return (await response.json()).observations as Observation[];
      }
      if (!supabase) return [];
      const { data: years } = await supabase
        .from("field_analytics")
        .select("analysis_period")
        .eq("field_id", fieldId)
        .eq("provider", "NASA POWER")
        .eq("dataset", "daily-ag-v2")
        .order("analysis_period", { ascending: false })
        .limit(1);
      if (years?.length) {
        const { data: cached } = await supabase.functions.invoke("nasa-power", {
          body: { fieldId, year: years[0].analysis_period, cacheOnly: true },
        });
        if (cached?.observations?.length)
          return cached.observations as Observation[];
      }
      const { data: results, error } = await supabase
        .from("analysis_results")
        .select("result,source_metadata")
        .eq("field_id", fieldId)
        .like("analysis_type", "power-v1-%")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return results?.source_metadata?.geometry ===
        JSON.stringify(field?.boundary)
        ? (results.result.observations as Observation[])
        : [];
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
  function generate() {
    try {
      setStrategies(
        generateRotations(
          data!.crops,
          history,
          field!.id,
          goals,
          {
            allowed: ids,
            excluded,
            horizon,
            irrigation: water,
            maxSeasonDays: days,
          },
          climate.data ?? [],
        ),
      );
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
        <span className="rule-badge">Прозрачная модель · v1.0</span>
      </div>
      <div className="steps">
        {["Ваши цели", "Стратегии", "Сравнение"].map((name, i) => (
          <div className={step >= i + 1 ? "active" : ""} key={name}>
            <span>{step > i + 1 ? <Check size={14} /> : i + 1}</span>
            {name}
          </div>
        ))}
      </div>
      <p role="status" className="error">
        {message}
      </p>
      {step === 1 ? (
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
                  {[2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} года
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Длина доступного сезона, дней
                <input
                  type="number"
                  min={30}
                  max={365}
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
                ? "Загруженные наблюдения будут учтены."
                : "Климатические наблюдения отсутствуют. Климатический рейтинг не будет подтверждён."}
            </p>
            {climate.error && (
              <p className="error">Не удалось загрузить историю климата.</p>
            )}
            <Button
              disabled={climate.isLoading || days < 30 || days > 365}
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
                {step === 2
                  ? "Три пути к следующему сезону"
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
          <div className="strategy-grid">
            {strategies.map((s, i) => (
              <article className="card strategy" key={s.name}>
                <span className="eyebrow">
                  {i === 0 ? "ТОЧКА ОТСЧЁТА" : `ВАРИАНТ 0${i}`}
                </span>
                <h2>{s.name}</h2>
                <div className="sequence">
                  {s.crop_sequence.map((id, y) => (
                    <div key={y}>
                      <span>{new Date().getFullYear() + 1 + y}</span>
                      <strong>
                        {data.crops.find((c) => c.id === id)?.name}
                      </strong>
                      <Leaf size={15} />
                    </div>
                  ))}
                </div>
                {step === 3 && (
                  <>
                    <h3>Основания</h3>
                    <ul>
                      {s.analysis_result.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                    <h3>Неопределённость и проверка</h3>
                    <ul className="warnings">
                      {s.analysis_result.warnings.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                    <details>
                      <summary>Как рассчитан порядок</summary>
                      <p>
                        Баллы: смена семейства +2, повтор −3; бобовые +3 при
                        приоритете почвы, иначе +1; при экономии воды вычитается
                        нижняя потребность / 100. При подтверждённом сухом
                        периоде учитывается засухоустойчивость. Баллы —
                        внутреннее правило, не прогноз эффективности.
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
          {step === 2 && (
            <Button onClick={() => setStep(3)}>
              Перейти к сравнению <ArrowRight size={16} />
            </Button>
          )}
        </>
      )}
      <section className="saved-scenarios">
        <h2>Сохранённые сценарии</h2>
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
