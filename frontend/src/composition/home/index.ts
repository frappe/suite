import { defineComponent, h } from "vue";

import type { AreaDefinition } from "@/platform/contracts";
import { translate as __ } from "@/platform/translation";

const HomeIcon = defineComponent({
  name: "HomeAreaIcon",
  setup: () => () =>
    h("span", { class: "lucide-house size-4", "aria-hidden": "true" }),
});

export const homeArea: AreaDefinition = {
  id: "home",
  label: () => __("Home"),
  icon: HomeIcon,
  to: "/home",
  loadRoutes: () => import("@/composition/home/routes"),
  loadPanel: () =>
    import("@/composition/home/HomePanel.vue").then(
      ({ default: panel }) => panel,
    ),
};
