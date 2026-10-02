import HomeIcon from "@/composition/home/AreaIcon.vue";
import type { AreaDefinition } from "@/platform/contracts";
import { translate as __ } from "@/platform/translation";

export const homeArea: AreaDefinition = {
  id: "home",
  label: () => __("Home"),
  icon: HomeIcon,
  to: "/home",
  loadRoutes: () => import("@/composition/home/routes"),
};
