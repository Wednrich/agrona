import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth";
import { supabase } from "./supabase";
import { initialDemo } from "./demo";
import type { FarmData, Field } from "./types";
import { area, polygon, kinks } from "@turf/turf";
const demoKey = "field-shift-demo-v1";
function demoData(): FarmData {
  const value = localStorage.getItem(demoKey);
  if (value) {
    try {
      return JSON.parse(value);
    } catch {
      localStorage.removeItem(demoKey);
    }
  }
  return structuredClone(initialDemo);
}
export function validateBoundary(boundary: Field["boundary"]) {
  if (
    !boundary ||
    boundary.type !== "Polygon" ||
    !Array.isArray(boundary.coordinates) ||
    boundary.coordinates.length !== 1
  )
    throw new Error("Нужен полигон без внутренних колец.");
  const ring = boundary.coordinates[0];
  if (
    ring.length < 4 ||
    ring.length > 10000 ||
    ring.some(
      (p) =>
        p.length !== 2 ||
        !p.every(Number.isFinite) ||
        Math.abs(p[0]) > 180 ||
        Math.abs(p[1]) > 90,
    ) ||
    JSON.stringify(ring[0]) !== JSON.stringify(ring[ring.length - 1])
  )
    throw new Error("Некорректные координаты или незамкнутая граница.");
  const p = polygon(boundary.coordinates);
  if (kinks(p).features.length || area(p) < 1)
    throw new Error("Граница пересекает себя или площадь слишком мала.");
  return area(p) / 10000;
}
export function useData() {
  const { demo, user } = useAuth();
  const client = useQueryClient();
  const key = ["farm-data", demo ? "demo" : user?.id];
  const query = useQuery<FarmData>({
    queryKey: key,
    enabled: demo || !!user,
    queryFn: async () => {
      if (demo) return demoData();
      if (!supabase) throw new Error("Supabase не настроен");
      const tables = [
        "farms",
        "field_geojson",
        "field_seasons",
        "crops",
        "rotation_scenarios",
      ] as const;
      const results = await Promise.all(
        tables.map((t) => supabase!.from(t).select("*")),
      );
      for (const r of results) if (r.error) throw r.error;
      return {
        farms: results[0].data!,
        fields: results[1].data!,
        seasons: results[2].data!,
        crops: results[3].data!,
        scenarios: results[4].data!,
      } as FarmData;
    },
  });
  async function save(
    table:
      "farms" | "fields" | "field_seasons" | "rotation_scenarios" | "profiles",
    row: Record<string, unknown>,
    remove = false,
  ) {
    if (table === "fields" && !remove) {
      row = {
        ...row,
        area_hectares: validateBoundary(row.boundary as Field["boundary"]),
      };
    }
    if (!remove && table === "field_seasons") {
      if (
        !Number.isInteger(row.year) ||
        Number(row.year) < 1900 ||
        Number(row.year) > 2200
      )
        throw new Error("Укажите допустимый год.");
      for (const name of ["yield_tons_per_hectare", "irrigation_amount_mm"]) {
        if (
          row[name] !== null &&
          (!Number.isFinite(row[name]) || Number(row[name]) < 0)
        )
          throw new Error(
            "Урожайность и орошение не могут быть отрицательными.",
          );
      }
      if (
        row.planting_date &&
        row.harvest_date &&
        String(row.harvest_date) < String(row.planting_date)
      )
        throw new Error("Дата уборки должна быть не раньше даты посева.");
    }
    if (
      !remove &&
      (table === "farms" || table === "fields") &&
      !String(row.name ?? "").trim()
    )
      throw new Error("Введите название.");
    if (demo) {
      if (table === "profiles") throw new Error("Профиль недоступен в демо.");
      const data = demoData();
      const prop = (
        {
          farms: "farms",
          fields: "fields",
          field_seasons: "seasons",
          rotation_scenarios: "scenarios",
        } as const
      )[table];
      const arr = data[prop] as unknown as Record<string, unknown>[];
      const id = row.id ?? crypto.randomUUID();
      if (remove) {
        const index = arr.findIndex((x) => x.id === id);
        if (index >= 0) arr.splice(index, 1);
        if (table === "farms") {
          const ids = data.fields
            .filter((x) => x.farm_id === id)
            .map((x) => x.id);
          data.fields = data.fields.filter((x) => x.farm_id !== id);
          data.seasons = data.seasons.filter((x) => !ids.includes(x.field_id));
          data.scenarios = data.scenarios.filter(
            (x) => !ids.includes(x.field_id),
          );
        }
        if (table === "fields") {
          data.seasons = data.seasons.filter((x) => x.field_id !== id);
          data.scenarios = data.scenarios.filter((x) => x.field_id !== id);
        }
      } else {
        if (
          table === "field_seasons" &&
          data.seasons.some(
            (x) =>
              x.field_id === row.field_id && x.year === row.year && x.id !== id,
          )
        )
          throw new Error("Сезон за этот год уже существует.");
        const index = arr.findIndex((x) => x.id === id);
        if (index >= 0) arr[index] = { ...arr[index], ...row, id };
        else arr.push({ ...row, id });
      }
      localStorage.setItem(demoKey, JSON.stringify(data));
    } else {
      if (!supabase) throw new Error("Supabase не настроен");
      const payload =
        table === "fields" && !remove
          ? {
              ...row,
              boundary: `SRID=4326;POLYGON((${(row.boundary as Field["boundary"]).coordinates[0].map((p) => p.join(" ")).join(",")}))`,
            }
          : row;
      if (table === "fields" && !remove) {
        const { data: saved, error } = await supabase
          .from("fields")
          .upsert(payload)
          .select("id")
          .single();
        if (error) throw error;
        void supabase.functions
          .invoke("hls-vegetation", {
            body: { fieldId: saved.id, year: new Date().getUTCFullYear() - 1 },
          })
          .then(({ error }) => {
            if (error)
              console.warn(
                "NASA HLS analysis could not be queued",
                error.message,
              );
          })
          .catch((error) =>
            console.warn("NASA HLS analysis could not be queued", error),
          );
      } else {
        const result = remove
          ? await supabase.from(table).delete().eq("id", row.id)
          : await supabase.from(table).upsert(payload);
        if (result.error) throw result.error;
      }
    }
    await client.invalidateQueries({ queryKey: key });
  }
  return { ...query, save };
}
