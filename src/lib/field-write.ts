import { t } from "./i18n";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Field } from "./types";

export async function writeField(
  db: SupabaseClient,
  row: Record<string, unknown>,
) {
  const { id, boundary, ...columns } = row;
  const ring = (boundary as Field["boundary"]).coordinates[0];
  const payload = {
    ...columns,
    boundary: `SRID=4326;POLYGON((${ring.map((point) => point.join(" ")).join(",")}))`,
  };
  const fields = db.from("fields");
  const result = await (
    id == null ? fields.insert(payload) : fields.update(payload).eq("id", id)
  )
    .select("id")
    .single();
  if (result.error) throw new Error(result.error.message);
  if (!result.data || (id != null && result.data.id !== id))
    throw new Error(t("Не удалось сохранить указанное поле."));
  return result.data.id as string;
}

export function rotationClimateKey(owner: string | undefined, field?: Field) {
  return ["rotation-climate", owner, field?.id, field?.boundary] as const;
}
