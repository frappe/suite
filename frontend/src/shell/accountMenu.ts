import { computed, h, type ComputedRef } from "vue";
import { ItemListRow, Tooltip, type DropdownOptions } from "frappe-ui";

import { useSession } from "@/platform/session";
import { translate as __ } from "@/platform/translation";
import { openSettings } from "@/shell/settings/useSettingsDialog";

// A custom row takes the menu's highlight itself: the menu item renders as
// the row, not around it.
const HIGHLIGHT =
  "cursor-pointer outline-none focus:bg-surface-alpha-gray-2 data-[highlighted]:bg-surface-alpha-gray-2";

function icon(name: string, disabled = false) {
  return h("span", {
    class: [name, "size-4 shrink-0", disabled ? "text-ink-gray-4" : "text-ink-gray-6"],
    "aria-hidden": "true",
  });
}

/**
 * The desktop account menu [T021]: who is signed in, Settings, Open Desk and
 * Upgrade plan for system managers, then Log out.
 */
export function useAccountMenu(): ComputedRef<DropdownOptions> {
  const session = useSession();

  return computed(() => {
    const user = session.user.value;
    const name = user?.fullName || user?.id || __("Account");
    const email = user?.email ?? user?.id ?? "";
    const systemManager = session.capabilities.value.systemManager;

    return [
      {
        group: __("Account"),
        hideLabel: true,
        options: [
          {
            label: name,
            disabled: true,
            slots: {
              item: () =>
                h("div", { class: "flex min-w-0 flex-col px-2 py-1.5" }, [
                  h("span", { class: "truncate text-base font-medium text-ink-gray-8" }, name),
                  email && email !== name
                    ? h("span", { class: "truncate text-sm text-ink-gray-5" }, email)
                    : null,
                ]),
            },
          },
        ],
      },
      {
        group: __("Actions"),
        hideLabel: true,
        options: [
          {
            label: __("Settings"),
            icon: "lucide-settings",
            onClick: () => openSettings(),
          },
          {
            // A full page load in the same tab: Desk is not part of this app.
            label: __("Open Desk"),
            condition: () => systemManager,
            slots: {
              item: () =>
                h(
                  ItemListRow,
                  { as: "a", href: "/app", class: HIGHLIGHT },
                  { prefix: () => icon("lucide-app-window"), label: () => __("Open Desk") },
                ),
            },
          },
          {
            // Disabled until the site resource carries `upgrade_url` (ask S5).
            label: __("Upgrade plan"),
            disabled: true,
            condition: () => systemManager,
            slots: {
              item: () =>
                h(
                  ItemListRow,
                  { disabled: true },
                  {
                    prefix: () => icon("lucide-circle-arrow-up", true),
                    label: () =>
                      h(
                        Tooltip,
                        { text: __("Not available yet"), side: "right" },
                        { default: () => h("span", { class: "block truncate" }, __("Upgrade plan")) },
                      ),
                  },
                ),
            },
          },
        ],
      },
      {
        group: __("Session"),
        hideLabel: true,
        options: [
          {
            label: __("Log out"),
            icon: "lucide-log-out",
            onClick: () => void session.logout().then(() => window.location.reload()),
          },
        ],
      },
    ];
  });
}
