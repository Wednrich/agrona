import { getLanguage, t } from "../lib/i18n";
import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { ChevronsUpDown } from "lucide-react";
import iso from "i18n-iso-countries";

const display = new Intl.DisplayNames("ru", { type: "region" });
export const countries = Object.keys(iso.getAlpha2Codes())
  .filter((code) => code !== "XK")
  .map((code) => ({ code, name: display.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name, "ru"));
export type Country = (typeof countries)[number];
export type Location = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};
type Suggestion = Location & { label: string; kind: string };

export function CountryPicker({
  value,
  onChange,
  error,
}: {
  value: Country | null;
  onChange: (value: Country) => void;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const language = getLanguage();
  const display = new Intl.DisplayNames(language, { type: "region" });
  const localizedCountries = countries
    .map(({ code }) => ({ code, name: display.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, language));
  return (
    <div className="registration-field">
      <span id="country-label">{t("Страна")}</span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          type="button"
          className="registration-picker"
          aria-labelledby="country-label country-value"
          aria-invalid={!!error}
          aria-describedby={error ? "country-error" : undefined}
        >
          <span id="country-value">
            {value
              ? (display.of(value.code) ?? value.code)
              : t("Выберите страну")}
          </span>
          <ChevronsUpDown size={16} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="registration-options"
            align="start"
            sideOffset={6}
          >
            <Command label={t("Выбор страны")}>
              <Command.Input
                placeholder={t("Поиск страны…")}
                aria-label={t("Поиск страны")}
              />
              <Command.List>
                <Command.Empty>{t("Страна не найдена.")}</Command.Empty>
                {localizedCountries.map((c) => (
                  <Command.Item
                    key={c.code}
                    value={c.name}
                    keywords={[c.code]}
                    onSelect={() => {
                      onChange(c);
                      setOpen(false);
                    }}
                  >
                    {c.name}
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error && (
        <span id="country-error" className="error">
          {error}
        </span>
      )}
    </div>
  );
}

export function LocationPicker({
  country,
  value,
  onChange,
  error,
}: {
  country: Country | null;
  value: Location | null;
  onChange: (value: Location | null) => void;
  error?: string;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [result, setResult] = useState<{
    query: string;
    items: Suggestion[];
    error?: string;
  }>();
  const search = query.trim();
  useEffect(() => {
    if (!country || value || search.length < 2 || !focused) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const key = import.meta.env.VITE_MAPTILER_KEY;
        if (!key) throw new Error(t("Поиск мест не настроен."));
        const params = new URLSearchParams({
          key,
          country: country.code.toLowerCase(),
          language: getLanguage(),
          autocomplete: "true",
          types: "region,subregion,county,municipality,locality",
          limit: "10",
        });
        const response = await fetch(
          `https://api.maptiler.com/geocoding/${encodeURIComponent(search)}.json?${params}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(t("Поиск мест недоступен. Попробуйте ещё раз."));
        const body = await response.json();
        const items: Suggestion[] = [];
        for (const feature of body.features ?? []) {
          const [longitude, latitude] = feature.center ?? [];
          if (
            typeof feature.id !== "string" ||
            typeof feature.text !== "string" ||
            !Number.isFinite(longitude) ||
            !Number.isFinite(latitude) ||
            Math.abs(longitude) > 180 ||
            Math.abs(latitude) > 90
          )
            continue;
          items.push({
            id: feature.id,
            name: feature.text,
            latitude,
            longitude,
            label: feature.place_name ?? feature.text,
            kind: ["region", "subregion", "county"].includes(
              feature.place_type?.[0],
            )
              ? t("Регион")
              : t("Населённый пункт"),
          });
        }
        if (!controller.signal.aborted) setResult({ query: search, items });
      } catch (err) {
        if (!controller.signal.aborted)
          setResult({
            query: search,
            items: [],
            error:
              err instanceof Error
                ? err.message
                : t("Не удалось выполнить поиск."),
          });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [country, value, search, focused]);
  const show = !!country && focused && !value && search.length >= 2;
  const current = result?.query === search ? result : undefined;
  return (
    <div
      className="registration-field registration-location"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      <label htmlFor="registration-location">{t("Регион / город")}</label>
      <Command shouldFilter={false} label={t("Поиск региона или города")}>
        <Command.Input
          id="registration-location"
          disabled={!country}
          placeholder={
            country
              ? t("Начните вводить название")
              : t("Сначала выберите страну")
          }
          value={value?.name ?? query}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setFocused(false);
          }}
          onValueChange={(text) => {
            setQuery(text);
            setResult(undefined);
            onChange(null);
            setFocused(true);
          }}
          aria-invalid={!!error}
          aria-describedby={error ? "location-error" : undefined}
        />
        {show && (
          <Command.List className="registration-options location-options">
            {!current ? (
              <div role="status">{t("Поиск мест…")}</div>
            ) : current.error ? (
              <div role="alert">
                {current.error}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setResult(undefined);
                    setFocused(false);
                    requestAnimationFrame(() => setFocused(true));
                  }}
                >
                  {t("Повторить")}
                </button>
              </div>
            ) : current.items.length === 0 ? (
              <div role="status">{t("Ничего не найдено.")}</div>
            ) : (
              current.items.map((item) => (
                <Command.Item
                  key={item.id}
                  value={item.id}
                  onSelect={() => {
                    onChange(item);
                    setFocused(false);
                  }}
                >
                  <span>{item.label}</span>
                  <small>{item.kind}</small>
                </Command.Item>
              ))
            )}
          </Command.List>
        )}
      </Command>
      {error && (
        <span id="location-error" className="error">
          {error}
        </span>
      )}
    </div>
  );
}
