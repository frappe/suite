import { beforeEach, describe, expect, it, vi } from "vitest";

import { downloadRecovery, keepRecovery, readRecovery, recoveryFile } from "./recovery";

beforeEach(() => localStorage.clear());

describe("Writer recovery copy", () => {
  it("keeps the latest copy per document and reads it back", () => {
    keepRecovery("node-1", "<p>first</p>", new Date("2026-09-29T10:00:00Z"));
    keepRecovery("node-1", "<p>second</p>", new Date("2026-09-29T10:05:00Z"));
    keepRecovery("node-2", "<p>other</p>");

    expect(readRecovery("node-1")).toEqual({ savedAt: "2026-09-29T10:05:00.000Z", html: "<p>second</p>" });
    expect(readRecovery("node-3")).toBeNull();
  });

  it("ignores a copy it cannot read", () => {
    localStorage.setItem("suite:writer-recovery:node-1", "not json");
    expect(readRecovery("node-1")).toBeNull();
  });

  it("offers the copy as a standalone HTML file named after the document", async () => {
    const file = recoveryFile({ savedAt: "2026-09-29T10:05:00.000Z", html: "<p>Unsaved <b>work</b></p>" }, "Q3 <plan>");

    expect(file.name).toBe("Q3 plan (recovered).html");
    expect(file.type).toBe("text/html");
    const text = await file.text();
    expect(text).toContain("<title>Q3 &lt;plan&gt;</title>");
    expect(text).toContain("<p>Unsaved <b>work</b></p>");
  });

  it("hands the copy over once, then removes it", () => {
    const saved: string[] = [];
    // jsdom has no object URLs.
    const url = URL as { createObjectURL?: (blob: Blob) => string; revokeObjectURL?: (href: string) => void };
    url.createObjectURL = () => "blob:recovery";
    url.revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    keepRecovery("node-1", "<p>unsaved</p>");

    expect(downloadRecovery("node-1", "Plan")).toBe(true);
    expect(saved).toEqual(["Plan (recovered).html"]);
    expect(readRecovery("node-1")).toBeNull();
    expect(downloadRecovery("node-1", "Plan")).toBe(false);
    click.mockRestore();
    delete url.createObjectURL;
    delete url.revokeObjectURL;
  });
});
