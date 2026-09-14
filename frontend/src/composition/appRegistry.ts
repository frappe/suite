import { computed, type Ref } from "vue";

import { calendarArea } from "@/apps/calendar";
import { filesArea } from "@/apps/drive";
import { mailArea, useInboxSummary } from "@/apps/mail";
import { homeArea } from "@/composition/home";
import type { AreaDefinition, PlatformCapability } from "@/platform/contracts";
import { hasCapabilities, type Session, useSession } from "@/platform/session";

export const areaDefinitions: readonly AreaDefinition[] = [
  homeArea,
  filesArea,
  mailArea,
  calendarArea,
];

export function filterAreas(
  areas: readonly AreaDefinition[],
  capabilities: Record<PlatformCapability, boolean>,
): AreaDefinition[] {
  return areas.filter((area) =>
    (area.requires ?? []).every((capability) => capabilities[capability]),
  );
}

export function findArea(id: string): AreaDefinition | undefined {
  return areaDefinitions.find((area) => area.id === id);
}

export interface AppRegistry {
  allAreas: readonly AreaDefinition[];
  areas: Readonly<Ref<AreaDefinition[]>>;
  badges: Readonly<Ref<Readonly<Record<string, number>>>>;
}

export function useAppRegistry(session: Session = useSession()): AppRegistry {
  const inbox = useInboxSummary(() => session.capabilities.value.jmap);

  return {
    allAreas: areaDefinitions,
    areas: computed(() =>
      filterAreas(areaDefinitions, session.capabilities.value),
    ),
    badges: computed(() => deriveAreaBadges(inbox.data)),
  };
}

export function deriveAreaBadges(
  inbox: { unread: number } | undefined,
): Readonly<Record<string, number>> {
  return { mail: Math.max(0, inbox?.unread ?? 0) };
}

export function areaIsAvailable(
  area: AreaDefinition,
  session: Session = useSession(),
): boolean {
  return hasCapabilities(area.requires, session);
}
