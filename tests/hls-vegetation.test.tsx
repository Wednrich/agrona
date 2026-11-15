// @vitest-environment jsdom
import { setLanguage } from "../src/lib/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import HlsVegetationAnalytics from "../src/components/HlsVegetationAnalytics";
import type { Field } from "../src/lib/types";

setLanguage("ru");

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../src/lib/supabase", () => ({ supabase: { functions: { invoke } } }));
vi.mock("recharts", () => ({
  ResponsiveContainer: () => null,
  ScatterChart: () => null,
  CartesianGrid: () => null,
  Scatter: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

it("shows saved observations while partial and loads the finished cache on a fresh open", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const observation = {
    acquiredAt: "2025-06-01T00:00:00Z",
    conceptId: "scene",
    dataset: "HLSL30",
    date: "2025-06-01",
    fieldPixels: 20,
    validPixels: 18,
    waterPixels: 0,
    tileContainsField: true,
    mean: 0.55,
    min: 0.4,
    max: 0.7,
  };
  invoke
    .mockResolvedValueOnce({
      data: {
        observations: [observation],
        state: "partial",
        pending: true,
        queued: true,
      },
    })
    .mockResolvedValueOnce({
      data: { observations: [observation], state: "succeeded", cached: true },
    });
  const field: Field = {
    id: "test5",
    farm_id: "farm",
    name: "test5",
    area_hectares: 219.3,
    soil_type: "",
    irrigation_type: "",
    boundary: { type: "Polygon", coordinates: [] },
  };
  const container = document.createElement("div");
  try {
    for (const partial of [true, false]) {
      const client = new QueryClient();
      const root = createRoot(container);
      try {
        await act(async () =>
          root.render(
            <QueryClientProvider client={client}>
              <HlsVegetationAnalytics
                field={field}
                year={2025}
                ownerId="owner"
                demo={false}
              />
            </QueryClientProvider>,
          ),
        );
        await vi.waitFor(() =>
          expect(container.textContent).toContain("0.550"),
        );
        if (partial) {
          expect(container.textContent).toContain(
            "Частичные результаты сохранены",
          );
        } else {
          expect(container.textContent).toContain("из кэша");
          expect(container.textContent).not.toContain("Ожидается продолжение");
        }
      } finally {
        await act(async () => root.unmount());
        client.clear();
      }
    }
    expect(invoke).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
