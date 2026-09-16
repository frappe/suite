import { describe, expect, it } from "vitest";

import { freezesEdits } from "./access";

describe("document access downgrade", () => {
  it("freezes edits when EDIT is lost", () => {
    expect(freezesEdits(40, 20)).toBe(true);
    expect(freezesEdits(50, 10)).toBe(true);
    expect(freezesEdits(20, 10)).toBe(false);
  });
});
