import { defineComponent, h } from "vue";

import type { AreaDefinition } from "@/platform/contracts";
import { translate as __ } from "@/platform/translation";

export { upcomingEvents } from "@/apps/calendar/client/events";
export type {
  CalendarEvent,
  UpcomingEventsInput,
} from "@/apps/calendar/client/events";

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
};
