import { useState, type ComponentProps } from "react";
import HlsVegetationAnalytics from "./HlsVegetationAnalytics";
import SentinelVegetationAnalytics from "./SentinelVegetationAnalytics";

export default function VegetationAnalytics(
  props: ComponentProps<typeof HlsVegetationAnalytics>,
) {
  const [source, setSource] = useState("hls");
  return (
    <>
      <label className="row">
        Источник растительности
        <select
          value={source}
          onChange={(event) => setSource(event.target.value)}
        >
          <option value="hls">NASA HLS</option>
          <option value="sentinel">Copernicus Sentinel-2</option>
        </select>
      </label>
      {source === "hls" ? (
        <HlsVegetationAnalytics {...props} />
      ) : (
        <SentinelVegetationAnalytics {...props} />
      )}
    </>
  );
}
