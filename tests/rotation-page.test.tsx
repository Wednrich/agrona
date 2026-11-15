// @vitest-environment jsdom
import { act } from "react";
import power from "../public/demo-power-2025.json";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialDemo } from "../src/lib/demo";
import type { FarmData } from "../src/lib/types";
import Rotation from "../src/pages/Rotation";
import { rotationClimateKey } from "../src/lib/field-write";
import * as engine from "../src/features/rotation";

const adapters = vi.hoisted(() => ({
  data: {} as FarmData,
  invoke: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../src/lib/data", () => ({
  useData: () => ({ data: adapters.data, save: adapters.save }),
}));
vi.mock("../src/lib/auth", () => ({
  useAuth: () => ({ demo: false, user: { id: "integration" } }),
}));
vi.mock("../src/lib/supabase", () => ({
  supabase: { functions: { invoke: adapters.invoke } },
}));
vi.mock("../src/features/rotation", { spy: true });

let host: HTMLDivElement;
let root: Root;
let cache: QueryClient;

const button = (label: string) => {
  const element = [...host.querySelectorAll("button")].find((node) =>
    node.textContent?.includes(label),
  );
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
};
const click = (element: HTMLElement) => act(async () => element.click());
const cards = () => [...host.querySelectorAll(".strategy-grid article")];
const sequence = (card: Element) =>
  [...card.querySelectorAll(".sequence strong")].map(
    (node) => node.textContent,
  );

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  adapters.data = structuredClone(initialDemo);
});

afterEach(async () => {
  await act(async () => root.unmount());
  cache.clear();
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function openPage(mode?: "plan" | "explore") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={cache}>
        <MemoryRouter
          initialEntries={[
            mode
              ? `/rotation/${adapters.data.fields[0].id}?mode=${mode}`
              : "/rotation",
          ]}
        >
          <Routes>
            <Route path="/rotation" element={<Rotation />} />
            <Route path="/rotation/:fieldId" element={<Rotation />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  expect(cards()).toHaveLength(0);
  if (mode) return;
  const firstField = host.querySelector<HTMLAnchorElement>("a.card");
  if (!firstField) throw new Error("Missing field picker link");
  await click(firstField);
}

describe("rotation page", () => {
  it("calculates the displayed strategies from the selected field and current priorities on each click", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const field = adapters.data.fields[0];
    const year = new Date().getUTCFullYear() - 1;
    const observations = [
      {
        observation_date: `${year}-05-01`,
        temperature_mean: 12,
        temperature_min: 2,
        temperature_max: 20,
        precipitation_mm: 4,
        solar_radiation: null,
      },
    ];
    cache.setQueryData(
      [...rotationClimateKey("integration", field), year],
      observations,
    );
    // Keep the fixture in the same cache entry while the real page reads it.
    cache.setDefaultOptions({ queries: { staleTime: Infinity, retry: false } });
    adapters.data.scenarios = [
      {
        id: "archived-plan",
        field_id: field.id,
        name: "Архив из хранилища",
        priorities: [],
        constraints: {},
        crop_sequence: [adapters.data.crops[0].id],
        analysis_result: { score: 0, reasons: [], warnings: [] },
      },
    ];
    await openPage();
    expect(host.querySelector(".saved-scenarios")?.textContent).toContain(
      "Архив из хранилища",
    );

    await click(button("Подобрать варианты"));
    const generate = vi.mocked(engine.generateRotations);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0].slice(1, 6)).toEqual([
      adapters.data.seasons.filter((season) => season.field_id === field.id),
      field.id,
      ["soil", "water"],
      expect.objectContaining({
        soilType: field.soil_type,
        irrigation: false,
        period: { year, start: `${year}-05-01`, end: `${year}-09-30` },
      }),
      observations,
    ]);
    const previousSequences = cards().map(sequence);
    const previousScore =
      generate.mock.results[0].value[0].analysis_result.score;
    expect(cards()[0].textContent).toContain(String(previousScore));

    await click(button("Изменить план и цели"));
    await click(button("Экономить воду"));
    await click(button("Подобрать варианты"));
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][3]).toEqual(["soil"]);
    const result = generate.mock.results[1].value;
    expect(cards().map(sequence)).toEqual(
      result.map((strategy: { crop_sequence: string[] }) =>
        strategy.crop_sequence.map(
          (id) => adapters.data.crops.find((crop) => crop.id === id)?.name,
        ),
      ),
    );
    expect(result[0].analysis_result.score).not.toEqual(previousScore);
    expect(cards()[0].textContent).toContain(
      String(result[0].analysis_result.score),
    );
    expect(sequence(cards()[0])).toEqual(previousSequences[0]);
    expect(host.querySelector(".strategy-grid")?.textContent).not.toContain(
      "Архив из хранилища",
    );
    expect(debug).toHaveBeenLastCalledWith(
      "[AGRONA rotation]",
      expect.objectContaining({
        strategySource: "generateRotations",
        climateDataSource: "nasa-power-cache",
        eligibleCrops: 5,
        admissibleSequences: "125",
        priorities: ["soil"],
        choices: expect.arrayContaining([
          expect.objectContaining({ role: "water" }),
        ]),
      }),
    );
    expect(JSON.stringify(debug.mock.calls)).not.toContain(field.id);
  });

  it("changes the soil recommendation on the bundled NASA POWER season when water priority is removed", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T00:00:00Z"));
    const field = adapters.data.fields[0];
    cache.setDefaultOptions({ queries: { staleTime: Infinity, retry: false } });
    cache.setQueryData(
      [...rotationClimateKey("integration", field), 2025],
      power.observations,
    );
    await openPage();
    await click(button("Подобрать варианты"));
    const before = cards().map(sequence);
    await click(button("Изменить план и цели"));
    await click(button("Экономить воду"));
    await click(button("Подобрать варианты"));
    const after = cards().map(sequence);
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(after[2]).not.toEqual(before[2]);
  });

  it("keeps a single feasible sequence after a priority change and explains the recalculation", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    adapters.data.crops = adapters.data.crops.slice(0, 1);
    adapters.data.seasons = [];
    cache.setDefaultOptions({ queries: { staleTime: Infinity, retry: false } });
    cache.setQueryData(
      [
        ...rotationClimateKey("integration", adapters.data.fields[0]),
        new Date().getUTCFullYear() - 1,
      ],
      [],
    );
    await openPage();
    await click(button("Подобрать варианты"));
    expect(cards()).toHaveLength(1);
    const original = sequence(cards()[0]);
    await click(button("Изменить план и цели"));
    await click(button("Экономить воду"));
    await click(button("Подобрать варианты"));
    expect(cards()).toHaveLength(1);
    expect(sequence(cards()[0])).toEqual(original);
    expect(host.textContent).toContain(
      "После пересчёта последовательности остались прежними.",
    );
    expect(host.textContent).toContain(
      "Ограничения по культурам и длине сезона",
    );
  });
});

const selectValue = async (select: HTMLSelectElement, value: string) =>
  act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
const settle = async () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

it("loads a new field without history, enters a plan, saves and reopens its complete comparison", async () => {
  vi.spyOn(console, "debug").mockImplementation(() => {});
  adapters.data.seasons = [];
  adapters.data.scenarios = [];
  adapters.invoke.mockResolvedValue({
    data: {
      metadata: { geometry: JSON.stringify(adapters.data.fields[0].boundary) },
      observations: power.observations,
    },
  });
  adapters.save.mockImplementation(async (_table, row) => {
    adapters.data.scenarios.push(
      JSON.parse(JSON.stringify({ ...row, id: "saved" })),
    );
  });
  await openPage("plan");
  await settle();
  expect(adapters.invoke).toHaveBeenCalled();
  expect(host.textContent).toContain("Истории посевов пока нет");
  expect(
    host.querySelector('a[href^="/farms?history="]')?.getAttribute("href"),
  ).toBe(`/farms?history=${encodeURIComponent(initialDemo.fields[0].id)}`);
  const plan = [...host.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => o.value === "manual"),
  )!;
  expect(plan.value).toBe("manual");
  await click(button("Сравнить планы"));
  expect(host.textContent).toContain("Выберите культуру для каждого года");
  for (let i = 0; i < 3; i++)
    await selectValue(
      host.querySelector(`select[aria-label="Культура на год ${i + 1}"]`)!,
      adapters.data.crops[i].id,
    );
  await click(button("Сравнить планы"));
  expect(sequence(cards()[0])).toEqual(
    adapters.data.crops.slice(0, 3).map((c) => c.name),
  );
  expect(cards()[1].textContent).toContain("Вместо:");
  await click(button("Сохранить сравнение"));
  expect(adapters.data.scenarios[0].analysis_result.comparison).toHaveLength(3);
  const before = cards().map(sequence);
  await act(async () => root.unmount());
  root = createRoot(host);
  await openPage();
  await click(button("Открыть сохранённое сравнение"));
  expect(cards().map(sequence)).toEqual(before);
  await click(button("Изменить план и цели"));
  adapters.data.fields[0].boundary.coordinates[0][1][0] += 0.01;
  await click(button("Экономить воду"));
  await settle();
  expect(host.textContent).toContain("Условия поля изменились");
  expect(adapters.invoke.mock.calls.length).toBeGreaterThan(1);
  expect(host.textContent).toContain("Погода не соответствует текущей границе");
});

it("allows an overview without a plan after provider failure and opens a legacy snapshot", async () => {
  vi.spyOn(console, "debug").mockImplementation(() => {});
  adapters.data.seasons = [];
  adapters.invoke.mockResolvedValue({ error: new Error("offline") });
  adapters.data.scenarios = [
    {
      id: "old",
      field_id: adapters.data.fields[0].id,
      name: "Старый план",
      priorities: [],
      constraints: {},
      crop_sequence: [adapters.data.crops[0].id],
      analysis_result: { score: 0, reasons: [], warnings: [] },
    },
  ];
  await openPage("explore");
  await settle();
  expect(host.textContent).toContain("Повторить загрузку погоды");
  await click(button("Подобрать варианты"));
  expect(cards()[0].textContent).toContain("КАНДИДАТ");
  expect(cards()[0].textContent).toContain(
    "Климатические наблюдения не загружены",
  );
  await click(button("Открыть сохранённое сравнение"));
  expect(cards()).toHaveLength(1);
  expect(host.textContent).toContain("версия неизвестна");
});
