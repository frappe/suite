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

  it("carries exactly the fields the manifest call answers", () => {
    expect(Object.keys(manifest).sort()).toEqual([
      "group_limit",
      "modified",
      "node",
      "presentation",
      "reference_count",
      "references",
    ]);
    // `modified` is the staleness cue: a save that rewrites the reference table
    // mints new ids, and this moves with it. Re-fetch the manifest when it has
    // moved rather than retrying a group with ids the server will refuse.
    expect(typeof manifest.modified).toBe("string");
    expect(typeof manifest.presentation).toBe("string");
    expect(typeof manifest.node).toBe("string");
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
  it("carries exactly the fields the group call answers", () => {
    for (const group of groups) {
      // `request` is the fixture's own record of the call. It is never part of
      // an answer, which is why the backend comparison subtracts it.
      expect(Object.keys(group).sort()).toEqual([
        "node",
        "presentation",
        "references",
        "request",
      ]);
    }
  });

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

  it("counts the composite's own code inside the twenty a request may carry", () => {
    // Spec 6.6: one code for the composite, one per reference it reaches only
    // through a link. That is the arithmetic the bound of 19 exists for, so a
    // group whose references all came back readable must show it.
    const byLink = groups.filter((group) =>
      group.references.every((row) => row.readable),
    );
    expect(byLink.length).toBeGreaterThan(0);
    for (const group of byLink) {
      expect(group.request.x_drive_links.length).toBe(
        group.references.length + 1,
      );
    }
    const full = byLink.find(
      (group) => group.references.length === fixture.group_limit,
    );
    expect(full).toBeDefined();
    expect(full.request.x_drive_links.length).toBe(fixture.link_header_limit);
  });

  it("covers every manifest reference across the groups, once each", () => {
    // Set, not sequence. A client may ask for a group in any order it likes,
    // and the answer follows the request rather than the manifest, so pinning
    // the flattened order here would forbid a call the API allows.
    const requested = groups.flatMap((group) => group.request.references);
    const named = manifest.references.map((row) => row.reference);
    expect(requested.length).toBe(named.length);
    expect(new Set(requested)).toEqual(new Set(named));
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
    for (const group of groups) {
      for (const row of group.references) {
        expect(Object.keys(row).sort()).toEqual([
          "composite",
          "index",
          "node",
          "presentation",
          "readable",
          "reference",
          "slides",
        ]);
      }
    }
  });

  it("gives every slide of a readable reference the same fields", () => {
    const slides = groups
      .flatMap((group) => group.references)
      .filter((row) => row.readable)
      .flatMap((row) => row.slides);
    expect(slides.length).toBeGreaterThan(0);
    const shape = Object.keys(slides[0]).sort();
    // The renderer's own fields. The rest is frappe's row metadata, which the
    // whole-deck read path already answers and this contract keeps.
    for (const field of ["name", "background", "elements", "transition"]) {
      expect(shape).toContain(field);
    }
    for (const slide of slides) {
      expect(Object.keys(slide).sort()).toEqual(shape);
    }
  });
});

describe("the two reference shapes no group above produces", () => {
  const shapes = fixture.reference_shapes;

  it("gives them the same fields as any other reference row", () => {
    const expected = Object.keys(groups[0].references[0]).sort();
    for (const entry of Object.values(shapes)) {
      expect(Object.keys(entry.reference).sort()).toEqual(expected);
      expect(entry.note).toBeTruthy();
    }
  });

  it("marks a nested composite and does not recurse into it", () => {
    const row = shapes.nested_composite.reference;
    expect(row.readable).toBe(true);
    expect(row.composite).toBe(true);
    // Its own slide rows. A client that wants the inner deck's references asks
    // that deck for its own manifest, which runs that deck's own checks.
    expect(Array.isArray(row.slides)).toBe(true);
  });

  it("gives a reference that names no deck a null docname, never an empty one", () => {
    const row = shapes.reference_with_no_deck.reference;
    expect(row.presentation).toBeNull();
    expect(row.readable).toBe(false);
    expect(row.node).toBeNull();
    expect(row.slides).toBeNull();
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
      // frappe answers 417 for a `ValidationError` and 403 for a
      // `PermissionError`. A client switching on the status needs the exact
      // number, so `> 0` was no contract at all.
      expect(refusal.http_status).toBe(
        refusal.exception === "frappe.PermissionError" ? 403 : 417,
      );
    }
  });

  it("states the exact message the server answers", () => {
    expect(refusals.malformed_group.error).toBe(
      "A composite group is a list of reference ids",
    );
    expect(refusals.oversized_group.error).toBe(
      `A composite group takes at most ${fixture.group_limit} references`,
    );
    expect(refusals.repeated_reference.error).toBe(
      "A composite group cannot name the same reference twice",
    );
    expect(refusals.injected_reference.error).toBe(
      "A composite group may only name this presentation's own references",
    );
    expect(refusals.oversized_link_header.error).toBe(
      `X-Drive-Links accepts at most ${fixture.link_header_limit} items`,
    );
    expect(refusals.unreadable_composite.error).toBe(
      "Presentation is not public",
    );
  });

  it("warns that five of the six messages are translated at runtime", () => {
    // Only `unreadable_composite` is a bare literal in the source. The rest go
    // through `_()`, so a client on a translated site must switch on the
    // refusal kind and the status, never on this text.
    expect(fixture.readme.join(" ")).toContain("translated");
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
