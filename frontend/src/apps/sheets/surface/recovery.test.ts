import { beforeEach, describe, expect, it, vi } from "vitest";
import { read } from "xlsx";

import { downloadRecovery, keepRecovery, readRecovery, recoveryFile } from "./recovery";

/** A workbook as `sheets_data` stores it: packed rows, 0-based. */
const workbook = JSON.stringify({
  sheet: {
    v: 2,
    current: "Budget",
    sheets: {
      Budget: { rows: { "0": ["Item", "Cost"], "1": ["Rent", "1200"], "2": ["Total", "=SUM(B2:B2)"] } },
      Notes: { rows: { "0": ["typed but not committed"] } },
    },
  },
  formats: {},
});

beforeEach(() => localStorage.clear());

describe("Sheets recovery copy", () => {
  it("keeps the latest copy per spreadsheet and reads it back", () => {
    keepRecovery("node-1", "{}", new Date("2026-09-29T10:00:00Z"));
    keepRecovery("node-1", workbook, new Date("2026-09-29T10:05:00Z"));
    keepRecovery("node-2", "{}");

    expect(readRecovery("node-1")).toEqual({ savedAt: "2026-09-29T10:05:00.000Z", workbook });
    expect(readRecovery("node-3")).toBeNull();
  });

  it("ignores a copy it cannot read", () => {
    localStorage.setItem("suite:sheets-recovery:node-1", "not json");
    expect(readRecovery("node-1")).toBeNull();
  });

  it("offers the copy as an Excel workbook with every sheet, value and formula", async () => {
    const file = await recoveryFile({ savedAt: "2026-09-29T10:05:00.000Z", workbook }, "Q3 <budget>");

    expect(file.name).toBe("Q3 budget (recovered).xlsx");
    const book = read(await file.arrayBuffer());
    expect(book.SheetNames).toEqual(["Budget", "Notes"]);
    const budget = book.Sheets.Budget!;
    expect(budget.A1?.v).toBe("Item");
    expect(budget.B2?.v).toBe(1200);
    expect(budget.B3?.f).toBe("SUM(B2:B2)");
    expect(book.Sheets.Notes!.A1?.v).toBe("typed but not committed");
  });

  it("hands the copy over once, then removes it", async () => {
    const saved: string[] = [];
    // jsdom has no object URLs.
    const url = URL as { createObjectURL?: (blob: Blob) => string; revokeObjectURL?: (href: string) => void };
    url.createObjectURL = () => "blob:recovery";
    url.revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    keepRecovery("node-1", workbook);

    await expect(downloadRecovery("node-1", "Budget")).resolves.toBe(true);
    expect(saved).toEqual(["Budget (recovered).xlsx"]);
    expect(readRecovery("node-1")).toBeNull();
    await expect(downloadRecovery("node-1", "Budget")).resolves.toBe(false);
    click.mockRestore();
    delete url.createObjectURL;
    delete url.revokeObjectURL;
  });
});
