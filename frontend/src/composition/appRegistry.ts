import { computed, type Ref } from 'vue'
import { useRoute } from 'vue-router'

import { calendarArea, useUpcomingSummary } from '@/apps/calendar'
import { driveUploadProgress, filesArea } from '@/apps/drive'
import { mailArea, useInboxSummary, type InboxSummary } from '@/apps/mail'
import { meetArea } from '@/apps/meet'
import { peopleArea } from '@/apps/people'
import { adminArea } from '@/composition/admin'
import { homeArea } from '@/composition/home'
import type { AreaBadge, AreaDefinition } from '@/platform/contracts'
import { hasCapabilities, useSession, type Session } from '@/platform/session'
import type { AreaProgressSource } from '@/shell/areaProgress'

/**
 * Every area, in rail order. Launch surfaces list only available areas
 * (spec §3.2); direct URLs still resolve here to show what an area needs.
 */
export const areaDefinitions: readonly AreaDefinition[] = [
  homeArea,
  filesArea,
  mailArea,
  calendarArea,
  meetArea,
  peopleArea,
  adminArea,
]

export function findArea(id: string): AreaDefinition | undefined {
  return areaDefinitions.find((area) => area.id === id)
}

export interface AppRegistry {
  areas: readonly AreaDefinition[]
  badges: Readonly<Ref<AreaBadges>>
}

export function useAppRegistry(session: Session = useSession()): AppRegistry {
  const inbox = useInboxSummary(() => session.capabilities.value.jmap)
  const upcoming = useUpcomingSummary(() => session.capabilities.value.jmap)

  return {
    get areas() {
      return areaDefinitions.filter((area) => areaIsAvailable(area, session))
    },
    badges: computed(() => deriveAreaBadges(inbox.data, upcoming.data)),
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

interface AreaBadges {
  readonly mail: AreaBadge
  readonly calendar: AreaBadge
  readonly [area: string]: AreaBadge | undefined
}

/**
 * Mail's badge counts every account's unread Inbox. It is quiet while none of that is in the
 * reader's own account: mail to a shared account is someone's to read, not theirs alone. With more
 * than one account, it says which accounts the count is in.
 */
export function deriveAreaBadges(
  inbox: InboxSummary | undefined,
  upcoming?: { upcoming: number },
): AreaBadges {
  const unread = Math.max(0, inbox?.unread ?? 0)
  const accounts = inbox?.accounts ?? []
  const waiting = accounts.filter((account) => account.unread > 0)
  return {
    mail: {
      count: unread,
      quiet: unread > 0 && !waiting.some((account) => account.personal),
      parts:
        accounts.length > 1
          ? waiting.map((account) => ({ label: account.name, count: account.unread }))
          : undefined,
    },
    calendar: { count: Math.max(0, upcoming?.upcoming ?? 0), quiet: false },
  }
}

export function areaIsAvailable(area: AreaDefinition, session: Session = useSession()): boolean {
  return hasCapabilities(area.requires, session)
}
