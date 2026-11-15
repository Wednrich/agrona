// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiAdvisorChat, ExplainAdvisor } from "../src/components/AiAdvisor";

const requestAdvisor = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/advisor", () => ({ requestAdvisor }));

const scope = {
  fieldId: "00000000-0000-4000-8000-000000000010",
  year: 2025,
  start: "2025-05-01",
  end: "2025-09-30",
};
const response = {
  summary: "Видны сухие отрезки.",
  method: "deepseek",
  focus: "rain",
  observations: [
    {
      text: "2,5 мм осадков",
      source: "NASA POWER",
      url: "https://power.larc.nasa.gov/",
    },
  ],
  interpretations: [],
  recommendations: [],
  limitations: ["NDVI пока недоступен."],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  requestAdvisor.mockReset().mockResolvedValue(response);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("sends the selected period only after the explicit analytics action", async () => {
  await act(async () => root.render(<ExplainAdvisor scope={scope} />));
  expect(requestAdvisor).not.toHaveBeenCalled();
  await act(async () => host.querySelector("button")!.click());
  expect(requestAdvisor).toHaveBeenCalledWith({
    ...scope,
    language: "en",
    mode: "analysis",
  });
  expect(host.textContent).toContain("NDVI пока недоступен.");
  expect(host.querySelector("a")?.href).toBe("https://power.larc.nasa.gov/");
});

it("shows conversation history and uses the preceding supported topic on follow-up", async () => {
  await act(async () =>
    root.render(<AiAdvisorChat scope={scope} demo={false} />),
  );
  expect(requestAdvisor).not.toHaveBeenCalled();
  const example = host.querySelector<HTMLButtonElement>(
    ".advisor-examples button",
  )!;
  await act(async () => example.click());
  expect(requestAdvisor).not.toHaveBeenCalled();
  const send = host.querySelector<HTMLButtonElement>("button[type=submit]")!;
  await act(async () => send.click());
  expect(requestAdvisor).toHaveBeenCalledWith({
    ...scope,
    mode: "chat",
    language: "en",
    question: example.textContent,
    focus: undefined,
  });
  const followUp = host.querySelectorAll<HTMLButtonElement>(
    ".advisor-examples button",
  )[1];
  await act(async () => followUp.click());
  await act(async () => send.click());
  expect(requestAdvisor.mock.calls[1][0].focus).toBe("rain");
  expect(host.querySelectorAll('[role="log"] article')).toHaveLength(2);
});
