import { t } from "./i18n";
import { writeField } from "./field-write";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth";
import { supabase } from "./supabase";
import { initialDemo } from "./demo";
import type { FarmData } from "./types";
import { validateBoundary } from "./field-boundary";
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
export function useData() {
  const { demo, user } = useAuth();
  const client = useQueryClient();
  const key = ["farm-data", demo ? "demo" : user?.id];
  const query = useQuery<FarmData>({
    queryKey: key,
    enabled: demo || !!user,
    queryFn: async () => {
      if (demo) return demoData();
      if (!supabase) throw new Error(t("Supabase не настроен"));
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
    let savedFieldId: string | undefined;
    if (table === "fields" && !remove) {
      row = {
        ...row,
        area_hectares: validateBoundary(row.boundary),
      };
    }
    if (!remove && table === "field_seasons") {
      if (
        !Number.isInteger(row.year) ||
        Number(row.year) < 1900 ||
        Number(row.year) > 2200
      )
        throw new Error(t("Укажите допустимый год."));
      for (const name of ["yield_tons_per_hectare", "irrigation_amount_mm"]) {
        if (
          row[name] !== null &&
          (!Number.isFinite(row[name]) || Number(row[name]) < 0)
        )
          throw new Error(
            t("Урожайность и орошение не могут быть отрицательными."),
          );
      }
      if (
        row.planting_date &&
        row.harvest_date &&
        String(row.harvest_date) < String(row.planting_date)
      )
        throw new Error(t("Дата уборки должна быть не раньше даты посева."));
    }
    if (
      !remove &&
      (table === "farms" ||
        (table === "fields" && (row.id == null || "name" in row))) &&
      !String(row.name ?? "").trim()
    )
      throw new Error(t("Введите название."));
    if (demo) {
      if (table === "profiles")
        throw new Error(t("Профиль недоступен в демо."));
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
        if (table === "fields") savedFieldId = String(id);
        if (
          table === "field_seasons" &&
          data.seasons.some(
            (x) =>
              x.field_id === row.field_id && x.year === row.year && x.id !== id,
          )
        )
          throw new Error(t("Сезон за этот год уже существует."));
        const index = arr.findIndex((x) => x.id === id);
        if (index >= 0) arr[index] = { ...arr[index], ...row, id };
        else if (table === "fields" && row.id != null)
          throw new Error(t("Поле не найдено."));
        else arr.push({ ...row, id });
      }
      localStorage.setItem(demoKey, JSON.stringify(data));
    } else {
      if (!supabase) throw new Error(t("Supabase не настроен"));
      if (table === "fields" && !remove) {
        const fieldId = await writeField(supabase, row);
        savedFieldId = fieldId;
        void supabase.functions
          .invoke("hls-vegetation", {
            body: { fieldId, year: new Date().getUTCFullYear() - 1 },
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
          : await supabase.from(table).upsert(row);
        if (result.error) throw result.error;
      }
    }
    await client.invalidateQueries({ queryKey: key });
    if (table === "fields" && row.id != null) {
      await client.invalidateQueries({
        queryKey: ["rotation-climate", demo ? "demo" : user?.id, row.id],
      });
    }
    return savedFieldId;
  }
  return { ...query, save };
}
