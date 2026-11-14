import { area, polygon } from "@turf/turf";
import type { FarmData, Crop } from "./types";
export const crops: Crop[] = [
  ["Пшеница", "Triticum aestivum", "Poaceae", 120, 450, 650, false, "medium"],
  ["Ячмень", "Hordeum vulgare", "Poaceae", 100, 450, 650, false, "high"],
  ["Горох", "Pisum sativum", "Fabaceae", 100, 350, 500, true, "low"],
  [
    "Подсолнечник",
    "Helianthus annuus",
    "Asteraceae",
    130,
    600,
    1000,
    false,
    "high",
  ],
  ["Соя", "Glycine max", "Fabaceae", 130, 450, 700, true, "medium"],
].map((c, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  name: String(c[0]),
  scientific_name: String(c[1]),
  crop_family: String(c[2]),
  growing_season_days: Number(c[3]),
  water_requirement_min_mm: Number(c[4]),
  water_requirement_max_mm: Number(c[5]),
  nitrogen_fixation: Boolean(c[6]),
  drought_tolerance: String(c[7]),
}));
export const initialDemo: FarmData = {
  farms: [
    {
      id: "demo-farm",
      user_id: "demo",
      name: "Зелёная долина",
      country: "Казахстан",
      region: "Акмолинская область",
    },
  ],
  fields: [
    {
      id: "demo-field-1",
      farm_id: "demo-farm",
      name: "Северное поле",
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [69.36, 51.19],
            [69.38, 51.191],
            [69.379, 51.204],
            [69.359, 51.203],
            [69.36, 51.19],
          ],
        ],
      },
      area_hectares: 202,
      soil_type: "Суглинок",
      irrigation_type: "Без орошения",
    },
    {
      id: "demo-field-2",
      farm_id: "demo-farm",
      name: "Южное поле",
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [69.362, 51.174],
            [69.38, 51.175],
            [69.38, 51.186],
            [69.361, 51.185],
            [69.362, 51.174],
          ],
        ],
      },
      area_hectares: 158,
      soil_type: "Чернозём",
      irrigation_type: "Дождевание",
    },
  ],
  seasons: [
    {
      id: "demo-season-1",
      field_id: "demo-field-1",
      year: 2025,
      crop_id: crops[0].id,
      planting_date: "2025-05-15",
      harvest_date: "2025-09-10",
      yield_tons_per_hectare: 2.4,
      irrigation_amount_mm: 0,
      notes: "Пример записи — не реальные данные",
    },
    {
      id: "demo-season-2",
      field_id: "demo-field-1",
      year: 2024,
      crop_id: crops[2].id,
      planting_date: null,
      harvest_date: null,
      yield_tons_per_hectare: 1.8,
      irrigation_amount_mm: 0,
      notes: "Пример записи",
    },
  ],
  crops,
  scenarios: [],
};

initialDemo.fields.forEach((field) => {
  field.area_hectares = area(polygon(field.boundary.coordinates)) / 10000;
});
