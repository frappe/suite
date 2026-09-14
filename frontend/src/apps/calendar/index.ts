import { defineComponent, h, type Component } from "vue";

import type { AreaDefinition } from "@/platform/contracts";
import { translate as __ } from "@/platform/translation";

const CalendarIcon = defineComponent({
  name: "CalendarAreaIcon",
  setup: () => () =>
    h("span", { class: "lucide-calendar-days size-4", "aria-hidden": "true" }),
});

export const calendarArea: AreaDefinition = {
  id: "calendar",
  label: () => __("Calendar"),
  icon: CalendarIcon,
  to: "/calendar",
  requires: ["jmap"],
  // Ticket 010 owns shell adoption. The existing CalendarLayout keeps its full frame for now.
  loadRoutes: () => import("@/apps/calendar/routes"),
  loadPanel: async (): Promise<Component> =>
    defineComponent({
      name: "CalendarPanelPlaceholder",
      setup: () => () =>
        h(
          "p",
          { class: "px-2 py-1 text-p-sm text-ink-gray-5" },
          __("Calendar navigation stays in Calendar until ticket 010."),
        ),
    }),
};
