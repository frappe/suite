import { computed } from "vue";

import { useSession } from "@/platform/session";
import { translate as __ } from "@/platform/translation";
import { openSettings } from "@/shell/settings/useSettingsDialog";

export function useAccountMenu() {
  const session = useSession();

  return computed(() => [
    {
      label: __("Settings"),
      icon: "lucide-user-round",
      onClick: () => openSettings("profile"),
    },
    {
      label: __("Upgrade plan"),
      icon: "lucide-arrow-up-circle",
      disabled: true,
    },
    {
      label: __("Log out"),
      icon: "lucide-log-out",
      onClick: () => void session.logout().then(() => window.location.reload()),
    },
  ]);
}
