// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import App from "../src/App";
import { setLanguage } from "../src/lib/i18n";

vi.mock("../src/lib/auth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

it("starts in English and applies a saved Russian preference from the language selector", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      await import("../src/pages/Landing");
      root.render(
        <MemoryRouter>
          <App />
        </MemoryRouter>,
      );
    });
    expect(host.textContent).toContain("Features");
    expect(document.documentElement.lang).toBe("en");

    const select = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Interface language"]',
    )!;
    await act(async () => {
      select.value = "ru";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.textContent).toContain("Возможности");
    expect(document.documentElement.lang).toBe("ru");
    expect(localStorage.getItem("agrona-language")).toBe("ru");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    setLanguage("en");
    localStorage.removeItem("agrona-language");
  }
});
