import { describe, expect, it } from "vitest";

import { cellAnchor, readAnchor, readThreads, readVersions, WORKBOOK_ANCHOR } from "./records";

describe("Sheets comment anchors", () => {
  it("names a cell on a worksheet and reads it back, whatever the sheet name holds", () => {
    for (const anchor of [{ sheet: "Sheet1", cell: "B3" }, { sheet: "Q1!Budget", cell: "AA120" }]) {
      expect(readAnchor(cellAnchor(anchor))).toEqual(anchor);
    }
  });

  it("reads the workbook anchor and foreign anchors as no cell", () => {
    expect(readAnchor(WORKBOOK_ANCHOR)).toBeNull();
    expect(readAnchor("document")).toBeNull();
    expect(readAnchor("sheets:cell:not-a-cell!Sheet1")).toBeNull();
    expect(readAnchor(42)).toBeNull();
  });

  it("falls back to the workbook when a sheet name would pass Drive's anchor limit", () => {
    expect(cellAnchor({ sheet: "x".repeat(260), cell: "A1" })).toBe(WORKBOOK_ANCHOR);
  });
});

describe("Drive records for Sheets", () => {
  it("reads threads as Drive publishes them, preferring a guest's typed name", () => {
    const threads = readThreads({
      threads: [
        {
          name: "t1",
          node: "n1",
          anchor: "sheets:cell:C4!Sheet1",
          resolved: false,
          comments: [
            { name: "c1", content: "Check this total", author: "ann@example.com", author_name: null, creation: "2026-09-29 10:00:00" },
            { name: "c2", content: "Fixed", author: "Guest", author_name: "Visitor", creation: "2026-09-29 10:05:00" },
          ],
        },
        { name: "t2", anchor: "document", resolved: true, comments: [] },
        { anchor: "sheets:workbook" },
      ],
    });

    expect(threads).toEqual([
      {
        name: "t1",
        anchor: { sheet: "Sheet1", cell: "C4" },
        resolved: false,
        comments: [
          { name: "c1", content: "Check this total", author: "ann@example.com", author_name: null, creation: "2026-09-29 10:00:00" },
          { name: "c2", content: "Fixed", author: "Guest", author_name: "Visitor", creation: "2026-09-29 10:05:00" },
        ],
      },
      { name: "t2", anchor: null, resolved: true, comments: [] },
    ]);
  });

  it("reads a version page and drops rows without a sequence", () => {
    expect(readVersions({
      rows: [
        { seq: 3, kind: "named", label: "Before import", pinned: 1, actor: "ann@example.com", creation: "2026-09-29 11:00:00" },
        { seq: 2, kind: "auto", label: null, pinned: 0, actor: null, creation: null },
        { seq: "1", kind: "auto" },
      ],
      next_cursor: "abc",
    })).toEqual({
      rows: [
        { seq: "3", kind: "named", label: "Before import", pinned: true, actor: "ann@example.com", creation: "2026-09-29 11:00:00" },
        { seq: "2", kind: "auto", label: null, pinned: false, actor: null, creation: null },
      ],
      nextCursor: "abc",
    });
    expect(readVersions(null)).toEqual({ rows: [], nextCursor: null });
  });
});
