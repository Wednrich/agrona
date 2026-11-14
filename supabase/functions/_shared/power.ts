export interface ClimateDay {
  observation_date: string;
  temperature_mean: number | null;
  temperature_max: number | null;
  temperature_min: number | null;
  precipitation_mm: number | null;
  solar_radiation: number | null;
  humidity?: number | null;
  wind_speed?: number | null;
}
export function normalizePower(input: unknown, extended = false): ClimateDay[] {
  const data = input as {
    properties?: { parameter?: Record<string, Record<string, number>> };
    parameters?: Record<string, { units: string }>;
    header?: { fill_value: number };
  };
  const p = data?.properties?.parameter;
  if (!p || !data.parameters)
    throw new Error("NASA returned an invalid response");
  const names = [
    "T2M",
    "T2M_MAX",
    "T2M_MIN",
    "PRECTOTCORR",
    "ALLSKY_SFC_SW_DWN",
  ];
  if (extended) names.push("RH2M", "WS2M");
  for (const key of names)
    if (!p[key] || !data.parameters[key])
      throw new Error("NASA response is missing parameters");
  const units = data.parameters;
  for (const key of names.slice(0, 3))
    if (units[key].units !== "C")
      throw new Error("Unsupported temperature unit");
  if (units.PRECTOTCORR.units !== "mm/day")
    throw new Error("Unsupported precipitation unit");
  if (
    extended &&
    (!["%", "percent"].includes(units.RH2M.units) || units.WS2M.units !== "m/s")
  )
    throw new Error("Unsupported humidity or wind unit");
  const solarUnit = units.ALLSKY_SFC_SW_DWN.units;
  const multiplier =
    solarUnit === "kW-hr/m^2/day" || solarUnit === "kWh/m^2/day"
      ? 3.6
      : solarUnit === "MJ/m^2/day"
        ? 1
        : null;
  if (multiplier === null) throw new Error("Unsupported radiation unit");
  const dates = Array.from(
    new Set(names.flatMap((k) => Object.keys(p[k]))),
  ).sort();
  function value(key: string, date: string) {
    const n = p![key]?.[date];
    return typeof n === "number" &&
      Number.isFinite(n) &&
      n !== -999 &&
      n !== data.header?.fill_value
      ? n
      : null;
  }
  return dates
    .filter((d) => {
      if (!/^\d{8}$/.test(d)) return false;
      const date = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`);
      return (
        Number.isFinite(+date) &&
        date.toISOString().slice(0, 10).replaceAll("-", "") === d
      );
    })
    .map((d) => {
      const rain = value("PRECTOTCORR", d),
        solar = value("ALLSKY_SFC_SW_DWN", d);
      const humidity = value("RH2M", d);
      const wind = value("WS2M", d);
      return {
        ...(extended
          ? {
              humidity:
                humidity !== null && humidity >= 0 && humidity <= 100
                  ? humidity
                  : null,
              wind_speed: wind !== null && wind >= 0 ? wind : null,
            }
          : {}),
        observation_date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`,
        temperature_mean: value("T2M", d),
        temperature_max: value("T2M_MAX", d),
        temperature_min: value("T2M_MIN", d),
        precipitation_mm: rain !== null && rain >= 0 ? rain : null,
        solar_radiation:
          solar !== null && solar >= 0 ? solar * multiplier : null,
      };
    });
}
