import {
  fetchPower,
  powerParameters,
  spatialResolution,
} from "../../supabase/functions/_shared/power-provider.ts";

const [longitude, latitude, start, end] = process.argv.slice(2);
const fromYear = Number(start.slice(0, 4));
const toYear = Number(end.slice(0, 4));
const data = [];
const urls = [];
const upstream = [];
for (let year = fromYear; year <= toYear; year++) {
  const reply = await fetchPower(year, Number(longitude), Number(latitude));
  data.push(...reply.observations.filter(({ observation_date }) =>
    observation_date >= start && observation_date <= end));
  urls.push(reply.sourceUrl);
  upstream.push(reply.upstream);
}
const columns = Object.values(powerParameters);
console.log(JSON.stringify({
  dataset: "NASA POWER daily-ag-v2",
  timeStandard: "LST",
  method: "Existing AGRONA POWER loader; field centroid on the source grid",
  urls,
  upstream,
  units: Object.fromEntries(columns),
  resolution: Object.fromEntries(Object.entries(powerParameters).map(
    ([parameter, [field]]) => [field, spatialResolution(parameter)],
  )),
  coverageDays: Object.fromEntries(columns.map(([field]) =>
    [field, data.filter(row => row[field] != null).length])),
  data,
}));
