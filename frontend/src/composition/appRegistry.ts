import { computed, type Ref } from 'vue'
import { useRoute } from 'vue-router'

import { calendarArea } from '@/apps/calendar'
import { driveUploadProgress, filesArea } from '@/apps/drive'
import { mailArea, useInboxSummary } from '@/apps/mail'
import { meetArea } from '@/apps/meet'
import { peopleArea } from '@/apps/people'
import { homeArea } from '@/composition/home'
import type { AreaDefinition } from '@/platform/contracts'
import { hasCapabilities, useSession, type Session } from '@/platform/session'
import type { AreaProgressSource } from '@/shell/areaProgress'

/**
 * Every area, in rail order. The rail, the phone nav and the palette's `>`
 * switcher list all of them: an area whose capability the site lacks (Mail
 * and Calendar without a mail account) still has a place, and opening it
 * shows what it needs (`UnavailableSurface`) instead of hiding the product.
 */
export const areaDefinitions: readonly AreaDefinition[] = [
  homeArea,
  filesArea,
  mailArea,
  calendarArea,
  meetArea,
  peopleArea,
]

export function findArea(id: string): AreaDefinition | undefined {
  return areaDefinitions.find((area) => area.id === id)
}

export interface AppRegistry {
  areas: readonly AreaDefinition[]
  badges: Readonly<Ref<Readonly<Record<string, number>>>>
}

export function useAppRegistry(session: Session = useSession()): AppRegistry {
  const inbox = useInboxSummary(() => session.capabilities.value.jmap)

  return {
    areas: areaDefinitions,
    badges: computed(() => deriveAreaBadges(inbox.data)),
  }
}

export interface AreaWork {
  /** What the rail and the phone nav draw for each area. */
  progress: AreaProgressSource
  /** Drive's upload tracker shows in the Drive area while the queue has work (spec §6.3). */
  showUploadTracker: Readonly<Ref<boolean>>
}

/**
 * The background work each area runs. Drive's upload queue is the one source
 * (spec §6.3). Call it once in the app root's setup: App.vue provides
 * `progress` under `AREA_PROGRESS_KEY` and mounts the tracker.
 */
export function useAreaWork(): AreaWork {
  const drive = driveUploadProgress()
  const route = useRoute()
  return {
    progress: {
      progress: (area) => (area === filesArea.id ? drive.current : null),
      open: (area) => {
        if (area === filesArea.id) drive.open()
      },
    },
    showUploadTracker: computed(() => drive.busy && route.meta.area === filesArea.id),
  }
}

export function deriveAreaBadges(
  inbox: { unread: number } | undefined,
): Readonly<Record<string, number>> {
  return { mail: Math.max(0, inbox?.unread ?? 0) }
}

export function areaIsAvailable(area: AreaDefinition, session: Session = useSession()): boolean {
  return hasCapabilities(area.requires, session)
}
