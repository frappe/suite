import { computed, h, type ComputedRef } from "vue";
import { ItemListRow, type DropdownOptions } from "frappe-ui";

import { useSession } from "@/platform/session";
import { translate as __ } from "@/platform/translation";

// A custom row takes the menu's highlight itself: the menu item renders as
// the row, not around it.
const HIGHLIGHT =
  "cursor-pointer outline-none focus:bg-surface-alpha-gray-2 data-[highlighted]:bg-surface-alpha-gray-2";

function icon(name: string) {
  return h("span", { class: [name, "size-4 shrink-0 text-ink-gray-6"], "aria-hidden": "true" });
}

/**
 * The desktop account menu [T021]: who is signed in, Open Desk for system
 * managers, then Log out.
 * Settings is not here: the menu opens from the rail, and the rail's gear
 * sits directly above the avatar (spec section 3.5).
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
          // Upgrade plan joins here once the site resource carries
          // `upgrade_url` (ask S5).
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
