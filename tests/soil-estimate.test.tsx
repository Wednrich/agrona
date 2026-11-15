// @vitest-environment jsdom
import { setLanguage } from "../src/lib/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import SoilEstimate, { cachedSoil } from "../src/components/SoilEstimate";
import type { Field } from "../src/lib/types";

setLanguage("ru");

it("does not apply a late soil response to a changed boundary, and allows retry after failure", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const boundary = (x: number): Field["boundary"] => ({
    type: "Polygon",
    coordinates: [
      [
        [x, 1],
        [x + 0.01, 1],
        [x + 0.01, 1.01],
        [x, 1],
      ],
    ],
  });
  const first = boundary(20),
    second = boundary(21);
  let resolveFirst!: (response: Response) => void;
  const response = (status: string) =>
    ({
      ok: true,
      json: async () => ({ status, retrievedAt: new Date().toISOString() }),
    }) as Response;
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("Сеть недоступна"))
    .mockResolvedValueOnce(response("no_coverage"));
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SoilEstimate boundary={first} />));
    await act(async () => root.render(<SoilEstimate boundary={second} />));
    expect(container.textContent).toContain("Сеть недоступна");
    await act(async () => resolveFirst(response("no_coverage")));
    expect(container.textContent).toContain("Сеть недоступна");
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toContain("нет пригодных данных");
    expect(cachedSoil(second)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    localStorage.clear();
  }
});
