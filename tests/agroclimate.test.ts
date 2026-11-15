import { describe, expect, it } from "vitest";
import {
  dateAt,
  degreeDays,
  evaluateWindow,
  frostSeason,
  penmanMonteith,
  profiles,
  solarDay,
  span,
} from "../src/features/agroclimate";
import { normalizePower } from "../supabase/functions/_shared/power";
import type { Observation } from "../src/lib/types";

const day = (observation_date: string, temperature_min = 15): Observation => ({
  observation_date,
  temperature_min,
  temperature_max: 29,
  temperature_mean: 22,
  precipitation_mm: 0,
  solar_radiation: 15,
  humidity: 50,
  wind_speed: 2,
});
const records = (dates: string[]) => new Map(dates.map((d) => [d, day(d)]));

describe("agroclimate reference calculations", () => {
  it("matches FAO-56 examples 8 and 9 and the noon geometry", () => {
    const result = solarDay(dateAt(2025, 8, 3), -20);
    expect(result.extraterrestrial).toBeCloseTo(32.2, 0);
    expect(result.daylight).toBeCloseTo(11.7, 0);
    expect(result.altitude).toBeCloseTo(63.1, 0);
    expect(solarDay(dateAt(2025, 5, 21), 80).daylight).toBe(24);
    expect(solarDay(dateAt(2025, 5, 21), -80).daylight).toBe(0);
  });

  it("matches FAO-56 Bangkok example 17 with reference net radiation", () => {
    expect(penmanMonteith(30.2, 2, 2, 14.33, 1.53)).toBeCloseTo(5.72, 1);
  });

  it("normalizes POWER kWh/m² to MJ/m²", () => {
    const units = {
      T2M: "C",
      T2M_MIN: "C",
      T2M_MAX: "C",
      PRECTOTCORR: "mm/day",
      ALLSKY_SFC_SW_DWN: "kWh/m^2/day",
    };
    const parameters = Object.fromEntries(
      Object.entries(units).map(([k, units]) => [k, { units }]),
    );
    const parameter = Object.fromEntries(
      Object.keys(units).map((k) => [k, { "20250101": 5 }]),
    );
    expect(
      normalizePower({ parameters, properties: { parameter } })[0]
        .solar_radiation,
    ).toBe(18);
  });

  it("uses the maize floor and cap and leaves unverified crop bases unknown", () => {
    expect(degreeDays(5, 35, profiles.maize.thermal?.value)).toBe(10);
    expect(degreeDays(10, 10, profiles.maize.thermal?.value)).toBe(0);
    expect(degreeDays(5, 35, profiles.wheat.thermal?.value)).toBeNull();
  });

  it("shifts frost seasons across New Year and withholds bounds for incomplete years", () => {
    const rows = records(span(dateAt(2024, 6, 1), 365));
    rows.set("2024-10-03", day("2024-10-03", 0));
    rows.set("2025-04-04", day("2025-04-04", -2));
    expect(frostSeason(rows, 2024, -40)).toMatchObject({
      last: "2024-10-03",
      first: "2025-04-04",
      days: 2,
      free: 182,
    });
    rows.delete("2025-03-03");
    expect(frostSeason(rows, 2024, -40).last).toBeUndefined();
  });

  it("compares sowing dates without filling gaps or claiming a winter crop matures", () => {
    const start = dateAt(2024, 9, 1);
    const rows = records(span(start, 195));
    const result = evaluateWindow(rows, start, profiles.maize, -30);
    expect(result.reached).toMatch(/^2025-/);
    expect(result.etc).toBeNull();
    expect(result.et0.days).toBe(0);
    expect(result.reasons.join(" ")).toContain("калибровки");
    expect(
      evaluateWindow(rows, start, { ...profiles.maize, season: "winter" }, -30)
        .status,
    ).toBe("insufficient_data");
    expect(
      evaluateWindow(rows, dateAt(2024, 11, 1), profiles.maize, -30)
        .thermalComplete,
    ).toBe(false);
    expect(profiles.maize.thermal?.source).toContain("udel.edu");
  });
});
