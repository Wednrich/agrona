import { t, getLanguage, localize } from "../lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { loadDemoPower } from "../features/demo-power";
import { loadRotationPower } from "../features/rotation-power";
import { rotationClimateKey } from "../lib/field-write";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { Field } from "../lib/types";

export default function FieldWeather({ field }: { field: Field }) {
  const { demo, user } = useAuth();
  const year = demo ? 2025 : new Date().getUTCFullYear() - 1;
  const query = useQuery({
    queryKey: [...rotationClimateKey(demo ? "demo" : user?.id, field), year],
    queryFn: async ({ signal }) => {
      if (demo) return (await loadDemoPower(field, year)).observations;
      if (!supabase) return [];
      return loadRotationPower(
        supabase.functions.invoke.bind(supabase.functions),
        field.id,
        year,
        JSON.stringify(field.boundary),
        signal,
      );
    },
    staleTime: 300000,
    retry: false,
  });
  if (query.isFetching)
    return (
      <p role="status">
        {t("Загружаем погоду NASA POWER за") + " "}
        {year}
        {" " + t("год.")}
      </p>
    );
  if (query.isError)
    return (
      <p>
        {localize(query.error.message)}{" "}
        <button type="button" onClick={() => void query.refetch()}>
          {t("Повторить")}
        </button>
      </p>
    );
  const rows = query.data?.filter((row) => row.precipitation_mm != null) ?? [];
  if (!rows.length)
    return (
      <p>
        {t("В NASA POWER нет данных об осадках за") + " "}
        {year}
        {" " + t("год.")}
      </p>
    );
  const total = rows.reduce((sum, row) => sum + (row.precipitation_mm ?? 0), 0);
  const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
  return (
    <p>
      NASA POWER, {year}
      {" " + t("год. Осадки за дни с данными —")}{" "}
      {total.toLocaleString(getLanguage(), { maximumFractionDigits: 1 })}
      {" " + t("мм. Данные за") + " "}
      {rows.length}
      {" " + t("из") + " "}
      {days}
      {" " + t("дней.")}
    </p>
  );
}
