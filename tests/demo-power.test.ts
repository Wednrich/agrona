import { expect, it, vi } from "vitest";
import { loadDemoPower } from "../src/features/demo-power";
import { initialDemo } from "../src/lib/demo";
import { fetchPower } from "../supabase/functions/_shared/power-provider";

vi.mock("../supabase/functions/_shared/power-provider", () => ({
  fetchPower: vi.fn(),
}));

it("requests data at a new boundary even when the original demo field ID is reused", async () => {
  const field = structuredClone(initialDemo.fields[0]);
  field.boundary = {
    type: "Polygon",
    coordinates: [
      [
        [76.69, 43.24],
        [76.71, 43.24],
        [76.71, 43.26],
        [76.69, 43.26],
        [76.69, 43.24],
      ],
    ],
  };
  vi.mocked(fetchPower).mockResolvedValue({
    observations: [],
    sourceUrl: "",
    upstream: {},
  });
  const result = await loadDemoPower(field, 2025);
  const [year, longitude, latitude] = vi.mocked(fetchPower).mock.calls[0];
  expect(year).toBe(2025);
  expect(longitude).toBeCloseTo(76.7, 6);
  expect(latitude).toBeCloseTo(43.25, 6);
  expect(result.cached).toBe(false);
});
