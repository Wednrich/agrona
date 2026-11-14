import { describe, expect, it } from "vitest";
import { restoreSoil, soilForSave } from "../src/lib/soil";

describe("soil type persistence", () => {
  it("restores predefined choices and preserves an unset value", () => {
    for (const saved of ["Чернозём", "Суглинистая почва", "Не знаю", ""]) {
      const { choice, custom } = restoreSoil(saved);
      expect(choice).toBe(saved);
      expect(soilForSave(choice, custom)).toBe(saved);
    }
  });

  it("restores a legacy custom value for editing", () => {
    const restored = restoreSoil("Суглинок");
    expect(restored).toEqual({ choice: "Другое", custom: "Суглинок" });
    expect(soilForSave(restored.choice, restored.custom)).toBe("Суглинок");
  });

  it("validates only the custom choice and stores the entered text", () => {
    expect(soilForSave("Другое", "  ")).toBeNull();
    expect(soilForSave("Другое", "Другое")).toBeNull();
    expect(soilForSave("Другое", "  Лугово-каштановая  ")).toBe(
      "Лугово-каштановая",
    );
    expect(soilForSave("Чернозём", "")).toBe("Чернозём");
  });
});
