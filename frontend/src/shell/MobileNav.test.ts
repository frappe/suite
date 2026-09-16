import { defineComponent } from "vue";
import { describe, expect, it, vi } from "vitest";

vi.mock("frappe-ui", () => ({
  MobileNav: defineComponent({ template: "<nav><slot /></nav>" }),
  MobileNavItem: defineComponent({ template: "<a><slot /></a>" }),
}));

import { deriveMobileNav } from "@/shell/mobileNav";

describe("mobile navigation", () => {
  it("derives labels, icons and targets from the area registry", () => {
    const icon = defineComponent({ template: "<span />" });
    expect(
      deriveMobileNav([
        {
          id: "home",
          label: () => "Home",
          icon,
          to: "/home",
          loadRoutes: vi.fn(),
          loadPanel: vi.fn(),
        },
        {
          id: "files",
          label: () => "Files",
          icon,
          to: "/files",
          loadRoutes: vi.fn(),
          loadPanel: vi.fn(),
        },
      ]),
    ).toEqual([
      { id: "home", label: "Home", icon, to: "/home" },
      { id: "files", label: "Files", icon, to: "/files" },
    ]);
  });
});
