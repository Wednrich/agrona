import { setLanguage, t, useLanguage, type Language } from "../lib/i18n";

export function LanguageSelect() {
  const language = useLanguage();
  return (
    <select
      className="language-select"
      aria-label={t("Язык интерфейса")}
      value={language}
      onChange={(event) => setLanguage(event.target.value as Language)}
    >
      <option value="en" lang="en">
        English
      </option>
      <option value="ru" lang="ru">
        {t("Русский")}
      </option>
    </select>
  );
}
