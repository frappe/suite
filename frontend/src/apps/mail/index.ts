import { defineComponent, h, type Component } from "vue";

import { inboxSummary } from "@/apps/mail/client/inboxSummary";
import type { AreaDefinition } from "@/platform/contracts";
import { useQuery } from "@/platform/server-state";
import { translate as __ } from "@/platform/translation";

const MailIcon = defineComponent({
  name: "MailAreaIcon",
  setup: () => () =>
    h("span", { class: "lucide-mail size-4", "aria-hidden": "true" }),
});

export const mailArea: AreaDefinition = {
  id: "mail",
  label: () => __("Mail"),
  icon: MailIcon,
  to: "/mail",
  requires: ["jmap"],
  // Ticket 010 owns shell adoption. The existing MailLayout keeps its full frame for now.
  loadRoutes: () => import("@/apps/mail/routes"),
  loadPanel: async (): Promise<Component> =>
    defineComponent({
      name: "MailPanelPlaceholder",
      setup: () => () =>
        h(
          "p",
          { class: "px-2 py-1 text-p-sm text-ink-gray-5" },
          __("Mail navigation stays in Mail until ticket 010."),
        ),
    }),
};

export function useInboxSummary(enabled: () => boolean = () => true) {
  return useQuery(() => (enabled() ? inboxSummary() : false));
}
