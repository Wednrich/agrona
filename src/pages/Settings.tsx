import { t, localize } from "../lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { useData } from "../lib/data";
import { Button } from "../components/ui/button";
export default function Settings() {
  const { user, demo } = useAuth();
  const { save } = useData();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user && !demo,
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("profiles")
        .select("*")
        .eq("id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });
  return (
    <main className="page">
      <span className="eyebrow">{t("ЛИЧНОЕ ПРОСТРАНСТВО")}</span>
      <h1>{t("Настройки")}</h1>
      <section className="card settings-card">
        <h2>{t("Ваш профиль")}</h2>
        {demo ? (
          <p>
            {t(
              "Вы работаете в деморежиме. Изменения полей сохраняются только в этом браузере, отдельно от аккаунтов.",
            )}
          </p>
        ) : query.isLoading ? (
          <p>{t("Загрузка профиля…")}</p>
        ) : query.error ? (
          <p className="error">{localize(query.error.message)}</p>
        ) : (
          <form
            key={query.data?.id}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                await save("profiles", {
                  id: user!.id,
                  full_name: f.get("full_name"),
                  country: f.get("country"),
                  region: f.get("region"),
                });
                setMessage(t("Профиль сохранён"));
                await query.refetch();
              } catch (e) {
                setMessage(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {[
              ["full_name", t("Ваше имя")],
              ["country", t("Страна")],
              ["region", t("Регион")],
            ].map(([name, label]) => (
              <label key={name}>
                {label}
                <input
                  required
                  name={name}
                  maxLength={120}
                  defaultValue={query.data?.[name] ?? ""}
                />
              </label>
            ))}
            <label>
              {t("Электронная почта")}
              <input value={user?.email ?? ""} readOnly />
            </label>
            <Button disabled={busy}>{t("Сохранить профиль")}</Button>
            <p role="status">{message}</p>
          </form>
        )}
      </section>
      <section className="card settings-card">
        <h2>{t("Источники и ограничения")}</h2>
        <p>
          {t(
            "NASA POWER — климатические наблюдения на регулярной сетке. NDVI и измерения влажности почвы не подключены.",
          )}
        </p>
        <p>
          {t("Спутниковая подложка:")}{" "}
          {import.meta.env.VITE_MAPTILER_KEY
            ? "MapTiler"
            : t("не настроена; используется OpenStreetMap")}
          .
        </p>
        <p>{t("Рекомендации требуют проверки в местных условиях.")}</p>
      </section>
    </main>
  );
}
