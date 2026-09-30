import { computed, type Ref } from "vue";
import { useRoute } from "vue-router";

import { calendarArea } from "@/apps/calendar";
import { driveUploadProgress, filesArea } from "@/apps/drive";
import { mailArea, useInboxSummary } from "@/apps/mail";
import { meetArea } from "@/apps/meet";
import { homeArea } from "@/composition/home";
import { type BootFlag, readBootFlag } from "@/platform/boot";
import type { AreaDefinition, PlatformCapability } from "@/platform/contracts";
import { hasCapabilities, type Session, useSession } from "@/platform/session";
import type { AreaProgressSource } from "@/shell/areaProgress";

/** Each area in rail order, with the flip that puts it on the rail [T014, T018]. */
const areaRollout: readonly (readonly [AreaDefinition, BootFlag])[] = [
  [homeArea, "suite_flip_files"],
  [filesArea, "suite_flip_files"],
  [mailArea, "suite_flip_shell"],
  [calendarArea, "suite_flip_shell"],
  [meetArea, "suite_flip_shell"],
];

const areaFlip = new Map(areaRollout);

export const areaDefinitions: readonly AreaDefinition[] = areaRollout.map(
  ([area]) => area,
);

export type FlipState = Readonly<Record<BootFlag, boolean>>;

/**
 * The areas the rail and the phone nav list: those whose flip is on and whose
 * capabilities the session has. Keeps rail order.
 */
export function filterAreas(
  areas: readonly AreaDefinition[],
  capabilities: Record<PlatformCapability, boolean>,
  flips: FlipState,
): AreaDefinition[] {
  return areas.filter((area) => {
    const flip = areaFlip.get(area);
    return (
      (!flip || flips[flip]) &&
      (area.requires ?? []).every((capability) => capabilities[capability])
    );
  });
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
  // Read from boot once: a key change applies on the next page load [T014].
  const flips: FlipState = {
    suite_flip_shell: readBootFlag("suite_flip_shell"),
    suite_flip_files: readBootFlag("suite_flip_files"),
  };

  return {
    allAreas: areaDefinitions,
    areas: computed(() =>
      filterAreas(areaDefinitions, session.capabilities.value, flips),
    ),
    badges: computed(() => deriveAreaBadges(inbox.data)),
  };
}

export interface AreaWork {
  /** What the rail and the phone nav draw for each area. */
  progress: AreaProgressSource;
  /** Drive's upload tracker shows in the Drive area while the queue has work (spec §6.3). */
  showUploadTracker: Readonly<Ref<boolean>>;
}

/**
 * The background work each area runs. Drive's upload queue is the one source
 * (spec §6.3). Call it once in the app root's setup: App.vue provides
 * `progress` under `AREA_PROGRESS_KEY` and mounts the tracker.
 */
export function useAreaWork(): AreaWork {
  const drive = driveUploadProgress();
  const route = useRoute();
  return {
    progress: {
      progress: (area) => (area === filesArea.id ? drive.current : null),
      open: (area) => {
        if (area === filesArea.id) drive.open();
      },
    },
    showUploadTracker: computed(
      () => drive.busy && route.meta.area === filesArea.id,
    ),
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
