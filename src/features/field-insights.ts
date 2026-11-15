import { t, getLanguage, localize } from "../lib/i18n";
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
const decimal = (value: number) =>
  new Intl.NumberFormat(getLanguage(), { maximumFractionDigits: 2 }).format(
    value,
  );
export const validInsightPeriod = (period: RotationPeriod) =>
  !!selectClimatePeriod([], period.year, period.start, period.end);

export function climateInsights(
  rows: Observation[],
  period: RotationPeriod,
): FieldInsight[] {
  if (!validInsightPeriod(period)) return [];
  const weather = summarizeRotationClimate(rows, period);
  const base = {
    source: t("NASA POWER · дневные данные сетки у центра поля"),
    period: label(period),
  };
  const results: FieldInsight[] = [];
  const { coverage, days } = weather;
  if (Object.values(coverage).some((count) => count < days)) {
    results.push({
      ...base,
      id: "climate-coverage",
      observation: t(
        "Доступно из {0} дн.: осадки — {1}, средняя температура — {2}, минимум — {3}, максимум — {4}.",
        days,
        coverage.rain,
        coverage.mean,
        coverage.min,
        coverage.max,
      ),
      meaning: t("Пропуски могут скрывать жаркие, холодные или дождливые дни."),
      action: t(
        "Сверьте критичные даты с ближайшей станцией или полевым журналом.",
      ),
      limits: t(
        "Итоговые значения за весь период показаны только при полном покрытии соответствующего ряда.",
      ),
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
      t(
        "Наблюдался непрерывный отрезок {0} дн. с осадками менее 1 мм в сутки.",
        weather.longestDry,
      ),
      t(
        "Длительные перерывы между дождями могут увеличить потребность в проверке запасов воды.",
      ),
      t("Сверьте даты с поливами и проверьте влажность на глубине корней."),
      t(
        "14 дней и 1 мм — ориентиры отбора событий. Влажность корневой зоны зависит также от почвы, полива и испарения. Пропуски разрывают последовательность.",
      ),
      coverage.rain === days,
    );
  if ((weather.hotDays ?? 0) > 0)
    add(
      "heat",
      t(
        "Дней с максимумом выше 35 °C: {0} из {1} дн. с данными.",
        weather.hotDays,
        coverage.max,
      ),
      t("Значение жары зависит от сорта, стадии роста и обеспеченности водой."),
      t("Сопоставьте жаркие дни с цветением и журналом полива."),
      t(
        "35 °C — ориентир отбора жарких дней. Температура сетки не отражает температуру растений и не устанавливает повреждение.",
      ),
      coverage.max === days,
    );
  if ((weather.frostDays ?? 0) > 0)
    add(
      "frost",
      t(
        "Дней с минимумом 0 °C или ниже: {0} из {1} дн. с данными.",
        weather.frostDays,
        coverage.min,
      ),
      t(
        "Похолодание может быть значимым, если совпало со всходами или чувствительной фазой.",
      ),
      t("Сопоставьте даты с посевом и проверьте локальные минимумы."),
      t(
        "Температура воздуха из сетки не подтверждает заморозок у поверхности или повреждение культуры.",
      ),
      coverage.min === days,
    );
  if (
    (coverage.rain === days && weather.rain !== null) ||
    (coverage.mean === days && weather.mean !== null)
  ) {
    const facts = [
      coverage.rain === days && weather.rain !== null
        ? t("сумма осадков {0} мм", decimal(weather.rain))
        : "",
      coverage.mean === days && weather.mean !== null
        ? t("средняя температура {0} °C", decimal(weather.mean))
        : "",
    ].filter(Boolean);
    add(
      "season-weather",
      t("За выбранный период: {0}.", facts.join(", ")),
      t("Итоги дают контекст для сравнения сопоставимых сезонов на поле."),
      t("Сопоставьте с теми же датами других лет и фазами культуры."),
      t(
        "Данные относятся к ячейке сетки. Сумма осадков не измеряет доступную растениям воду.",
      ),
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
    source: t("NASA HLS v2.0 · 30 м · маска Fmask"),
    period: label(period),
  };
  if (!comparable)
    return [
      {
        ...base,
        observation: t(
          "Сопоставимых наблюдений недостаточно. В периоде снимков: {0}, прошли начальный фильтр качества: {1}.",
          within.length,
          eligible.length,
        ),
        meaning: t(
          "Отдельные снимки могут отражать состояние покрытия только на дату съёмки.",
        ),
        action: t(
          "Дождитесь дополнительных снимков или проверьте поле на месте.",
        ),
        limits: t(
          "Для сравнения нужны минимум три даты одного продукта за интервал от 14 дней, полный охват границы, одинаковое число пикселей поля (от 10) и ≥80% пригодных пикселей на каждом снимке.",
        ),
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
      observation: t(
        "Средний NDVI: {0} ({1}) → {2} ({3}). Разница: {4}{5}. Пригодных дат: {6}.",
        decimal(first.mean!),
        first.date,
        decimal(last.mean!),
        last.date,
        delta > 0 ? "+" : "",
        decimal(delta),
        comparable.length,
      ),
      meaning: t(
        "Сравнение показывает изменение спектрального отклика между двумя датами. На него могут влиять фаза развития, уборка и доля открытой почвы.",
      ),
      action: t(
        "Сопоставьте даты с графиком NDVI, полевыми работами и осмотром участка.",
      ),
      limits: t(
        "Даже при высоком покрытии набор пригодных пикселей может отличаться. NDVI не измеряет влажность, плодородие или урожайность. Разница между датами не подтверждает устойчивый тренд.",
      ),
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
    currentSoil &&
    ![t("не знаю"), t("другое")].includes(currentSoil.toLowerCase())
      ? currentSoil
      : t("тип не уточнён");
  const irrigation = field.irrigation_type?.trim() || t("сведения отсутствуют");
  const area = Number(field.area_hectares);
  const context: FieldInsight = {
    id: "field-context",
    observation: t(
      "Почва: {0}. Орошение: {1}.{2}",
      localize(soil),
      localize(irrigation),
      Number.isFinite(area) && area > 0
        ? " " + t("Площадь по границе: {0} га.", decimal(area))
        : "",
    ),
    meaning: t(
      "Анкета и граница помогают определить, где проверить водоудержание почвы и доступность полива.",
    ),
    action: t(
      "Уточните текстуру и запасы влаги на месте. Если есть полив, проверьте фактический объём и график подачи воды.",
    ),
    source: demo
      ? t("Демокарточка поля")
      : t("Карточка поля · сведения фермера и геометрия AGRONA"),
    period: t("Текущая карточка, дата ввода сведений не указана"),
    limits: t(
      "Тип почвы указан в анкете. Лабораторных измерений, данных о производительности полива и влаге здесь нет.",
    ),
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
        ? t(
            "Две последние сопоставимые записи относятся к одному семейству ({0}).",
            family,
          )
        : t(
            "Недостаточно записей соседних лет с известными семействами культур.",
          ),
      meaning: repeat
        ? t(
            "Последовательное выращивание одного семейства может повышать фитосанитарный риск.",
          )
        : t(
            "Пропуски не позволяют установить, что росло на поле в последовательные сезоны.",
          ),
      action: repeat
        ? t(
            "Проверьте местные интервалы возврата культуры и записи о болезнях перед выбором следующей культуры.",
          )
        : t("Дополните историю культур и даты сезонов."),
      source: demo
        ? t("Демоистория культур · каталог AGRONA")
        : t("Журнал культур поля · каталог AGRONA"),
      period: repeat
        ? t("Записи {0}–{1}", previous!.year, latest!.year)
        : t("Записи до {0}", period.end),
      limits: t(
        "Записи по годам описывают историю севооборота. Диагностика болезней требует полевого обследования.",
      ),
      confidence: repeat ? "Умеренная" : "Недостаточно данных",
    },
  ];
}
