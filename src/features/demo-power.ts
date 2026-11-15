import { t } from "../lib/i18n";
import { centroid } from "@turf/turf";
import { initialDemo } from "../lib/demo";
import type { Field, Observation } from "../lib/types";
import { fetchPower } from "../../supabase/functions/_shared/power-provider";

export function usesStoredDemoPower(field: Field, year: number) {
  const original = initialDemo.fields[0];
  return (
    year === 2025 &&
    field.id === original.id &&
    JSON.stringify(field.boundary) === JSON.stringify(original.boundary)
  );
}

export async function loadDemoPower(
  field: Field,
  year: number,
): Promise<{ observations: Observation[]; cached: boolean }> {
  if (usesStoredDemoPower(field, year)) {
    const response = await fetch("/demo-power-2025.json");
    if (!response.ok)
      throw new Error(t("Сохранённые наблюдения NASA POWER недоступны."));
    return response.json();
  }
  const [longitude, latitude] = centroid(field.boundary).geometry.coordinates;
  const { observations } = await fetchPower(year, longitude, latitude);
  return { observations, cached: false };
}
