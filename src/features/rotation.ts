import type { Crop, Season, Scenario, Observation } from "../lib/types";
import { climateSummary } from "./climate";
export interface Constraints {
  allowed: string[];
  excluded: string[];
  horizon: number;
  irrigation: boolean;
  maxSeasonDays: number;
}
export function generateRotations(
  crops: Crop[],
  history: Season[],
  fieldId: string,
  priorities: string[],
  constraints: Constraints,
  climate: Observation[] = [],
): Scenario[] {
  if (
    !Number.isInteger(constraints.horizon) ||
    constraints.horizon < 2 ||
    constraints.horizon > 5
  )
    throw new Error("Горизонт должен быть от 2 до 5 лет.");
  const allowed = crops.filter(
    (c) =>
      constraints.allowed.includes(c.id) &&
      !constraints.excluded.includes(c.id) &&
      c.growing_season_days <= constraints.maxSeasonDays,
  );
  if (!allowed.length)
    throw new Error("Нет культур, соответствующих ограничениям.");
  const last = crops.find(
    (c) => c.id === [...history].sort((a, b) => b.year - a.year)[0]?.crop_id,
  );
  const weather = climateSummary(climate);
  const dry =
    climate.length > 300 && weather.missing < 30 && weather.longestDry >= 14;
  function evaluate(sequence: Crop[], name: string): Scenario {
    let score = 0;
    let previous = last;
    const reasons: string[] = [];
    const warnings: string[] = [];
    let repeat = 0,
      legumes = 0,
      water = 0;
    for (const crop of sequence) {
      if (previous?.crop_family === crop.crop_family) {
        repeat++;
        score -= 3;
      } else if (previous) score += 2;
      previous = crop;
      if (crop.nitrogen_fixation) {
        legumes++;
        score += priorities.includes("soil") ? 3 : 1;
      }
      water += crop.water_requirement_min_mm;
      if (priorities.includes("water"))
        score -= crop.water_requirement_min_mm / 100;
      if (dry && !constraints.irrigation) {
        if (crop.drought_tolerance === "high")
          score += priorities.includes("climate") ? 3 : 1;
        else if (crop.drought_tolerance === "low") {
          score -= 3;
          warnings.push(
            `${crop.name}: низкая засухоустойчивость при выявленном сухом периоде.`,
          );
        }
      }
      if (!allowed.some((c) => c.id === crop.id))
        warnings.push(
          `${crop.name}: не соответствует выбранным ограничениям (базовый сценарий).`,
        );
    }
    reasons.push(
      `${new Set(sequence.map((c) => c.crop_family)).size} семейства; ${repeat} последовательных повторов с учётом последнего сезона.`,
    );
    reasons.push(
      `${legumes} бобовых сезона: возможная фиксация азота при подходящих условиях.`,
    );
    reasons.push(
      `Средняя нижняя граница справочной потребности: ${Math.round(water / sequence.length)} мм за сезон. Это не расчёт полива.`,
    );
    if (repeat)
      warnings.push(
        "Повторение семейства может повышать фитосанитарные риски; требуется местная проверка.",
      );
    if (!history.length)
      warnings.push("История культур отсутствует: предшественник неизвестен.");
    if (!climate.length)
      warnings.push(
        "Климатические наблюдения не загружены: пригодность по климату не подтверждена.",
      );
    else if (dry)
      reasons.push(
        `В наблюдениях: сухой период ${weather.longestDry} дней (осадки < 1 мм/сут). Засухоустойчивость учтена в правилах.`,
      );
    else
      warnings.push(
        "Нет достаточных оснований для климатического ранжирования; исторический климат не является прогнозом.",
      );
    if (priorities.includes("economy"))
      warnings.push(
        "Нет местных цен и затрат: экономическая жизнеспособность не оценена.",
      );
    warnings.push(
      "Урожайность и улучшение почвы не прогнозируются. Уточните сорта, сроки, рынок и фитосанитарные интервалы с местным агрономом.",
    );
    return {
      field_id: fieldId,
      name,
      priorities,
      constraints: { ...constraints },
      crop_sequence: sequence.map((c) => c.id),
      analysis_result: {
        score: Math.round(score * 10) / 10,
        reasons,
        warnings: [...new Set(warnings)],
      },
    };
  }
  const candidates: Scenario[] = [];
  function enumerate(seq: Crop[]) {
    if (seq.length === constraints.horizon) {
      candidates.push(evaluate(seq, ""));
      return;
    }
    for (const crop of allowed) enumerate([...seq, crop]);
  }
  enumerate([]);
  candidates.sort(
    (a, b) =>
      b.analysis_result.score - a.analysis_result.score ||
      a.crop_sequence.join().localeCompare(b.crop_sequence.join()),
  );
  const baseline = evaluate(
    Array.from({ length: constraints.horizon }, () => last ?? allowed[0]),
    last ? "Базовый: последняя культура" : "Базовый: первая доступная культура",
  );
  const choices = candidates.filter(
    (c) => c.crop_sequence.join() !== baseline.crop_sequence.join(),
  );
  const a = choices[0] ?? candidates[0];
  const b =
    choices.find(
      (c) =>
        c.crop_sequence.join() !== a.crop_sequence.join() &&
        c.crop_sequence[0] !== a.crop_sequence[0],
    ) ??
    choices[1] ??
    a;
  return [
    baseline,
    { ...a, name: "Альтернатива A" },
    {
      ...b,
      name: "Альтернатива B",
      analysis_result: {
        ...b.analysis_result,
        warnings:
          b === a
            ? [
                "Ограничения допускают только одну альтернативу. Этот вариант совпадает с A.",
                ...b.analysis_result.warnings,
              ]
            : b.analysis_result.warnings,
      },
    },
  ];
}
