import type {
  AdvisorContext,
  AdvisorInput,
  AdvisorLanguage,
} from "../_shared/advisor-contract.ts";
import { powerMetrics } from "../_shared/power-metrics.ts";
import type { ClimateDay } from "../_shared/power.ts";
import { record } from "./handler.ts";

type Source = { source: string; url?: string };
const power = { source: "NASA POWER", url: "https://power.larc.nasa.gov/" };
const hls = { source: "NASA HLS", url: "https://hls.gsfc.nasa.gov/" };
const soil = { source: "ISRIC SoilGrids", url: "https://soilgrids.org/" };
const srtm = {
  source: "NASA SRTM",
  url: "https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1.003",
};
const cropTranslations: Record<string, [string, string]> = {
  Пшеница: ["бидай", "wheat"],
  Ячмень: ["арпа", "barley"],
  Горох: ["асбұршақ", "pea"],
  Подсолнечник: ["күнбағыс", "sunflower"],
  Соя: ["соя", "soybean"],
};
export const number = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(record) : [];
const fraction = (value: unknown): value is number =>
  number(value) && value >= 0 && value <= 1;
const count = (value: unknown): value is number =>
  number(value) && Number.isInteger(value) && value >= 0;
type Crop = {
  id: string;
  name: string;
  crop_family: string;
  water_requirement_min_mm: number;
  water_requirement_max_mm: number;
};

export type AdvisorSources = {
  weather: ClimateDay[];
  hls: unknown;
  hlsComplete: boolean;
  soil: unknown;
  terrain: unknown;
  crops: Crop[];
  seasons: { year: number; crop_id: string }[];
  scenario?: {
    sequence: unknown;
    baseline: unknown;
    score: unknown;
    criteria: unknown;
    maxDays: unknown;
    planYear: unknown;
    irrigation: unknown;
    start: string;
    end: string;
    comparison: unknown;
  };
};

export function buildContext(
  input: AdvisorInput,
  data: AdvisorSources,
): AdvisorContext {
  const t = (ru: string, kk: string, en: string) =>
    ({ ru, kk, en })[input.language];
  const n = (value: number, max = 1) =>
    new Intl.NumberFormat(input.language, {
      maximumFractionDigits: max,
    }).format(value);
  const context: AdvisorContext = {
    facts: {},
    interpretations: {},
    actions: {},
    limitations: [],
    defaultSummary: t(
      "За выбранный период ниже показаны доступные данные поля и то, что стоит уточнить.",
      "Төменде таңдалған кезеңдегі егістік деректері және нақтылауды қажет ететін мәліметтер көрсетілген.",
      "Below are the field data available for the selected period and the gaps to check.",
    ),
  };
  const fact = (key: string, source: Source, text: string, date?: string) => {
    context.facts[key] = { ...source, text, date };
  };
  const note = (ru: string, kk: string, en: string) =>
    context.limitations.push(t(ru, kk, en));
  const days = (Date.parse(input.end) - Date.parse(input.start)) / 86400000 + 1;
  const metrics = powerMetrics(data.weather, days);
  if (
    metrics.mean === null &&
    metrics.rain === null &&
    metrics.hotDays === null &&
    metrics.frostDays === null
  ) {
    note(
      "Нет сохранённых наблюдений NASA POWER за выбранные даты.",
      "Таңдалған күндер үшін NASA POWER бақылаулары сақталмаған.",
      "No NASA POWER observations are saved for the selected dates.",
    );
    context.actions.load_weather = t(
      "Откройте вкладку «Климат» и загрузите наблюдения за этот год.",
      "«Климат» қойындысын ашып, осы жылдың бақылауларын жүктеңіз.",
      "Open the Climate tab and load observations for this year.",
    );
  } else {
    const period = `${input.start} — ${input.end}`;
    const low = data.weather.flatMap((row) =>
      number(row.temperature_min) ? [row.temperature_min] : [],
    );
    const high = data.weather.flatMap((row) =>
      number(row.temperature_max) ? [row.temperature_max] : [],
    );
    if (metrics.mean !== null)
      fact(
        "power_mean",
        power,
        t(
          `Средняя температура: ${n(metrics.mean)} °C, данные за ${metrics.temperatureDays} из ${days} дней. ${period}.`,
          `Орташа температура: ${n(metrics.mean)} °C, ${days} күннің ${metrics.temperatureDays} күнінде дерек бар. ${period}.`,
          `Mean temperature: ${n(metrics.mean)} °C, data for ${metrics.temperatureDays} of ${days} days. ${period}.`,
        ),
      );
    if (low.length)
      fact(
        "power_low",
        power,
        t(
          `Самая низкая температура: ${n(Math.min(...low))} °C. Дни ниже 0 °C: ${metrics.frostDays}. Есть данные за ${low.length} из ${days} дней.`,
          `Ең төмен температура: ${n(Math.min(...low))} °C. 0 °C-тан төмен күндер: ${metrics.frostDays}. Дерек ${days} күннің ${low.length} күнінде бар.`,
          `Lowest temperature: ${n(Math.min(...low))} °C. Days below 0 °C: ${metrics.frostDays}. Data for ${low.length} of ${days} days.`,
        ),
      );
    if (high.length)
      fact(
        "power_high",
        power,
        t(
          `Самая высокая температура: ${n(Math.max(...high))} °C. Дни выше 35 °C: ${metrics.hotDays}. Есть данные за ${high.length} из ${days} дней.`,
          `Ең жоғары температура: ${n(Math.max(...high))} °C. 35 °C-тан жоғары күндер: ${metrics.hotDays}. Дерек ${days} күннің ${high.length} күнінде бар.`,
          `Highest temperature: ${n(Math.max(...high))} °C. Days above 35 °C: ${metrics.hotDays}. Data for ${high.length} of ${days} days.`,
        ),
      );
    if (metrics.rain !== null) {
      fact(
        "power_rain",
        power,
        t(
          `Осадки за дни с данными: ${n(metrics.rain)} мм. Покрытие: ${metrics.rainDays} из ${days} дней. ${period}.`,
          `Дерек бар күндердің жауын-шашыны: ${n(metrics.rain)} мм. ${days} күннің ${metrics.rainDays} күні қамтылған. ${period}.`,
          `Precipitation on observed days: ${n(metrics.rain)} mm. Coverage: ${metrics.rainDays} of ${days} days. ${period}.`,
        ),
      );
      fact(
        "power_dry",
        power,
        t(
          `Самый длинный сухой отрезок: ${metrics.longestDry} дней с осадками менее 1 мм в сутки. Пропуск прерывает серию.`,
          `Ең ұзақ құрғақ аралық: тәуліктік жауын-шашын 1 мм-ден аз болған ${metrics.longestDry} күн. Дерегі жоқ күн тізбекті үзеді.`,
          `Longest dry spell: ${metrics.longestDry} days with rain below 1 mm/day. Missing days break the sequence.`,
        ),
      );
      context.interpretations.rain = t(
        "Данные об осадках помогают найти сухие отрезки. Чтобы оценить нехватку воды для культуры, нужны ещё испарение и запас влаги в почве.",
        "Жауын-шашын деректері құрғақ аралықты анықтауға көмектеседі. Су тапшылығын бағалау үшін булану мен топырақтағы ылғал қоры да қажет.",
        "Rain observations identify dry spells. Estimating crop water shortage also requires evaporation and soil water storage.",
      );
    }
    if (metrics.frostDays || metrics.hotDays)
      context.interpretations.temperature = t(
        "Температурные экстремумы указывают, какие даты стоит сопоставить с фазами развития культуры.",
        "Шекті температура байқалған күндерді дақылдың даму кезеңдерімен салыстырыңыз.",
        "Temperature extremes identify dates worth comparing with crop development stages.",
      );
    note(
      "NASA POWER описывает климатическую ячейку около поля. Учитывайте пропуски в рядах и сверяйте экстремумы с местными наблюдениями.",
      "NASA POWER егістік маңындағы климаттық тор ұяшығын сипаттайды. Бос күндерді ескеріп, шекті мәндерді жергілікті бақылаулармен салыстырыңыз.",
      "NASA POWER represents a grid cell near the field. Account for gaps and verify extremes against local observations.",
    );
    if (
      Math.min(
        metrics.temperatureDays,
        metrics.rainDays,
        low.length,
        high.length,
      ) < days
    ) {
      note(
        "В погодных рядах есть пропуски. Суммы и экстремумы относятся только к дням с данными.",
        "Ауа райы қатарында бос күндер бар. Жиынтықтар мен шекті мәндер дерегі бар күндерге ғана қатысты.",
        "Weather series contain gaps. Totals and extremes cover only observed days.",
      );
    }
  }

  const scenes = rows(data.hls)
    .filter(
      (row) =>
        typeof row.date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
        row.date >= input.start &&
        row.date <= input.end &&
        (row.dataset === "HLSL30" || row.dataset === "HLSS30"),
    )
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const good = scenes.filter(
    (row) =>
      row.tileContainsField === true &&
      count(row.validPixels) &&
      count(row.fieldPixels) &&
      row.fieldPixels > 0 &&
      row.validPixels <= row.fieldPixels &&
      row.validPixels / row.fieldPixels >= 0.8 &&
      number(row.mean) &&
      Math.abs(row.mean) <= 1,
  );
  const dates = [...new Set(good.map((row) => row.date))];
  if (!good.length) {
    note(
      scenes.length
        ? "HLS: есть снимки, но покрытие пригодными пикселями не позволяет описать поле целиком."
        : "За выбранные даты нет сохранённого NDVI NASA HLS.",
      scenes.length
        ? "HLS суреттерінде жарамды пикселдер бүкіл егістікті сипаттауға жеткіліксіз."
        : "Таңдалған күндер үшін NASA HLS NDVI сақталмаған.",
      scenes.length
        ? "HLS scenes exist, but usable pixel coverage is too low for a field-wide assessment."
        : "No NASA HLS NDVI is saved for the selected dates.",
    );
    context.actions.load_hls = t(
      "Проверьте статус снимков на вкладке «Растительность».",
      "«Өсімдік» қойындысынан суреттердің күйін тексеріңіз.",
      "Check the scene status in the Vegetation tab.",
    );
  } else {
    const sample = new Set([
      dates[0],
      dates[Math.floor(dates.length / 2)],
      dates.at(-1),
    ]);
    [...sample].forEach((date, i) => {
      const row = good.find((item) => item.date === date)!;
      const usable = row.validPixels as number;
      const total = row.fieldPixels as number;
      const ndvi = n(row.mean as number, 3);
      fact(
        `hls_${i}`,
        hls,
        t(
          `NDVI ${ndvi} · ${row.dataset} · пригодны ${usable} из ${total} пикселей поля (${n((100 * usable) / total)}%).`,
          `NDVI ${ndvi} · ${row.dataset} · ${total} пикселдің ${usable} жарамды (${n((100 * usable) / total)}%).`,
          `NDVI ${ndvi} · ${row.dataset} · ${usable} of ${total} field pixels usable (${n((100 * usable) / total)}%).`,
        ),
        String(date),
      );
    });
    if (dates.length > 1) {
      const first = good.find((row) => row.date === dates[0])!;
      const last = good.find((row) => row.date === dates.at(-1))!;
      const endpoints = `${n(first.mean as number, 3)} (${first.date}) → ${n(last.mean as number, 3)} (${last.date})`;
      fact(
        "hls_series",
        hls,
        t(
          `Первое и последнее пригодные наблюдения NDVI: ${endpoints}. Всего дат с пригодными снимками: ${dates.length}.`,
          `Алғашқы және соңғы жарамды NDVI бақылаулары: ${endpoints}. Жарамды сурет бар күндер саны: ${dates.length}.`,
          `First and last usable NDVI observations: ${endpoints}. Usable scenes span ${dates.length} dates.`,
        ),
      );
      context.interpretations.ndvi_change = t(
        "Сравните значения NDVI по датам и сопоставьте их с фазами роста. Уборка, сезонность и состояние растений могут менять индекс.",
        "Күндер бойынша NDVI-ді дақылдың өсу кезеңдерімен салыстырыңыз. Индекске егін жинау, маусым және өсімдік жағдайы әсер етеді.",
        "Compare NDVI across dates alongside crop growth stages. Harvest, seasonality and plant condition can affect the index.",
      );
    }
    context.interpretations.ndvi = t(
      "NDVI описывает состояние растительного покрова на дату снимка. Причину низких значений уточняют по погоде, фазе развития и осмотру поля.",
      "NDVI сурет түсірілген күнгі өсімдік жамылғысын сипаттайды. Төмен мәндердің себебін ауа райы, өсу кезеңі және егістікті тексеру арқылы нақтылаңыз.",
      "NDVI describes vegetation on the scene date. Check weather, growth stage and field observations to interpret low values.",
    );
    note(
      "NDVI сам по себе не устанавливает болезнь, дефицит влаги или причину изменения.",
      "NDVI өздігінен ауруды, су тапшылығын немесе өзгеріс себебін анықтамайды.",
      "NDVI alone cannot establish disease, water shortage or the cause of a change.",
    );
  }
  if (scenes.length && (good.length < scenes.length || !data.hlsComplete))
    note(
      "Ряд HLS может быть неполным. В сводку входят только сцены с полным охватом границы и достаточной долей пригодных пикселей.",
      "HLS қатары толық болмауы мүмкін. Қысқаша есепке шекараны толық қамтитын және жарамды пикселі жеткілікті суреттер енеді.",
      "The HLS record may be incomplete. The summary uses scenes spanning the whole boundary with sufficient usable pixels.",
    );

  const soilData = record(data.soil);
  let layers = 0;
  if (
    soilData.status === "ready" &&
    soilData.dataset === "ISRIC SoilGrids 2.0" &&
    soilData.units === "g/kg"
  ) {
    for (const [i, depth] of [
      [0, 5],
      [5, 15],
      [15, 30],
    ].entries()) {
      const layer = rows(soilData.data).find(
        (row) => JSON.stringify(row.depthCm) === JSON.stringify(depth),
      );
      if (
        !layer ||
        !fraction(layer.areaCoverageFraction) ||
        layer.areaCoverageFraction <= 0
      )
        continue;
      const { sand, silt, clay } = record(layer.mean);
      if (
        !number(sand) ||
        !number(silt) ||
        !number(clay) ||
        [sand, silt, clay].some((value) => value < 0 || value > 1000) ||
        Math.abs(sand + silt + clay - 1000) > 5.1
      )
        continue;
      const coverage = n(100 * layer.areaCoverageFraction, 2);
      const values = [sand, silt, clay].map((value) => n(value / 10));
      fact(
        `soil_${i}`,
        soil,
        t(
          `Слой ${depth.join("–")} см: песок ${values[0]}%, ил ${values[1]}%, глина ${values[2]}%. Покрытие контура: ${coverage}%.`,
          `${depth.join("–")} см қабат: құм ${values[0]}%, шаң ${values[1]}%, саз ${values[2]}%. Контурдың қамтылуы: ${coverage}%.`,
          `${depth.join("–")} cm layer: sand ${values[0]}%, silt ${values[1]}%, clay ${values[2]}%. Boundary coverage: ${coverage}%.`,
        ),
      );
      layers++;
    }
  }
  if (layers) {
    context.interpretations.soil = t(
      "Состав почвы помогает понять, какие свойства нужно уточнить. Для оценки доступной растениям воды нужны влагоёмкость и глубина корней.",
      "Топырақ құрамы қай қасиеттерді нақтылау керегін көрсетеді. Өсімдікке қолжетімді суды бағалау үшін су сыйымдылығы мен тамыр тереңдігі қажет.",
      "Texture helps identify what to verify. Plant-available water also requires water-holding capacity and rooting depth.",
    );
    note(
      "SoilGrids: модельная оценка на сетке 250 м. Для этой выборки нет интервала неопределённости.",
      "SoilGrids: 250 м тордағы модельдік бағалау. Бұл үлгі үшін белгісіздік аралығы жоқ.",
      "SoilGrids is a model estimate on a 250 m grid. This extract does not include a prediction interval.",
    );
  } else {
    note(
      soilData.status === "source_unavailable"
        ? "Сейчас не удалось загрузить состав почвы из SoilGrids. Для оценки доступной влаги нужен анализ почвы."
        : "Нет пригодной оценки состава почвы SoilGrids для этого контура. Доступный запас воды в корнеобитаемом слое не оценён.",
      soilData.status === "source_unavailable"
        ? "SoilGrids деректері жүктелмеді. Қолжетімді ылғалды бағалау үшін топырақты талдау керек."
        : "Бұл контур үшін SoilGrids топырақ құрамын бағалай алмады. Тамыр қабатындағы қолжетімді су қоры бағаланбаған.",
      soilData.status === "source_unavailable"
        ? "SoilGrids could not be loaded. A soil analysis is needed to assess available water."
        : "No usable SoilGrids texture estimate for this boundary. Water storage in the root zone cannot be assessed.",
    );
    context.actions.check_soil = t(
      "Уточните состав и влагоёмкость по анализу проб с поля.",
      "Егістік үлгілерінен топырақтың құрамы мен су сыйымдылығын анықтаңыз.",
      "Use field samples to verify texture and water-holding capacity.",
    );
  }
  context.actions.check_water = t(
    "Для оценки полива уточните запасы влаги, глубину корней, эффективные осадки и доступный объём воды.",
    "Суаруды бағалау үшін ылғал қорын, тамыр тереңдігін, тиімді жауын-шашынды және қолжетімді су көлемін анықтаңыз.",
    "For irrigation planning, check soil water storage, rooting depth, effective rainfall and available water.",
  );

  const terrain = record(data.terrain);
  const m = record(terrain.metrics);
  if (
    (terrain.status === "ready" || terrain.status === "insufficient") &&
    count(m.cells) &&
    m.cells > 0
  ) {
    const addTerrain = (key: "elevation" | "slope") => {
      const mean = record(m[key]).mean;
      const used = m[key === "elevation" ? "elevationCells" : "slopeCells"];
      if (
        !number(mean) ||
        !count(used) ||
        used < 4 ||
        used > (m.cells as number)
      )
        return;
      const value = `${n(mean)} ${key === "slope" ? "°" : t("м", "м", "m")}`;
      fact(
        `terrain_${key}`,
        srtm,
        t(
          `${key === "slope" ? "Средний уклон" : "Средняя высота"} пригодных ячеек: ${value}. Покрытие: ${used} из ${m.cells} ячеек.`,
          `Жарамды ұяшықтардың ${key === "slope" ? "орташа еңістігі" : "орташа биіктігі"}: ${value}. ${m.cells} ұяшықтың ${used} жарамды.`,
          `Mean ${key} of usable cells: ${value}. Coverage: ${used} of ${m.cells} cells.`,
        ),
      );
    };
    addTerrain("elevation");
    addTerrain("slope");
  }
  if (context.facts.terrain_elevation || context.facts.terrain_slope) {
    note(
      "Рельеф SRTM рассчитан по поверхности на сетке около 30 м. Пропуски и мелкие особенности рельефа учитывайте при осмотре поля.",
      "SRTM жер бедері шамамен 30 м тор бойынша бағаланған. Ұсақ ерекшеліктер мен бос ұяшықтарды егістікті тексергенде ескеріңіз.",
      "SRTM terrain uses an approximately 30 m grid. Check gaps and smaller terrain features on the ground.",
    );
    if (terrain.status === "insufficient")
      note(
        "Покрытие SRTM недостаточно для оценки всего поля.",
        "SRTM бүкіл егістікті бағалауға жеткіліксіз.",
        "SRTM coverage is insufficient for a field-wide estimate.",
      );
  } else {
    note(
      "Для текущей границы нет пригодной сохранённой оценки SRTM.",
      "Бұл шекара үшін жарамды SRTM бағалауы сақталмаған.",
      "No usable SRTM estimate is saved for this boundary.",
    );
  }

  const cropById = new Map(data.crops.map((crop) => [crop.id, crop]));
  const cropName = (crop: Crop, lang: AdvisorLanguage) =>
    (lang === "ru"
      ? crop.name
      : cropTranslations[crop.name]?.[lang === "kk" ? 0 : 1]) ?? crop.name;
  const history = data.seasons
    .flatMap(({ year, crop_id }) => {
      const crop = cropById.get(crop_id);
      return crop ? [`${year}: ${cropName(crop, input.language)}`] : [];
    })
    .slice(0, 8);
  if (history.length)
    fact(
      "history",
      { source: t("История посевов", "Егіс тарихы", "Planting history") },
      history.join(" · "),
    );
  if (history.length < 2)
    note(
      "Истории посевов недостаточно для проверки чередования и повторов культур.",
      "Дақылдардың кезектесуі мен қайталануын тексеруге егіс тарихы жеткіліксіз.",
      "The planting history is too short to check previous crops and recurrence.",
    );
  if (data.scenario)
    addRotation(
      data.scenario,
      cropById,
      (crop) => cropName(crop, input.language),
      t,
      n,
      context,
    );
  else if (input.mode === "chat") {
    context.actions.build_plan = t(
      "Чтобы обсудить культуры, сначала сформируйте и сохраните сценарий севооборота для этого поля и года.",
      "Дақылдарды талқылау үшін осы егістік пен жылға ауыспалы егіс нұсқасын есептеп, сақтаңыз.",
      "To discuss crops, generate and save a rotation scenario for this field and year first.",
    );
  }
  if (!Object.keys(context.facts).length)
    context.defaultSummary = t(
      "За выбранный период нет достаточно данных для оценки поля. Ниже указано, что можно проверить.",
      "Таңдалған кезеңде егістікті бағалауға дерек жеткіліксіз. Төменде нені тексеруге болатыны көрсетілген.",
      "There are too few data for a field assessment in the selected period. See what to check below.",
    );
  return context;
}

function addRotation(
  scenario: NonNullable<AdvisorSources["scenario"]>,
  catalog: Map<string, Crop>,
  cropName: (crop: Crop) => string,
  t: (ru: string, kk: string, en: string) => string,
  n: (value: number, digits?: number) => string,
  context: AdvisorContext,
) {
  const source = t(
    "Сохранённый расчёт AGRONA",
    "AGRONA сақталған есебі",
    "Saved AGRONA calculation",
  );
  const fact = (key: string, text: string) => {
    context.facts[key] = { source, text };
  };
  const readSequence = (value: unknown) =>
    Array.isArray(value) && value.length <= 20
      ? value.flatMap((id) =>
          typeof id === "string" && catalog.has(id) ? [catalog.get(id)!] : [],
        )
      : [];
  const plan = readSequence(scenario.sequence);
  const baseline = readSequence(scenario.baseline);
  const planYear =
    count(scenario.planYear) &&
    scenario.planYear >= 1984 &&
    scenario.planYear <= 2201
      ? scenario.planYear
      : null;
  const sequence = (crops: Crop[]) =>
    crops
      .map((crop, i) =>
        planYear ? `${planYear + i} ${cropName(crop)}` : cropName(crop),
      )
      .join(" → ");
  if (
    plan.length &&
    Array.isArray(scenario.sequence) &&
    plan.length === scenario.sequence.length
  ) {
    fact("rotation_plan", sequence(plan));
    const familyCount = new Set(plan.map((crop) => crop.crop_family)).size;
    const repeat = plan
      .slice(1)
      .filter((crop, i) => plan[i].crop_family === crop.crop_family).length;
    fact(
      "rotation_families",
      t(
        `Семейств в плане: ${familyCount}. Повторов одного семейства в соседних сезонах: ${repeat}.`,
        `Жоспарда ${familyCount} тұқымдас бар. Қатар маусымда бір тұқымдас ${repeat} рет қайталанады.`,
        `Families in the plan: ${familyCount}. Same-family repeats in adjacent seasons: ${repeat}.`,
      ),
    );
    if (repeat)
      context.actions.check_family = t(
        "Проверьте допустимые интервалы возврата культур этого семейства.",
        "Осы тұқымдас дақылдарының қайтару аралығын нақтылаңыз.",
        "Verify the recurrence interval for crops in this family.",
      );
    const water = (
      key: "water_requirement_min_mm" | "water_requirement_max_mm",
    ) => plan.reduce((sum, crop) => sum + crop[key], 0) / plan.length;
    if (
      plan.every(
        (crop) =>
          number(crop.water_requirement_min_mm) &&
          number(crop.water_requirement_max_mm),
      )
    ) {
      const range = `${n(water("water_requirement_min_mm"))}–${n(water("water_requirement_max_mm"))}`;
      fact(
        "rotation_water",
        t(
          `Средняя справочная потребность культур в воде: ${range} мм за сезон.`,
          `Дақылдардың анықтамалық су қажеттілігі: маусымына ${range} мм.`,
          `Mean catalog crop water requirement: ${range} mm per season.`,
        ),
      );
    }
  }
  if (
    baseline.length &&
    Array.isArray(scenario.baseline) &&
    baseline.length === scenario.baseline.length
  )
    fact(
      "rotation_baseline",
      t(
        `Исходный план: ${sequence(baseline)}.`,
        `Бастапқы жоспар: ${sequence(baseline)}.`,
        `Baseline plan: ${sequence(baseline)}.`,
      ),
    );
  const variants = rows(scenario.comparison)
    .slice(0, 3)
    .flatMap((variant) => {
      const crops = readSequence(variant.crop_sequence);
      return Array.isArray(variant.crop_sequence) &&
        crops.length === variant.crop_sequence.length &&
        crops.length &&
        number(record(variant.analysis_result).score)
        ? [
            `${sequence(crops)} (${n(record(variant.analysis_result).score as number)})`,
          ]
        : [];
    });
  if (variants.length > 1)
    fact(
      "rotation_variants",
      t(
        `Другие последовательности и их справочные баллы: ${variants.join(" · ")}.`,
        `Салыстырылған реттіліктер және анықтамалық ұпайлар: ${variants.join(" · ")}.`,
        `Compared sequences and their screening scores: ${variants.join(" · ")}.`,
      ),
    );
  const criteria = record(scenario.criteria);
  if (
    number(scenario.score) &&
    number(criteria.soil) &&
    number(criteria.water)
  ) {
    const climate = number(criteria.climate)
      ? n(criteria.climate)
      : t("нет оценки", "бағалау жоқ", "unscored");
    fact(
      "rotation_score",
      t(
        `Справочный балл: ${n(scenario.score)}. Почва и история: ${n(criteria.soil)}, вода: ${n(criteria.water)}, климат: ${climate}.`,
        `Анықтамалық ұпай: ${n(scenario.score)}. Топырақ және тарих: ${n(criteria.soil)}, су: ${n(criteria.water)}, климат: ${climate}.`,
        `Screening score: ${n(scenario.score)}. Soil and history: ${n(criteria.soil)}, water: ${n(criteria.water)}, climate: ${climate}.`,
      ),
    );
  }
  if (
    count(scenario.maxDays) &&
    scenario.maxDays > 0 &&
    scenario.maxDays <= 366
  ) {
    fact(
      "rotation_days",
      t(
        `Введённое ограничение сезона: ${scenario.maxDays} дней. Опорный период: ${scenario.start} — ${scenario.end}.`,
        `Енгізілген маусым шегі: ${scenario.maxDays} күн. Тірек кезең: ${scenario.start} — ${scenario.end}.`,
        `Entered season limit: ${scenario.maxDays} days. Reference period: ${scenario.start} — ${scenario.end}.`,
      ),
    );
  }
  if (typeof scenario.irrigation === "boolean")
    fact(
      "rotation_irrigation",
      scenario.irrigation
        ? t(
            "В плане отмечено доступное орошение. Объём и график не подтверждены.",
            "Жоспарда суару бар деп көрсетілген. Көлемі мен кестесі расталмаған.",
            "The plan marks irrigation as available. Supply and timing were not verified.",
          )
        : t(
            "В сохранённом расчёте орошение не отмечено как доступное.",
            "Сақталған есепте суару қолжетімді деп көрсетілмеген.",
            "The saved calculation did not mark irrigation as available.",
          ),
    );
  context.defaultSummary = t(
    "Сохранённый расчёт сравнивает варианты по каталогу культур, истории поля и доступным климатическим данным.",
    "Сақталған есеп дақылдар каталогы, егіс тарихы және қолжетімді климаттық деректер бойынша нұсқаларды салыстырады.",
    "The saved calculation compares options using the crop catalog, field history and available climate data.",
  );
  context.interpretations.rotation = t(
    "Чередование семейств, сезонное окно и справочная потребность в воде влияют на оценку плана.",
    "Тұқымдастардың кезектесуі, маусым аралығы және анықтамалық су қажеттілігі жоспар бағасына әсер етеді.",
    "Family rotation, the season window and catalog water requirements contribute to the plan's score.",
  );
  context.actions.check_calendar = t(
    "Уточните местный календарь посева и уборки и возможность перехода между культурами.",
    "Жергілікті себу мен жинау күнтізбесін және дақылдар арасындағы ауысуды нақтылаңыз.",
    "Verify the local planting and harvest calendar and transition feasibility.",
  );
  context.limitations.push(
    t(
      "Баллы и ограничения взяты из сохранённого расчёта. Это ориентиры для сравнения. Нет проверенного местного календаря и расчёта объёма полива.",
      "Ұпайлар мен шектеулер сақталған есептен алынған. Олар салыстыруға арналған. Жергілікті күнтізбе мен суару көлемі тексерілмеген.",
      "Scores and limits come from the saved calculation. They are for comparison. No validated local calendar or irrigation-volume estimate is available.",
    ),
  );
}
