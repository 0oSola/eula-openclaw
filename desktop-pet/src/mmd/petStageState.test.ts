import { describe, expect, it } from "vitest";

import { buildPetStageKey, pickSelectedModel, selectFavoriteVmdUrls } from "./petStageState";

const models = [
  { relative_path: "Eula/Eula.pmx", url: "/assets/mmd/Eula/Eula.pmx", display_name: "Eula" },
  { relative_path: "Ayaka/Ayaka.pmx", url: "/assets/mmd/Ayaka/Ayaka.pmx", display_name: "Ayaka" },
];

describe("pet stage state", () => {
  it("selects configured model when available", () => {
    expect(pickSelectedModel(models as any, "Ayaka/Ayaka.pmx")?.relative_path).toBe("Ayaka/Ayaka.pmx");
  });

  it("falls back to first model", () => {
    expect(pickSelectedModel(models as any, "Missing.pmx")?.relative_path).toBe("Eula/Eula.pmx");
  });

  it("skips tiny placeholder models when no configured model is selected", () => {
    expect(
      pickSelectedModel(
        [
          { relative_path: "Tiny/Tiny.pmx", url: "/assets/mmd/Tiny/Tiny.pmx", display_name: "Tiny", size_bytes: 3 },
          {
            relative_path: "Visible/Visible.pmx",
            url: "/assets/mmd/Visible/Visible.pmx",
            display_name: "Visible",
            size_bytes: 2048,
          },
        ] as any,
        null,
      )?.relative_path,
    ).toBe("Visible/Visible.pmx");
  });

  it("keeps only current model favorite vmd assets", () => {
    const urls = selectFavoriteVmdUrls(
      [
        { is_favorite: true, favorite_model_relative_path: "Eula/Eula.pmx", asset_id: "a" },
        { is_favorite: true, favorite_model_relative_path: "Ayaka/Ayaka.pmx", asset_id: "b" },
        { is_favorite: false, favorite_model_relative_path: "Eula/Eula.pmx", asset_id: "c" },
      ] as any,
      "Eula/Eula.pmx",
    );

    expect(urls).toEqual(["/assets/vmd/file/a"]);
  });

  it("builds a stage key that changes when explicit sync reloads", () => {
    expect(buildPetStageKey("Eula/Eula.pmx", "mio-reference", 0)).toBe("Eula/Eula.pmx::mio-reference::0");
    expect(buildPetStageKey("Eula/Eula.pmx", "mio-reference", 1)).toBe("Eula/Eula.pmx::mio-reference::1");
  });
});
