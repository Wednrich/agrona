import { t } from "../lib/i18n";
import type { Field } from "../lib/types";
import { supabase } from "../lib/supabase";

export type DataPeriod = { start: string; end: string };
export type FieldSource =
  | "soilgrids"
  | "imerg-power"
  | "imerg-final"
  | "srtm"
  | "hls"
  | "sentinel2"
  | "smap"
  | "ecostress"
  | "gldas"
  | "nldas";
export type SourceResult = {
  status: "ready" | "no_coverage" | "blocked";
  source?: FieldSource;
  dataset?: string;
  reason?: string;
  retrievedAt?: string;
  data?: unknown;
  resolutionMetres?: number;
  resolutionDegrees?: number;
  requestedPeriod?: DataPeriod;
};

const serviceMessages: Record<string, string> = {
  sign_in: "Войдите в аккаунт, чтобы загрузить данные поля.",
  invalid_request: "Источник не может обработать выбранную границу или период.",
  boundary_changed: "Граница поля изменилась. Откройте поле заново.",
  field_not_found: "Сохранённое поле недоступно в этом аккаунте.",
  unconfigured: "Сервис данных поля ещё не настроен на сайте.",
};

export async function loadFieldSource(
  source: FieldSource,
  boundary: Field["boundary"],
  period?: DataPeriod,
  fieldId?: string,
  signal?: AbortSignal,
  legacySoilUrl?: string,
): Promise<SourceResult> {
  const session = legacySoilUrl
    ? null
    : (await supabase?.auth?.getSession())?.data.session;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session) headers.Authorization = `Bearer ${session.access_token}`;
  const response = await fetch(legacySoilUrl || "/api/field-data", {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify(
      legacySoilUrl ? boundary : { source, fieldId, boundary, ...period },
    ),
  });
  const result = await response.json().catch(() => null);
  if (
    !response.ok ||
    !["ready", "no_coverage", "blocked"].includes(result?.status)
  )
    throw new Error(
      t(
        serviceMessages[result?.status] ??
          "Не удалось получить данные от сервиса поля.",
      ),
    );
  return result;
}
