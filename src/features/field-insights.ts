import type { Crop, Field, Observation, Season } from "../lib/types";
import { selectClimatePeriod } from "./climate";
import {
  summarizeRotationClimate,
  type RotationPeriod,
} from "./rotation-climate";

export type FieldInsight = {
  id: string;
  observation: string;
  meaning: string;
  action: string;
  source: string;
  period: string;
  limits: string;
  confidence: "Высокая" | "Умеренная" | "Недостаточно данных";
};

export type VegetationSample = {
  date: string;
  conceptId: string;
  dataset: "HLSL30" | "HLSS30";
  mean: number | null;
  validPixels: number;
  fieldPixels: number;
  tileContainsField: boolean;
};

const label = ({ start, end }: RotationPeriod) => `${start} — ${end}`;
const decimal = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
export const validInsightPeriod = (period: RotationPeriod) =>
  !!selectClimatePeriod([], period.year, period.start, period.end);

export function climateInsights(
  rows: Observation[],
  period: RotationPeriod,
): FieldInsight[] {
  if (!validInsightPeriod(period)) return [];
  const weather = summarizeRotationClimate(rows, period);
  const base = {
    source: "NASA POWER · дневные данные сетки у центра поля",
    period: label(period),
  };
  const results: FieldInsight[] = [];
  const { coverage, days } = weather;
  if (Object.values(coverage).some((count) => count < days)) {
    results.push({
      ...base,
      id: "climate-coverage",
      observation: `Доступно из ${days} дн.: осадки — ${coverage.rain}, средняя температура — ${coverage.mean}, минимум — ${coverage.min}, максимум — ${coverage.max}.`,
      meaning: "Пропуски могут скрывать жаркие, холодные или дождливые дни.",
      action:
        "Сверьте критичные даты с ближайшей станцией или полевым журналом.",
      limits:
        "Итоговые значения за весь период показаны только при полном покрытии соответствующего ряда.",
      confidence: "Недостаточно данных",
    });
  }
  const add = (
    id: string,
    observation: string,
    meaning: string,
    action: string,
    limits: string,
    complete: boolean,
  ) => {
    results.push({
      ...base,
      id,
      observation,
      meaning,
      action,
      limits,
      confidence: complete ? "Высокая" : "Умеренная",
    });
  };
  if ((weather.longestDry ?? 0) >= 14)
    add(
      "dry-spell",
      `Наблюдался непрерывный отрезок ${weather.longestDry} дн. с осадками менее 1 мм в сутки.`,
      "Длительные перерывы между дождями могут увеличить потребность в проверке запасов воды.",
      "Сверьте даты с поливами и проверьте влажность на глубине корней.",
      "14 дней и 1 мм — ориентиры отбора событий. Влажность корневой зоны зависит также от почвы, полива и испарения. Пропуски разрывают последовательность.",
      coverage.rain === days,
    );
  if ((weather.hotDays ?? 0) > 0)
    add(
      "heat",
      `Дней с максимумом выше 35 °C: ${weather.hotDays} из ${coverage.max} дн. с данными.`,
      "Значение жары зависит от сорта, стадии роста и обеспеченности водой.",
      "Сопоставьте жаркие дни с цветением и журналом полива.",
      "35 °C — ориентир отбора жарких дней. Температура сетки не отражает температуру растений и не устанавливает повреждение.",
      coverage.max === days,
    );
  if ((weather.frostDays ?? 0) > 0)
    add(
      "frost",
      `Дней с минимумом 0 °C или ниже: ${weather.frostDays} из ${coverage.min} дн. с данными.`,
      "Похолодание может быть значимым, если совпало со всходами или чувствительной фазой.",
      "Сопоставьте даты с посевом и проверьте локальные минимумы.",
      "Температура воздуха из сетки не подтверждает заморозок у поверхности или повреждение культуры.",
      coverage.min === days,
    );
  if (
    (coverage.rain === days && weather.rain !== null) ||
    (coverage.mean === days && weather.mean !== null)
  ) {
    const facts = [
      coverage.rain === days && weather.rain !== null
        ? `сумма осадков ${decimal.format(weather.rain)} мм`
        : "",
      coverage.mean === days && weather.mean !== null
        ? `средняя температура ${decimal.format(weather.mean)} °C`
        : "",
    ].filter(Boolean);
    add(
      "season-weather",
      `За выбранный период: ${facts.join(", ")}.`,
      "Итоги дают контекст для сравнения сопоставимых сезонов на поле.",
      "Сопоставьте с теми же датами других лет и фазами культуры.",
      "Данные относятся к ячейке сетки. Сумма осадков не измеряет доступную растениям воду.",
      true,
    );
  }
  return results;
}

export function vegetationInsights(
  rows: VegetationSample[],
  period: RotationPeriod,
): FieldInsight[] {
  if (!validInsightPeriod(period)) return [];
  const within = rows.filter(
    (r) => r.date >= period.start && r.date <= period.end,
  );
  // Coverage, spacing and comparability rules are descriptive product heuristics.
  const eligible = within
    .filter(
      (r) =>
        r.tileContainsField &&
        r.fieldPixels >= 10 &&
        r.validPixels <= r.fieldPixels &&
        r.validPixels / r.fieldPixels >= 0.8 &&
        r.mean !== null &&
        Number.isFinite(r.mean) &&
        Math.abs(r.mean) <= 1,
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        b.validPixels / b.fieldPixels - a.validPixels / a.fieldPixels ||
        a.conceptId.localeCompare(b.conceptId),
    );
  const groups = (["HLSL30", "HLSS30"] as const).map((dataset) =>
    eligible.filter(
      (row, index) =>
        row.dataset === dataset &&
        eligible.findIndex(
          (candidate) =>
            candidate.dataset === dataset && candidate.date === row.date,
        ) === index,
    ),
  );
  const comparable = groups
    .filter(
      (group) =>
        group.length >= 3 &&
        Date.parse(group.at(-1)!.date) - Date.parse(group[0].date) >=
          14 * 86_400_000 &&
        group.every((row) => row.fieldPixels === group[0].fieldPixels),
    )
    .sort((a, b) => b.length - a.length)[0];
  const base = {
    id: "ndvi",
    source: "NASA HLS v2.0 · 30 м · маска Fmask",
    period: label(period),
  };
  if (!comparable)
    return [
      {
        ...base,
        observation: `Сопоставимых наблюдений недостаточно. В периоде снимков: ${within.length}, прошли начальный фильтр качества: ${eligible.length}.`,
        meaning:
          "Отдельные снимки могут отражать состояние покрытия только на дату съёмки.",
        action: "Дождитесь дополнительных снимков или проверьте поле на месте.",
        limits:
          "Для сравнения нужны минимум три даты одного продукта за интервал от 14 дней, полный охват границы, одинаковое число пикселей поля (от 10) и ≥80% пригодных пикселей на каждом снимке.",
        confidence: "Недостаточно данных",
      },
    ];
  const first = comparable[0];
  const last = comparable.at(-1)!;
  const delta = last.mean! - first.mean!;
  return [
    {
      ...base,
      source: `${base.source} · ${first.dataset}`,
      observation: `Средний NDVI: ${decimal.format(first.mean!)} (${first.date}) → ${decimal.format(last.mean!)} (${last.date}). Разница: ${delta > 0 ? "+" : ""}${decimal.format(delta)}. Пригодных дат: ${comparable.length}.`,
      meaning:
        "Сравнение показывает изменение спектрального отклика между двумя датами. На него могут влиять фаза развития, уборка и доля открытой почвы.",
      action:
        "Сопоставьте даты с графиком NDVI, полевыми работами и осмотром участка.",
      limits:
        "Даже при высоком покрытии набор пригодных пикселей может отличаться. NDVI не измеряет влажность, плодородие или урожайность. Разница между датами не подтверждает устойчивый тренд.",
      confidence: "Умеренная",
    },
  ];
}

export function fieldContextInsights(
  field: Field,
  seasons: Season[],
  crops: Crop[],
  period: RotationPeriod,
  demo: boolean,
): FieldInsight[] {
  if (!validInsightPeriod(period)) return [];
  const currentSoil = field.soil_type?.trim();
  const soil =
    currentSoil && !["не знаю", "другое"].includes(currentSoil.toLowerCase())
      ? currentSoil
      : "тип не уточнён";
  const irrigation = field.irrigation_type?.trim() || "сведения отсутствуют";
  const area = Number(field.area_hectares);
  const context: FieldInsight = {
    id: "field-context",
    observation: `Почва: ${soil}. Орошение: ${irrigation}.${Number.isFinite(area) && area > 0 ? ` Площадь по границе: ${decimal.format(area)} га.` : ""}`,
    meaning:
      "Анкета и граница помогают определить, где проверить водоудержание почвы и доступность полива.",
    action:
      "Уточните текстуру и запасы влаги на месте. Если есть полив, проверьте фактический объём и график подачи воды.",
    source: demo
      ? "Демокарточка поля"
      : "Карточка поля · сведения фермера и геометрия AGRONA",
    period: "Текущая карточка, дата ввода сведений не указана",
    limits:
      "Тип почвы указан в анкете. Лабораторных измерений, данных о производительности полива и влаге здесь нет.",
    confidence: "Умеренная",
  };
  const byId = new Map(crops.map((crop) => [crop.id, crop]));
  const ordered = seasons
    .filter(
      (s) =>
        s.field_id === field.id &&
        s.year <= period.year &&
        (!s.planting_date || s.planting_date <= period.end),
    )
    .sort((a, b) => a.year - b.year);
  const latest = ordered.at(-1);
  const previous = ordered.at(-2);
  const family = latest && byId.get(latest.crop_id)?.crop_family;
  const comparable =
    latest &&
    previous &&
    previous.year + 1 === latest.year &&
    family &&
    byId.get(previous.crop_id)?.crop_family;
  const repeat =
    comparable && family === byId.get(previous!.crop_id)?.crop_family;
  if (comparable && !repeat) return [context];
  return [
    context,
    {
      id: "crop-history",
      observation: repeat
        ? `Две последние сопоставимые записи относятся к одному семейству (${family}).`
        : "Недостаточно записей соседних лет с известными семействами культур.",
      meaning: repeat
        ? "Последовательное выращивание одного семейства может повышать фитосанитарный риск."
        : "Пропуски не позволяют установить, что росло на поле в последовательные сезоны.",
      action: repeat
        ? "Проверьте местные интервалы возврата культуры и записи о болезнях перед выбором следующей культуры."
        : "Дополните историю культур и даты сезонов.",
      source: demo
        ? "Демоистория культур · каталог AGRONA"
        : "Журнал культур поля · каталог AGRONA",
      period: repeat
        ? `Записи ${previous!.year}–${latest!.year}`
        : `Записи до ${period.end}`,
      limits:
        "Записи по годам описывают историю севооборота. Диагностика болезней требует полевого обследования.",
      confidence: repeat ? "Умеренная" : "Недостаточно данных",
    },
  ];
}
