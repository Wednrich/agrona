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
    return <p role="status">Загружаем погоду NASA POWER за {year} год.</p>;
  if (query.isError)
    return (
      <p>
        {query.error.message}{" "}
        <button type="button" onClick={() => void query.refetch()}>
          Повторить
        </button>
      </p>
    );
  const rows = query.data?.filter((row) => row.precipitation_mm != null) ?? [];
  if (!rows.length)
    return <p>В NASA POWER нет данных об осадках за {year} год.</p>;
  const total = rows.reduce((sum, row) => sum + (row.precipitation_mm ?? 0), 0);
  const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
  return (
    <p>
      NASA POWER, {year} год. Осадки за дни с данными —{" "}
      {total.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} мм. Данные
      за {rows.length} из {days} дней.
    </p>
  );
}
