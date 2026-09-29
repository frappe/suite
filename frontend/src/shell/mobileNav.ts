import type { AreaDefinition } from "@/platform/contracts";

export interface MobileNavItemDefinition {
  id: string;
  label: string;
  icon: AreaDefinition["icon"];
  to: string;
  active: boolean;
  /**
   * A tap on the active area opens its page's sidebar sheet, when the page
   * draws one. Every other tap navigates to the area's entry route [T015].
   */
  opensSidebar: boolean;
}

export function deriveMobileNav(
  areas: readonly AreaDefinition[],
  activeArea: string | undefined,
  hasSidebar: (area: string) => boolean,
): MobileNavItemDefinition[] {
  return areas.map(({ id, label, icon, to }) => {
    const active = id === activeArea;
    return {
      id,
      label: label(),
      icon,
      to,
      active,
      opensSidebar: active && hasSidebar(id),
    };
  });
}
