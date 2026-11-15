import type { Crop, Season, Scenario, Observation } from "../lib/types";
import {
  summarizeRotationClimate,
  type RotationPeriod,
} from "./rotation-climate";

export interface Constraints {
  allowed: string[];
  excluded: string[];
  horizon: number;
  irrigation: boolean;
  maxSeasonDays: number;
  soilType?: string;
  soilEstimateAvailable?: boolean;
  period?: RotationPeriod;
  currentSequence?: string[];
  fixedCrops?: Record<number, string>;
  currentName?: string;
  inputRevision?: string;
}

type Criteria = { soil: number; water: number; climate: number };
type Candidate = { crops: Crop[]; points: Criteria; rank: number; key: string };
const beamWidth = 24;
export function rotationWeights(priorities: string[]): Criteria {
  return {
    soil: priorities.includes("soil") ? 2 : 1,
    water: priorities.includes("water") ? 2 : 1,
    climate: priorities.includes("climate") ? 2 : 1,
  };
}
export type RotationDiagnostics = {
  eligibleCrops: number;
  admissibleSequences: string;
  seasonDays: number;
  weights: Criteria;
  coverage: ReturnType<typeof summarizeRotationClimate>["coverage"] | null;
  choices: { role: string; rule: string; weights: Criteria; rank: number }[];
};
const zero = { soil: 0, water: 0, climate: 0 };
const format = (value: number) => Number(value.toFixed(1));

export function generateRotations(
  crops: Crop[],
  history: Season[],
  fieldId: string,
  priorities: string[],
  constraints: Constraints,
  observations: Observation[] = [],
  diagnose?: (details: RotationDiagnostics) => void,
): Scenario[] {
  const { horizon, period, maxSeasonDays, soilType, irrigation } = constraints;
  if (!Number.isInteger(horizon) || horizon < 2 || horizon > 20)
    throw new Error("Горизонт должен быть от 2 до 20 лет.");
  if (
    !Number.isInteger(maxSeasonDays) ||
    maxSeasonDays < 1 ||
    maxSeasonDays > 366
  )
    throw new Error("Укажите доступную длину сезона от 1 до 366 дней.");

  const weather = period
    ? summarizeRotationClimate(observations, period)
    : null;
  const seasonDays = Math.min(maxSeasonDays, weather?.days ?? maxSeasonDays);
  const enabled = new Set(constraints.allowed);
  const excluded = new Set(constraints.excluded);
  const byId = new Map(crops.map((crop) => [crop.id, crop]));
  const eligible = new Set(
    crops
      .filter(
        (crop) =>
          enabled.has(crop.id) &&
          !excluded.has(crop.id) &&
          crop.growing_season_days <= seasonDays,
      )
      .map((crop) => crop.id),
  );
  const pool = crops.filter((crop) => eligible.has(crop.id));
  for (const [year, crop] of Object.entries(constraints.fixedCrops ?? {})) {
    if (
      !Number.isInteger(Number(year)) ||
      Number(year) < 0 ||
      Number(year) >= horizon ||
      !eligible.has(crop)
    )
      throw new Error(
        "Закреплённая культура не соответствует ограничениям. Уточните год, допустимые культуры и длину сезона.",
      );
  }

  const seasons = [...history].sort((a, b) => a.year - b.year);
  const historyKnown = seasons.filter((season) => byId.has(season.crop_id));
  const gaps =
    seasons.length < 2 ||
    historyKnown.length !== seasons.length ||
    seasons.some(
      (season, i) => i > 0 && season.year !== seasons[i - 1].year + 1,
    );
  const lastSeason = seasons.at(-1);
  const last = lastSeason ? byId.get(lastSeason.crop_id) : undefined;
  const planYear = Math.max(
    new Date().getUTCFullYear() + 1,
    (lastSeason?.year ?? 0) + 1,
  );
  const predecessor = lastSeason?.year === planYear - 1 ? last : undefined;
  const historyPenalties = new Map(
    crops.map((crop) => {
      const penalty = historyKnown.reduce((sum, season) => {
        const recorded = byId.get(season.crop_id)!;
        const similarity =
          crop.id === recorded.id
            ? 2
            : crop.crop_family === recorded.crop_family
              ? 1
              : 0;
        return sum + similarity / Math.max(1, planYear - season.year);
      }, 0);
      return [crop.id, penalty];
    }),
  );
  const soil = soilType?.trim();
  const soilKnown =
    !!soil && !["не знаю", "другое"].includes(soil.toLowerCase());
  const sandy =
    soilKnown &&
    ["песчаная почва", "супесчаная почва"].includes(soil.toLowerCase());
  const completeRain = !!weather && weather.coverage.rain === weather.days;
  const dry = (weather?.longestDry ?? 0) >= 14;
  const drought = (crop: Crop) =>
    dry
      ? crop.drought_tolerance === "low"
        ? 2
        : crop.drought_tolerance === "medium"
          ? 1
          : 0
      : 0;

  // Screening signals, in points. Historical weather can lower suitability but cannot disqualify a crop.
  const cropCriteria = new Map(
    crops.map((crop) => {
      const demand = Number(crop.water_requirement_min_mm);
      const duration = crop.growing_season_days / seasonDays;
      const risk =
        (weather?.frostFree != null &&
        crop.growing_season_days > weather.frostFree
          ? 2
          : 0) +
        ((weather?.hotDays ?? 0) > 0 ? duration : 0) +
        (weather?.mean != null &&
        weather.coverage.mean === weather.days &&
        weather.mean < 10
          ? duration
          : 0) +
        drought(crop);
      return [
        crop.id,
        {
          soil: Number(crop.nitrogen_fixation) - historyPenalties.get(crop.id)!,
          water:
            -demand / 100 -
            (completeRain ? Math.max(0, demand - weather!.rain!) / 200 : 0) -
            (sandy && dry ? drought(crop) / 2 : 0),
          climate: -risk,
        },
      ];
    }),
  );
  const weights = rotationWeights(priorities);
  const score = (p: Criteria, w: Criteria) =>
    p.soil * w.soil + p.water * w.water + p.climate * w.climate;
  function extend(
    candidate: Candidate,
    crop: Crop,
    weights: Criteria,
  ): Candidate {
    const previous = candidate.crops.at(-1) ?? predecessor;
    const sameFamily = previous?.crop_family === crop.crop_family;
    const sameCrop = previous?.id === crop.id;
    const familyRepeats = candidate.crops.filter(
      (c) => c.crop_family === crop.crop_family,
    ).length;
    const base = cropCriteria.get(crop.id)!;
    const points = {
      soil:
        candidate.points.soil +
        base.soil -
        (sameFamily ? 2 : 0) -
        (sameCrop ? 2 : 0) -
        familyRepeats / (candidate.crops.length + 1) +
        (previous?.nitrogen_fixation && !sameFamily ? 1 : 0),
      water: candidate.points.water + base.water,
      climate: candidate.points.climate + base.climate,
    };
    return {
      crops: [...candidate.crops, crop],
      points,
      rank: score(points, weights),
      key: candidate.key + "|" + crop.id,
    };
  }
  const empty: Candidate = { crops: [], points: zero, rank: 0, key: "" };
  function search(focus: Criteria) {
    let beam = [empty];
    for (let year = 0; year < horizon; year++) {
      beam = beam
        .flatMap((candidate) =>
          pool
            .filter(
              (crop) =>
                !constraints.fixedCrops?.[year] ||
                constraints.fixedCrops[year] === crop.id,
            )
            .map((crop) => extend(candidate, crop, focus)),
        )
        .sort((a, b) => b.rank - a.rank || a.key.localeCompare(b.key))
        .slice(0, beamWidth);
    }
    return beam;
  }

  const knownPlan = constraints.currentSequence?.map((id) => byId.get(id));
  const hasPlan =
    knownPlan?.length === horizon && knownPlan.every((crop) => !!crop);
  const baseline = hasPlan
    ? (knownPlan as Crop[]).reduce(
        (candidate, crop) => extend(candidate, crop, weights),
        empty,
      )
    : search(weights)[0];
  const climateFocus =
    priorities.includes("climate") && !priorities.includes("soil");
  const withFocus = (key: keyof Criteria) => ({
    ...weights,
    [key]: weights[key] + 3,
  });
  const climateSignalsAvailable =
    !!weather &&
    (weather.frostFree !== null ||
      weather.coverage.mean === weather.days ||
      weather.coverage.max === weather.days ||
      (weather.hotDays ?? 0) > 0 ||
      dry);
  const waterWeights = withFocus("water");
  const thirdFocus =
    climateFocus && climateSignalsAvailable ? "climate" : "soil";
  const thirdWeights = withFocus(thirdFocus);
  const water =
    baseline &&
    search(waterWeights).find((candidate) => candidate.key !== baseline.key);
  const resilience =
    baseline &&
    search(thirdWeights).find(
      (candidate) =>
        candidate.key !== baseline.key && candidate.key !== water?.key,
    );
  if (diagnose) {
    const choices: RotationDiagnostics["choices"] = [];
    if (baseline)
      choices.push({
        role: "baseline",
        rule: hasPlan ? "selected-saved-plan" : "best-baseline-beam-candidate",
        weights,
        rank: baseline.rank,
      });
    if (water)
      choices.push({
        role: "water",
        rule: "highest-ranked-distinct-beam-candidate",
        weights: waterWeights,
        rank: water.rank,
      });
    if (resilience)
      choices.push({
        role: thirdFocus,
        rule: "highest-ranked-distinct-beam-candidate",
        weights: thirdWeights,
        rank: resilience.rank,
      });
    diagnose({
      eligibleCrops: pool.length,
      admissibleSequences: (BigInt(pool.length) ** BigInt(horizon)).toString(),
      seasonDays,
      weights,
      coverage: weather?.coverage ?? null,
      choices,
    });
  }
  if (!baseline) return [];
  const count = 1 + Number(!!water) + Number(!!resilience);
  const baselineWaterMax =
    baseline.crops.reduce(
      (sum, crop) => sum + Number(crop.water_requirement_max_mm),
      0,
    ) / horizon;
  const baselineWater =
    baseline.crops.reduce(
      (sum, crop) => sum + Number(crop.water_requirement_min_mm),
      0,
    ) / horizon;

  function explain(
    candidate: Candidate,
    name: string,
    baselineVariant: boolean,
  ): Scenario {
    const sequence = candidate.crops;
    const entry = predecessor ? [predecessor, ...sequence] : sequence;
    const repeatedCrop = entry
      .slice(1)
      .filter((c, index) => c.id === entry[index].id).length;
    const repeatedFamily = entry
      .slice(1)
      .filter((c, index) => c.crop_family === entry[index].crop_family).length;
    const legumes = sequence.filter((c) => c.nitrogen_fixation).length;
    const waterMin =
      sequence.reduce((sum, c) => sum + Number(c.water_requirement_min_mm), 0) /
      horizon;
    const waterMax =
      sequence.reduce((sum, c) => sum + Number(c.water_requirement_max_mm), 0) /
      horizon;
    const reasons = [
      `В плане ${new Set(sequence.map((c) => c.crop_family)).size} разных семейств. Сезонов с культурами из каталога, отмеченными как азотфиксирующие: ${legumes}.`,
      `Средняя справочная потребность культур в воде: ${format(waterMin)}–${format(waterMax)} мм за сезон.`,
      `Доступное окно: ${seasonDays} дн. Самая длительная культура в плане: ${Math.max(...sequence.map((c) => c.growing_season_days))} дн.`,
    ];
    if (!baselineVariant && hasPlan) {
      reasons.push(
        compareWaterRanges(
          [baselineWater, baselineWaterMax],
          [waterMin, waterMax],
        ),
      );
    }
    if (
      !baselineVariant &&
      hasPlan &&
      format(candidate.points.soil / horizon) >
        format(baseline.points.soil / horizon)
    )
      reasons.push(
        "По правилам истории и чередования этот план набирает больше баллов, чем исходный.",
      );
    if (
      !baselineVariant &&
      hasPlan &&
      climateSignalsAvailable &&
      format(candidate.points.climate / horizon) >
        format(baseline.points.climate / horizon)
    )
      reasons.push(
        "По наблюдавшимся климатическим сигналам этот план получает меньший штраф, чем исходный.",
      );
    if (legumes)
      reasons.push(
        "Азотфиксация и польза для предшественника зависят от местных условий и управления остатками.",
      );
    if (baselineVariant && !hasPlan)
      reasons.push(
        "Текущий план неизвестен. Показаны кандидаты из каталога без сравнения с планом хозяйства.",
      );
    const risks = [
      ...(repeatedFamily
        ? [
            `Соседние повторы: культуры — ${repeatedCrop}, семейства — ${repeatedFamily}. Проверьте фитосанитарные интервалы.`,
          ]
        : []),
      ...sequence
        .filter(
          (c, i) => sequence.findIndex((other) => other.id === c.id) === i,
        )
        .flatMap((crop) => [
          ...(!eligible.has(crop.id)
            ? [
                `${crop.name}: не подходит под список культур или длину сезона; показана для сравнения с исходным планом.`,
              ]
            : []),
          ...(weather?.frostFree != null &&
          crop.growing_season_days > weather.frostFree
            ? [
                `${crop.name}: справочная длительность выше самого длинного непрерывного окна без заморозков в выбранном периоде.`,
              ]
            : []),
          ...(drought(crop) > 0
            ? [
                `${crop.name}: сухой отрезок от 14 дней и ${crop.drought_tolerance === "low" ? "низкая" : "средняя"} справочная засухоустойчивость.`,
              ]
            : []),
        ]),
      ...((weather?.hotDays ?? 0) > 0
        ? [
            "Были дни выше 35 °C. Проверьте чувствительность сорта и сроки уязвимых фаз.",
          ]
        : []),
      ...((weather?.frostDays ?? 0) > 0
        ? [
            "В выбранном периоде наблюдались минимумы ≤ 0 °C. Сопоставьте их с посевом и чувствительными фазами.",
          ]
        : []),
      ...(weather?.mean != null &&
      weather.coverage.mean === weather.days &&
      weather.mean < 10
        ? [
            "Средняя температура периода ниже 10 °C. Длительные культуры получили скрининговый штраф.",
          ]
        : []),
      ...(completeRain && weather!.rain! < waterMin
        ? [
            irrigation
              ? "Осадков было меньше средней нижней справочной потребности. Проверьте доступный объём полива и эффективные осадки."
              : "Осадков было меньше средней нижней справочной потребности, орошение не указано. Проверьте запасы влаги и эффективные осадки.",
          ]
        : []),
      ...(sandy && dry
        ? [
            "Для указанной песчаной или супесчаной почвы при сухом отрезке усилен учёт засухоустойчивости.",
          ]
        : []),
    ];
    const sources = [
      `История поля: ${historyKnown.length} распознанных из ${seasons.length} записей${seasons.length ? ` (${seasons[0].year}–${lastSeason!.year})` : ""}.`,
      "Каталог AGRONA: семейство, продолжительность сезона, справочный диапазон потребности в воде и засухоустойчивость.",
      soilKnown
        ? `Тип почвы со слов фермера: ${soil}. В баллах по воде выделены песчаная и супесчаная почвы.`
        : constraints.soilEstimateAvailable
          ? "Состав почвы оценён по SoilGrids 2.0. Глубины и покрытие показаны в обзоре поля."
          : "Оценка состава почвы пока отсутствует.",
      irrigation
        ? "Орошение отмечено как доступное. Объём и график подачи неизвестны."
        : "Орошение не отмечено как доступное.",
    ];
    if (weather && Object.values(weather.coverage).some(Boolean)) {
      const metric = (v: number | null) =>
        v == null ? "нет данных" : String(format(v));
      sources.push(
        `NASA POWER, погодная сетка 0,5° × 0,625° у центра поля, ${weather.start} — ${weather.end}. Средняя температура: ${metric(weather.mean)} °C, осадки за дни с данными: ${metric(weather.rain)} мм, дни ≤ 0 °C: ${metric(weather.frostDays)}, дни > 35 °C: ${metric(weather.hotDays)}, самый длинный наблюдавшийся сухой отрезок (< 1 мм/сут): ${metric(weather.longestDry)} дн.`,
        `Дней с данными из ${weather.days}: средняя температура ${weather.coverage.mean}, минимальная ${weather.coverage.min}, максимальная ${weather.coverage.max}, осадки ${weather.coverage.rain}.`,
      );
    }
    const missing = [
      ...(!soilKnown
        ? [
            constraints.soilEstimateAvailable
              ? "Для расчёта запаса доступной растениям воды нужны влагоёмкость и глубина корней."
              : "Нужна оценка состава почвы или сведения анализа поля.",
          ]
        : []),
      ...(climateFocus && !climateSignalsAvailable
        ? [
            "Климатических сигналов недостаточно для отдельной климатической альтернативы. Вместо неё показан вариант с акцентом на почву.",
          ]
        : []),
      ...(gaps || !predecessor
        ? [
            "История неполная для расчёта предшественника или интервалов возврата. Пропуски не заполнены.",
          ]
        : []),
      ...(!weather || !Object.values(weather.coverage).some(Boolean)
        ? [
            "Климатические наблюдения не загружены для выбранного периода и границы. Климатические штрафы не начислены.",
          ]
        : Object.values(weather.coverage).some((days) => days < weather.days)
          ? [
              "В климатическом ряду есть пропуски. Полная сумма осадков, холодный средний фон и окно без заморозков учитываются в оценке только при полном покрытии соответствующего показателя.",
            ]
          : []),
      "Местный календарь посева и уборки и выполнимость переходов не проверены агрономом. Это кандидаты для обсуждения, не рекомендация к посеву.",
      "Справочные диапазоны воды не являются расчётом полива или измеренной экономией. Источники значений каталога требуют агрономической проверки.",
      "Нужны данные о сорте, эффективных осадках, запасах влаги, почвенных измерениях и доступном объёме полива.",
      ...(priorities.includes("economy")
        ? [
            "Нет местных цен и затрат: экономическая жизнеспособность не оценена, вес экономике не присвоен.",
          ]
        : []),
    ];
    const warnings = [
      ...(count < 3
        ? [
            `Получилось ${count} разных стратегий. Ограничения по культурам и длине сезона не дают добавить варианты без повторения плана.`,
          ]
        : []),
      ...missing,
      "Баллы — эвристика пригодности. Историческая погода не предсказывает будущие сезоны.",
    ];
    return {
      field_id: fieldId,
      name,
      priorities,
      constraints: { ...constraints, planYear },
      crop_sequence: sequence.map((c) => c.id),
      analysis_result: {
        score: format(score(candidate.points, weights) / horizon),
        reasons,
        warnings,
        risks,
        sources,
        criteria: {
          soil: format(candidate.points.soil / horizon),
          water: format(candidate.points.water / horizon),
          climate: climateSignalsAvailable
            ? format(candidate.points.climate / horizon)
            : null,
        },
      },
    };
  }
  return [
    explain(
      baseline,
      hasPlan
        ? `Текущий план: ${constraints.currentName ?? "выбранная последовательность"}`
        : "Кандидат для рассмотрения",
      true,
    ),
    ...(water
      ? [explain(water, "Альтернатива: потребность в воде", false)]
      : []),
    ...(resilience
      ? [
          explain(
            resilience,
            climateFocus && climateSignalsAvailable
              ? "Альтернатива: климатический риск"
              : "Альтернатива: здоровье почвы",
            false,
          ),
        ]
      : []),
  ];
}

export function compareWaterRanges(
  base: [number, number],
  alternative: [number, number],
): string {
  const prefix = `Справочный диапазон: ${format(base[0])}–${format(base[1])} → ${format(alternative[0])}–${format(alternative[1])} мм за сезон. `;
  if (alternative[0] === base[0] && alternative[1] === base[1])
    return prefix + "Диапазоны равны. Снижение не подтверждено.";
  if (alternative[1] < base[0])
    return (
      prefix +
      "Справочный диапазон ниже исходного. Это не прогноз экономии полива."
    );
  if (alternative[0] > base[1])
    return (
      prefix + "Справочная потребность выше исходной. Снижение не подтверждено."
    );
  return prefix + "Диапазоны пересекаются: снижение не подтверждено.";
}
