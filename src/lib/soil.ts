// Keep classification and texture distinct while storing one label in the MVP.
export const soilOptions = [
  { label: "Чернозём", kind: "classification" },
  { label: "Каштановая почва", kind: "classification" },
  { label: "Бурая почва", kind: "classification" },
  { label: "Серозём", kind: "classification" },
  { label: "Суглинистая почва", kind: "texture" },
  { label: "Супесчаная почва", kind: "texture" },
  { label: "Песчаная почва", kind: "texture" },
  { label: "Глинистая почва", kind: "texture" },
  { label: "Солончак", kind: "classification" },
  { label: "Не знаю", kind: "unknown" },
  { label: "Другое", kind: "custom" },
] as const;

export type SoilChoice = (typeof soilOptions)[number]["label"] | "";
export const customSoilError = "Укажите тип почвы.";

export function restoreSoil(saved = ""): {
  choice: SoilChoice;
  custom: string;
} {
  if (!saved) return { choice: "", custom: "" };
  const option = soilOptions.find(({ label }) => label === saved);
  if (option && option.kind !== "custom")
    return { choice: option.label, custom: "" };
  return { choice: "Другое", custom: saved };
}

export function soilForSave(choice: SoilChoice, custom: string): string | null {
  if (choice !== "Другое") return choice;
  const value = custom.trim();
  return value && value.toLocaleLowerCase("ru") !== "другое" ? value : null;
}
