import { describe, expect, it } from "vitest";

import { areaDefinitions, filterAreas } from "@/composition/appRegistry";

describe("app registry", () => {
  it("keeps the agreed area order", () => {
    expect(areaDefinitions.map((area) => area.id)).toEqual([
      "home",
      "files",
      "mail",
      "calendar",
    ]);
  });

  it("filters capability-gated areas without reordering the rest", () => {
    expect(
      filterAreas(areaDefinitions, { jmap: false, systemManager: false }).map(
        (area) => area.id,
      ),
    ).toEqual(["home", "files"]);
    expect(
      filterAreas(areaDefinitions, { jmap: true, systemManager: false }).map(
        (area) => area.id,
      ),
    ).toEqual(["home", "files", "mail", "calendar"]);
  });
});
