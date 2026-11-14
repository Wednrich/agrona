import { describe, it, expect } from "vitest";
import { normalizePower } from "../supabase/functions/_shared/power";
import { climateSummary, selectClimatePeriod } from "../src/features/climate";
const raw = () => ({
  header: { fill_value: -999 },
  parameters: {
    T2M: { units: "C" },
    T2M_MAX: { units: "C" },
    T2M_MIN: { units: "C" },
    PRECTOTCORR: { units: "mm/day" },
    ALLSKY_SFC_SW_DWN: { units: "kW-hr/m^2/day" },
  },
  properties: {
    parameter: {
      T2M: { 20250101: 4 },
      T2M_MAX: { 20250101: 9 },
      T2M_MIN: { 20250101: -1 },
      PRECTOTCORR: { 20250101: -999 },
      ALLSKY_SFC_SW_DWN: { 20250101: 2 },
    },
  },
});
describe("NASA response validation", () => {
  it("normalizes radiation and preserves missing rainfall", () => {
    const result = normalizePower(raw())[0];
    expect(result.solar_radiation).toBe(7.2);
    expect(result.precipitation_mm).toBeNull();
    expect(result.observation_date).toBe("2025-01-01");
  });
  it("rejects wrong units", () => {
    const data = raw();
    data.parameters.T2M.units = "F";
    expect(() => normalizePower(data)).toThrow();
  });
  it("rejects absent parameters", () =>
    expect(() => normalizePower({})).toThrow());
  it("does not represent absent precipitation as zero", () =>
    expect(climateSummary(normalizePower(raw())).rain).toBeNull());
  it("breaks dry periods at missing dates", () => {
    const base = normalizePower(raw())[0];
    expect(
      climateSummary([
        { ...base, observation_date: "2025-01-01", precipitation_mm: 0 },
        { ...base, observation_date: "2025-01-03", precipitation_mm: 0 },
      ]).longestDry,
    ).toBe(1);
  });
});

describe("seasonal climate periods", () => {
  it("includes both dates and separates absent dates from incomplete records", () => {
    const base = normalizePower(raw())[0];
    const rows = [
      { ...base, observation_date: "2024-02-27", precipitation_mm: 100 },
      {
        ...base,
        observation_date: "2024-02-28",
        precipitation_mm: 0,
        humidity: 40,
        wind_speed: 2,
      },
      { ...base, observation_date: "2024-03-01", precipitation_mm: 8 },
      { ...base, observation_date: "2024-03-02", precipitation_mm: 100 },
    ];
    const period = selectClimatePeriod(rows, 2024, "2024-02-28", "2024-03-01")!;
    expect(period).toMatchObject({
      days: 3,
      available: 2,
      absent: 1,
      partial: 1,
    });
    expect(climateSummary(period.daily).rain).toBe(8);
    expect(period.series.map((month) => month.rain)).toEqual([0, 8]);
  });

  it("rejects reversed, impossible and cross-year dates", () => {
    expect(
      selectClimatePeriod([], 2025, "2025-03-01", "2025-02-28"),
    ).toBeNull();
    expect(
      selectClimatePeriod([], 2025, "2025-02-29", "2025-03-01"),
    ).toBeNull();
    expect(
      selectClimatePeriod([], 2025, "2024-12-31", "2025-01-02"),
    ).toBeNull();
  });
});
