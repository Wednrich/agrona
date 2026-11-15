// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import FieldForm from "../src/components/FieldForm";
import { initialDemo } from "../src/lib/demo";

const save = vi.hoisted(() => vi.fn().mockResolvedValue("saved-field"));
vi.mock("../src/lib/data", () => ({ useData: () => ({ save }) }));

it("saves an already drawn field without asking for soil or assuming that there is no irrigation", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const { boundary, farm_id: farmId } = initialDemo.fields[0];
  try {
    await act(async () => {
      root.render(
        <FieldForm
          farmId={farmId}
          boundary={boundary}
          onClose={onClose}
          onSaved={onSaved}
        />,
      );
    });
    const details = [...container.querySelectorAll("details")];
    expect(details.every((section) => !section.open)).toBe(true);
    expect(container.querySelector(".field-coordinate-table")).toBeNull();
    const form = container.querySelector("form")!;
    form.querySelector<HTMLInputElement>('input[name="name"]')!.value =
      "Новое поле";
    await act(async () => form.requestSubmit());
    expect(save).toHaveBeenCalledWith("fields", {
      farm_id: farmId,
      name: "Новое поле",
      soil_type: "",
      irrigation_type: "",
      boundary,
    });
    expect(onSaved).toHaveBeenCalledWith("saved-field");
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
