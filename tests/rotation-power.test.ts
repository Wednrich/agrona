import { setLanguage } from "../src/lib/i18n";
import { describe, it, expect, vi } from "vitest";
import { loadRotationPower } from "../src/features/rotation-power";
import { compareWaterRanges } from "../src/features/rotation";

setLanguage("ru");

describe("rotation automatic weather", () => {
  it("starts a cold-cache job and waits for matching observations", async () => {
    const rows = [{ observation_date: "2025-05-01", precipitation_mm: 0 }];
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ data: { pending: true } })
      .mockResolvedValueOnce({
        data: { metadata: { geometry: "boundary" }, observations: rows },
      });
    expect(
      await loadRotationPower(
        invoke,
        "field",
        2025,
        "boundary",
        new AbortController().signal,
        0,
      ),
    ).toEqual(rows);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][1].body).toEqual({
      fieldId: "field",
      year: 2025,
    });
  });
  it("rejects a previous boundary, source errors and failed jobs", async () => {
    for (const response of [
      { data: { metadata: { geometry: "old" }, observations: [] } },
      { error: new Error("offline") },
      { data: { warning: "failed" } },
    ]) {
      await expect(
        loadRotationPower(
          vi.fn().mockResolvedValue(response),
          "f",
          2025,
          "new",
          new AbortController().signal,
          0,
        ),
      ).rejects.toThrow();
    }
  });
  it("bounds pending jobs and stops on cancellation", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { pending: true } });
    await expect(
      loadRotationPower(
        invoke,
        "f",
        2025,
        "b",
        new AbortController().signal,
        0,
        2,
      ),
    ).rejects.toThrow("не завершена");
    expect(invoke).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadRotationPower(invoke, "f", 2025, "b", controller.signal),
    ).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
describe("reference water comparison", () => {
  it("distinguishes equal, higher, overlapping and strictly lower ranges", () => {
    expect(compareWaterRanges([400, 600], [400, 600])).toContain("равны");
    expect(compareWaterRanges([400, 600], [650, 700])).toContain("выше");
    expect(compareWaterRanges([400, 600], [350, 550])).toContain(
      "снижение не подтверждено",
    );
    expect(compareWaterRanges([400, 600], [200, 300])).toContain(
      "не прогноз экономии полива",
    );
  });
});
