import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
} from "terra-draw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Landing from "../src/pages/Landing";
import { polygonFromCoordinates } from "../src/lib/field-boundary";
import { initialDemo } from "../src/lib/demo";
import { rotationClimateKey, writeField } from "../src/lib/field-write";
import { workspaceAccess } from "../src/lib/workspace-access";

const { auth } = vi.hoisted(() => ({
  auth: {
    user: null as { id: string } | null,
    loading: false,
    enterDemo: vi.fn(),
  },
}));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth }));

describe("workspace access", () => {
  beforeEach(() => {
    auth.user = null;
    auth.loading = false;
  });

  it("links to sign-in when signed out and to the workspace with a session", () => {
    const landing = () =>
      renderToStaticMarkup(
        <MemoryRouter>
          <Landing />
        </MemoryRouter>,
      );
    expect(landing()).toContain('href="/auth"');
    auth.user = { id: "farmer" };
    const page = landing();
    expect(page).toContain('href="/map"');
    expect(page).not.toContain('href="/auth"');
    expect(auth.user.id).toBe("farmer");
  });

  it("does not let a stored demo flag win over hydration or an existing session", () => {
    expect(workspaceAccess(undefined, true, true).demo).toBe(false);
    expect(workspaceAccess("farmer", false, true)).toEqual({
      destination: "/map",
      demo: false,
      canEnterDemo: false,
    });
    expect(workspaceAccess(undefined, false, true).demo).toBe(true);
  });
});

describe("editing an existing field", () => {
  const setup = () => {
    const data = structuredClone(initialDemo);
    const field = data.fields[0];
    const insert = vi.fn();
    const update = vi.fn((columns: Record<string, unknown>) => ({
      eq: (key: string, id: string) => ({
        select: () => ({
          single: async () => {
            const match = data.fields.find(
              (item) => key === "id" && item.id === id,
            );
            if (!match)
              return { data: null, error: { message: "No visible row" } };
            Object.assign(match, columns);
            return { data: { id: match.id }, error: null };
          },
        }),
      }),
    }));
    const db = {
      from: () => ({ insert, update }),
    } as unknown as SupabaseClient;
    return { data, field, db, insert, update };
  };

  it("updates the matching row without inserting or touching metadata and seasons", async () => {
    const { data, field, db, insert, update } = setup();
    const before = structuredClone(data);
    const { geometry: boundary } = polygonFromCoordinates([
      { latitude: "51", longitude: "69" },
      { latitude: "51", longitude: "70" },
      { latitude: "52", longitude: "70" },
    ]);
    const noop = () => {};
    const editor = new TerraDraw({
      modes: [new TerraDrawPolygonMode(), new TerraDrawSelectMode()],
      adapter: {
        register: noop,
        unregister: noop,
        render: noop,
        clear: noop,
        setCursor: noop,
        setDoubleClickToZoom: noop,
        getCoordinatePrecision: () => 9,
        getMapEventElement: () => {
          throw new Error("No map in this test");
        },
        getLngLatFromEvent: () => null,
        project: (x, y) => ({ x, y }),
        unproject: (x, y) => ({ lng: x, lat: y }),
      },
    });
    editor.start();
    const [added] = editor.addFeatures([
      {
        type: "Feature",
        geometry: field.boundary,
        properties: { mode: "polygon" },
      },
    ]);
    expect(added.valid).toBe(true);
    if (added.id == null) throw new Error("Missing Terra Draw feature ID");
    editor.updateFeatureGeometry(added.id, boundary);
    editor.setMode("select");
    editor.selectFeature(added.id);
    const edited = editor.getSnapshotFeature(added.id)?.geometry;
    editor.stop();
    expect(await writeField(db, { id: field.id, boundary: edited })).toBe(
      before.fields[0].id,
    );
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      boundary: "SRID=4326;POLYGON((69 51,70 51,70 52,69 51))",
    });
    expect(data.fields.length).toBe(before.fields.length);
    expect({ ...field, boundary: before.fields[0].boundary }).toEqual(
      before.fields[0],
    );
    expect(data.seasons).toEqual(before.seasons);
  });

  it("fails if the row is missing or inaccessible", async () => {
    const { field, db, insert } = setup();
    await expect(
      writeField(db, { id: "missing", boundary: field.boundary }),
    ).rejects.toThrow("No visible row");
    expect(insert).not.toHaveBeenCalled();
  });

  it("keeps previous analytics in a separate cache entry after a boundary edit", () => {
    const field = initialDemo.fields[0];
    const newField = structuredClone(field);
    newField.boundary.coordinates[0][1][0] += 0.01;
    const cache = new QueryClient();
    cache.setQueryData(rotationClimateKey("farmer", field), [
      "old observations",
    ]);
    expect(
      cache.getQueryData(rotationClimateKey("farmer", newField)),
    ).toBeUndefined();
    expect(
      cache.getQueryData(rotationClimateKey("other", field)),
    ).toBeUndefined();
    expect(cache.getQueryData(rotationClimateKey("farmer", field))).toEqual([
      "old observations",
    ]);
  });
});
