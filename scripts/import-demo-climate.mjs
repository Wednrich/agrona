import fs from "node:fs";
import { normalizePower } from "../supabase/functions/_shared/power.ts";
const raw = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const observations = normalizePower(
  raw,
  Boolean(raw.parameters?.RH2M && raw.parameters?.WS2M),
);
if (observations.length !== 365)
  throw new Error("Expected complete 2025 observations");
fs.writeFileSync(
  "public/demo-power-2025.json",
  JSON.stringify({
    observations,
    cached: true,
    metadata: {
      source: "NASA POWER",
      period: "2025-01-01 — 2025-12-31",
      retrieved_at: new Date().toISOString(),
      centroid: [69.3695, 51.197],
      units: { temperature: "°C", precipitation: "mm/day", solar: "MJ/m²/day" },
      upstream: raw.header,
      url: `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN${raw.parameters?.RH2M && raw.parameters?.WS2M ? ",RH2M,WS2M" : ""}&community=AG&longitude=69.3695&latitude=51.197&start=20250101&end=20251231&format=JSON`,
      limitation:
        "Regional climate observations at the fixed demo location. Not soil measurements or observations for newly created fields.",
    },
  }),
);
console.log(`Imported ${observations.length} real NASA observations`);
