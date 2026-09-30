import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";

const registryState = vi.hoisted(() => ({
  inbox: { data: { unread: 7 } },
}));

vi.mock("@/apps/drive", () => ({
  filesArea: {
    id: "files",
    label: () => "files",
    icon: {},
    to: "/drive",
    loadRoutes: vi.fn(),
  },
}));

vi.mock("@/apps/mail", () => ({
  mailArea: {
    id: "mail",
    label: () => "mail",
    icon: {},
    to: "/mail",
    requires: ["jmap"],
    loadRoutes: vi.fn(),
  },
  useInboxSummary: () => registryState.inbox,
}));

vi.mock("@/apps/calendar", () => ({
  calendarArea: {
    id: "calendar",
    label: () => "calendar",
    icon: {},
    to: "/calendar",
    requires: ["jmap"],
    loadRoutes: vi.fn(),
  },
}));

vi.mock("@/apps/meet", () => ({
  meetArea: {
    id: "meet",
    label: () => "meet",
    icon: {},
    to: "/meet",
    loadRoutes: vi.fn(),
  },
}));

import {
  areaDefinitions,
  deriveAreaBadges,
  filterAreas,
  useAppRegistry,
} from "@/composition/appRegistry";
import type { Session } from "@/platform/session";

describe("app registry", () => {
  it("keeps the agreed area order", () => {
    expect(areaDefinitions.map((area) => area.id)).toEqual([
      "home",
      "files",
      "mail",
      "calendar",
      "meet",
    ]);
  });

  it("lists only the areas whose flip is on, in rail order", () => {
    const capabilities = { jmap: true, systemManager: false };
    const ids = (flips: { suite_flip_shell: boolean; suite_flip_files: boolean }) =>
      filterAreas(areaDefinitions, capabilities, flips).map((area) => area.id);

    expect(ids({ suite_flip_shell: false, suite_flip_files: false })).toEqual([]);
    expect(ids({ suite_flip_shell: true, suite_flip_files: false })).toEqual([
      "mail",
      "calendar",
      "meet",
    ]);
    expect(ids({ suite_flip_shell: true, suite_flip_files: true })).toEqual([
      "home",
      "files",
      "mail",
      "calendar",
      "meet",
    ]);
  });

  it("filters capability-gated areas without reordering the rest", () => {
    const flips = { suite_flip_shell: true, suite_flip_files: true };
    expect(
      filterAreas(areaDefinitions, { jmap: false, systemManager: false }, flips).map(
        (area) => area.id,
      ),
    ).toEqual(["home", "files", "meet"]);
  });

  it("derives the Mail badge from the inbox unread summary", () => {
    expect(deriveAreaBadges({ unread: 7 })).toEqual({ mail: 7 });
    expect(deriveAreaBadges(undefined)).toEqual({ mail: 0 });
    expect(deriveAreaBadges({ unread: -1 })).toEqual({ mail: 0 });
  });

  it("uses the Mail inbox summary as the registry badge source", () => {
    const session = {
      capabilities: ref({ jmap: true, systemManager: false }),
    } as unknown as Session;

    expect(useAppRegistry(session).badges.value).toEqual({ mail: 7 });
  });
});
