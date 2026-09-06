import { describe, expect, it } from "vitest";

import fixture from "./composite-groups.fixture.json";

// The client contract for the Slides grouped composite load (ticket 20,
// spec 6.2 and 6.6). The backend side of the same fixture is checked by
// `suite/slides/tests/test_composite_groups.py`, so a field that moves on
// either side fails on both.
//
// Ticket 34 adopts this in the SPA. Until then these tests hold the fixture to
// the rules the client will code against.

const { manifest, groups, refusals } = fixture;

describe("the manifest", () => {
  it("names every reference once, in order, with no content", () => {
    expect(manifest.reference_count).toBe(manifest.references.length);
    expect(manifest.references.map((row) => row.index)).toEqual(
      manifest.references.map((_row, position) => position + 1),
    );
    for (const row of manifest.references) {
      expect(Object.keys(row).sort()).toEqual([
        "index",
        "presentation",
        "reference",
      ]);
    }
  });

  it("gives every reference its own identifier", () => {
    const ids = manifest.references.map((row) => row.reference);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never uses a deck name or the composite node as a reference identifier", () => {
    const names = new Set([
      manifest.presentation,
      manifest.node,
      ...manifest.references.map((row) => row.presentation),
    ]);
    for (const row of manifest.references) {
      expect(names.has(row.reference)).toBe(false);
    }
  });

  it("describes a composite that cannot be loaded in one request", () => {
    expect(manifest.reference_count).toBeGreaterThan(fixture.link_header_limit);
    expect(manifest.group_limit).toBe(fixture.group_limit);
    expect(fixture.group_limit).toBe(fixture.link_header_limit - 1);
  });
});

describe("a group", () => {
  it("answers one entry per requested id, in the order it was asked", () => {
    for (const group of groups) {
      expect(group.references.map((row) => row.reference)).toEqual(
        group.request.references,
      );
    }
  });

  it("never asks for more references than the bound, and leaves a code for the composite", () => {
    for (const group of groups) {
      expect(group.request.references.length).toBeLessThanOrEqual(
        fixture.group_limit,
      );
      expect(group.request.x_drive_links.length).toBeLessThanOrEqual(
        fixture.link_header_limit,
      );
      expect(group.request.x_drive_links.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("covers every manifest reference across the groups, once each", () => {
    const requested = groups.flatMap((group) => group.request.references);
    expect(requested).toEqual(manifest.references.map((row) => row.reference));
  });

  it("keeps a reference identifier and its index from the manifest", () => {
    const byId = new Map(
      manifest.references.map((row) => [row.reference, row]),
    );
    for (const group of groups) {
      for (const row of group.references) {
        expect(byId.get(row.reference)).toMatchObject({
          index: row.index,
          presentation: row.presentation,
        });
      }
    }
  });

  it("gives a readable reference a node and slides", () => {
    const readable = groups
      .flatMap((group) => group.references)
      .filter((row) => row.readable);
    expect(readable.length).toBeGreaterThan(0);
    for (const row of readable) {
      expect(row.node).toBeTruthy();
      expect(Array.isArray(row.slides)).toBe(true);
      expect(typeof row.composite).toBe("boolean");
    }
  });

  it("gives an unreadable reference a placeholder and no content at all", () => {
    const marked = groups
      .flatMap((group) => group.references)
      .filter((row) => !row.readable);
    expect(marked.length).toBeGreaterThan(0);
    for (const row of marked) {
      // Marked, never dropped, and never given the node id every Drive
      // route takes as its handle.
      expect(row.node).toBeNull();
      expect(row.slides).toBeNull();
      expect(row.composite).toBeNull();
      expect(row.reference).toBeTruthy();
    }
  });

  it("states the same fields for a readable and an unreadable reference", () => {
    const shapes = groups
      .flatMap((group) => group.references)
      .map((row) => Object.keys(row).sort().join(","));
    expect(new Set(shapes).size).toBe(1);
  });
});

describe("refusals", () => {
  it("states an error and a status for every refusal a client must handle", () => {
    expect(Object.keys(refusals).sort()).toEqual([
      "injected_reference",
      "malformed_group",
      "oversized_group",
      "oversized_link_header",
      "repeated_reference",
      "unreadable_composite",
    ]);
    for (const refusal of Object.values(refusals)) {
      expect(refusal.error).toBeTruthy();
      expect(refusal.http_status).toBeGreaterThan(0);
    }
  });

  it("separates a request the client got wrong from an answer about access", () => {
    const shape = [
      refusals.injected_reference,
      refusals.malformed_group,
      refusals.oversized_group,
      refusals.repeated_reference,
    ];
    for (const refusal of shape) {
      expect(refusal.exception).toBe("frappe.ValidationError");
    }
    expect(refusals.unreadable_composite.exception).toBe(
      "frappe.PermissionError",
    );
  });

  it("refuses an oversized group at the bound, not one past the header limit", () => {
    expect(refusals.oversized_group.request.references.length).toBe(
      fixture.group_limit + 1,
    );
    expect(refusals.oversized_link_header.request.x_drive_links_count).toBe(
      fixture.link_header_limit + 1,
    );
  });
});
