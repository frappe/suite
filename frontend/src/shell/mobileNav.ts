import type { AreaDefinition } from "@/platform/contracts";

export interface MobileNavItemDefinition {
  id: string;
  label: string;
  icon: AreaDefinition["icon"];
  to: string;
}

export function deriveMobileNav(
  areas: readonly AreaDefinition[],
): MobileNavItemDefinition[] {
  return areas.map(({ id, label, icon, to }) => ({
    id,
    label: label(),
    icon,
    to,
  }));
}
