import type { Polygon } from "geojson";
export interface Farm {
  id: string;
  user_id: string;
  name: string;
  country: string;
  region: string;
}
export interface Field {
  id: string;
  farm_id: string;
  name: string;
  boundary: Polygon;
  area_hectares: number;
  soil_type: string;
  irrigation_type: string;
}
export interface Season {
  id: string;
  field_id: string;
  year: number;
  crop_id: string;
  planting_date: string | null;
  harvest_date: string | null;
  yield_tons_per_hectare: number | null;
  irrigation_amount_mm: number | null;
  notes: string;
}
export interface Crop {
  id: string;
  name: string;
  scientific_name: string;
  crop_family: string;
  growing_season_days: number;
  water_requirement_min_mm: number;
  water_requirement_max_mm: number;
  nitrogen_fixation: boolean;
  drought_tolerance: string;
}
export interface Observation {
  humidity?: number | null;
  wind_speed?: number | null;
  observation_date: string;
  temperature_mean: number | null;
  temperature_max: number | null;
  temperature_min: number | null;
  precipitation_mm: number | null;
  solar_radiation: number | null;
}
export interface Scenario {
  id?: string;
  field_id: string;
  name: string;
  priorities: string[];
  constraints: Record<string, unknown>;
  crop_sequence: string[];
  analysis_result: { reasons: string[]; warnings: string[]; score: number };
}
export interface FarmData {
  farms: Farm[];
  fields: Field[];
  seasons: Season[];
  crops: Crop[];
  scenarios: Scenario[];
}
