<template>
  <div class="flex h-full min-h-0 flex-col">
    <PageHeader v-if="!isMobile">
      <div class="flex w-full items-center justify-between gap-3">
        <PageHeaderTitle :title="__('Home')" />
        <Dropdown :options="newMenuItems" align="end">
          <Button
            :loading="createDocumentMutation.isPending"
            :label="__('New')"
            icon-right="lucide-chevron-down"
            variant="subtle"
          />
        </Dropdown>
      </div>
    </PageHeader>
    <PageHeaderMobile v-else :title="__('Home')">
      <template #suffix>
        <Dropdown :options="newMenuItems" align="end">
          <Button
            :loading="createDocumentMutation.isPending"
            :label="__('New')"
            icon-right="lucide-chevron-down"
            variant="subtle"
          />
        </Dropdown>
      </template>
    </PageHeaderMobile>

    <ScrollArea ref="home-scroll" class="min-h-0 flex-1">
      <div class="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-6">
        <GetStarted />
        <section v-if="createDocumentMutation.canCreate" aria-labelledby="home-new-heading">
          <h2 id="home-new-heading" class="pb-3 text-lg font-medium text-ink-gray-9">
            {{ __('New') }}
          </h2>
          <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <button
              v-for="definition in documentTypes"
              :key="definition.contentDoctype"
              type="button"
              class="flex h-10 min-w-0 items-center gap-2 rounded-5 border border-outline-gray-1 bg-surface-elevation-1 px-3 text-start transition-colors hover:border-outline-gray-2 hover:bg-surface-gray-1 focus-visible:focus-ring aria-disabled:cursor-default dark:hover:bg-surface-elevation-2"
              :aria-busy="creatingType === definition.contentDoctype"
              :aria-disabled="createDocumentMutation.isPending"
              @click="createFromCard(definition.contentDoctype)"
            >
              <span
                class="size-4.5 shrink-0"
                :class="driveDocumentIcon(definition.contentDoctype)"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 truncate text-base font-medium text-ink-gray-8">
                {{ definition.newLabel() }}
              </span>
              <Spinner
                v-if="creatingType === definition.contentDoctype"
                class="size-4 shrink-0 text-ink-gray-5"
              />
            </button>
          </div>
        </section>
        <section aria-labelledby="home-recent-heading">
          <div class="flex items-center justify-between pb-3">
            <h2 id="home-recent-heading" class="text-lg font-medium text-ink-gray-9">
              {{ __('Recent') }}
            </h2>
            <Button :label="__('View all')" route="/drive/recent" variant="ghost" />
          </div>

          <div
            v-if="recentQuery.status === 'pending' && !recentRows.length"
            class="grid grid-cols-2 gap-3 lg:grid-cols-4"
            aria-label="Loading recent documents"
          >
            <div
              v-for="index in 4"
              :key="index"
              class="flex aspect-[1.7] flex-col justify-between rounded-5 border border-outline-gray-1 bg-surface-elevation-1 p-3"
            >
              <Skeleton class="size-4.5" />
              <span>
                <Skeleton class="mb-2 h-4 w-4/5" />
                <Skeleton class="h-3 w-2/5" />
              </span>
            </div>
          </div>
          <div
            v-else-if="recentQuery.status === 'error' && !recentRows.length"
            class="flex items-center justify-between rounded-5 border border-outline-gray-1 px-3 py-4"
            data-testid="recent-error"
          >
            <p class="text-p-sm text-ink-red-7">
              {{ recentQuery.error?.message || __('Could not load recent files.') }}
            </p>
            <Button :label="__('Retry')" variant="ghost" @click="recentQuery.refetch()" />
          </div>
          <div
            v-else-if="!recentRows.length"
            class="flex items-center justify-between rounded-5 border border-outline-gray-1 px-3 py-4"
          >
            <p class="text-p-sm text-ink-gray-5">{{ __('Nothing yet') }}</p>
            <Dropdown :options="newMenuItems" align="end">
              <Button :label="__('New')" icon-left="lucide-plus" variant="ghost" />
            </Dropdown>
          </div>
          <div v-else class="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="recent-rows">
            <DriveFileCard
              v-for="node in recentRows"
              :key="node.name"
              :as="RouterLink"
              :to="driveNodeRoute(node)"
              :node="node"
              :meta="formatDriveListingDate(node.opened_at ?? null, homeNow)"
              @preview-error="recentQuery.refetch()"
            />
          </div>
          <div
            v-if="recentQuery.status === 'error' && recentRows.length"
            class="mt-3 flex items-center justify-between rounded-4 bg-surface-red-2 px-3 py-2"
          >
            <p class="text-p-sm text-ink-red-7">
              {{ __('Recent files could not be refreshed.') }}
            </p>
            <Button
              :label="__('Retry')"
              variant="ghost"
              theme="red"
              @click="recentQuery.refetch()"
            />
          </div>
        </section>

        <section aria-labelledby="home-upcoming-heading">
          <div class="flex flex-wrap items-center justify-between gap-2 pb-3">
            <h2 id="home-upcoming-heading" class="text-lg font-medium text-ink-gray-9">
              {{ __('Upcoming') }}
            </h2>
            <div class="flex items-center gap-1">
              <Dropdown :options="meetMenuItems" align="end">
                <Button
                  :loading="createRoomMutation.isPending"
                  :label="__('Meet')"
                  icon-right="lucide-chevron-down"
                  variant="ghost"
                />
              </Dropdown>
              <Dropdown :options="scheduleMenuItems" align="end">
                <Button :label="__('Schedule')" icon-right="lucide-chevron-down" variant="ghost" />
              </Dropdown>
              <Button :label="__('View all')" route="/calendar" variant="ghost" />
            </div>
          </div>

          <div
            v-if="upcomingQuery.status === 'pending' && cachedUpcomingEvents == null"
            class="overflow-hidden rounded-7 border border-outline-gray-1 bg-surface-gray-1"
            :aria-label="__('Loading upcoming events')"
            role="status"
          >
            <div
              v-for="index in 3"
              :key="index"
              class="flex min-h-[66px] items-center gap-2.5 border-outline-gray-1 px-2.5 py-2.5 [&:not(:last-child)]:border-b"
              aria-hidden="true"
            >
              <div
                class="size-11 shrink-0 rounded-6 border border-outline-gray-1 bg-surface-base"
              />
              <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton class="h-4 w-40 max-w-full" />
                <Skeleton class="h-3 w-32 max-w-full" />
              </div>
            </div>
          </div>
          <div
            v-else-if="upcomingQuery.status === 'error' && !upcomingEvents.length"
            class="flex items-center justify-between rounded-5 border border-outline-gray-1 px-3 py-4"
            data-testid="upcoming-error"
          >
            <p class="text-p-sm text-ink-red-7">
              {{ upcomingQuery.error?.message || __('Could not load upcoming events.') }}
            </p>
            <Button :label="__('Retry')" variant="ghost" @click="upcomingQuery.refetch()" />
          </div>
          <p
            v-else-if="!upcomingRows.length"
            class="rounded-5 border border-outline-gray-1 px-3 py-8 text-center text-p-sm text-ink-gray-5"
            data-testid="upcoming-empty"
          >
            {{ __('Nothing scheduled. Your meetings and events show here.') }}
          </p>
          <UpcomingEventList
            v-else
            :events="upcomingRows"
            :current-user="session.user.value?.id"
            data-testid="upcoming-rows"
          />
          <div
            v-if="upcomingQuery.status === 'error' && upcomingEvents.length"
            class="mt-3 flex items-center justify-between rounded-4 bg-surface-red-2 px-3 py-2"
          >
            <p class="text-p-sm text-ink-red-7">
              {{ __('Upcoming events could not be refreshed.') }}
            </p>
            <Button
              :label="__('Retry')"
              variant="ghost"
              theme="red"
              @click="upcomingQuery.refetch()"
            />
          </div>
        </section>
      </div>
    </ScrollArea>

    <ScheduleMeetingDialog ref="schedule-dialog" @scheduled="upcomingQuery.refetch()" />
  </div>
</template>

<script setup lang="ts">
import { useNow } from '@vueuse/core'
import {
  Button,
  PageHeader,
  PageHeaderMobile,
  PageHeaderTitle,
  ScrollArea,
  Skeleton,
  Spinner,
} from 'frappe-ui'
import { computed, ref, useTemplateRef } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import { api, useMutation, useQuery } from '@/api'
import {
  UpcomingEventList,
  useUpcomingEvents,
  type CalendarEvent,
  type UpcomingEventRow,
} from '@/apps/calendar'
import {
  driveDocumentIcon,
  DriveFileCard,
  driveNodeRoute,
  formatDriveListingDate,
  newDocumentRoute,
  useDriveDocumentCreation,
  useDrivePreviewRefresh,
} from '@/apps/drive'
import { ScheduleMeetingDialog } from '@/apps/meet'
import { documentTypes } from '@/composition/documentRegistry'
import GetStarted from '@/composition/home/GetStarted.vue'
import { formatEventTime, groupHomeEvents, homeEventWindow } from '@/composition/home/homeTime'
import { Dropdown } from '@/platform/feedback'
import { useRestoredScroll } from '@/platform/scroll-restoration'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import { isMobile } from '@/shell/useIsMobile'

const router = useRouter()
const session = useSession()
const scrollArea = useTemplateRef<InstanceType<typeof ScrollArea>>('home-scroll')
useRestoredScroll(() => scrollArea.value?.viewportElement)
const homeNow = new Date()
const upcomingNow = useNow({ interval: 30_000 })
const eventWindow = computed(() => homeEventWindow(upcomingNow.value))
// Recent shows documents and files, not folders. Recents has no kind filter,
// so ask for more than the grid holds and keep the first non-folders.
const RECENT_CARDS = 12
const recentQuery = useQuery(api.drive.views.list, {
  view: 'recents',
  limit: RECENT_CARDS * 4,
  expand: 'preview',
})
// Thumbnail URLs are signed and expire, so Recent refetches them as Drive's grid does.
useDrivePreviewRefresh(
  () => recentQuery.refetch(),
  () => recentRows.value,
)
const { query: upcomingQuery, events: cachedUpcomingEvents } = useUpcomingEvents(
  () => eventWindow.value,
)
const createDocumentMutation = useDriveDocumentCreation()
const createRoomMutation = useMutation(api.meet.rooms.create)
const recentRows = computed(() =>
  (recentQuery.data?.rows ?? [])
    .filter((node) => 'kind' in node)
    .filter((node) => node.kind !== 'folder')
    .slice(0, RECENT_CARDS),
)
const upcomingEvents = computed(() => cachedUpcomingEvents.value ?? [])
const upcomingRows = computed(() =>
  groupHomeEvents(upcomingEvents.value, upcomingNow.value)
    .flatMap((group) =>
      group.events.map((event) => {
        const start = new Date(event.start ?? '')
        const title = event.title || __('Untitled event')
        return {
          id: eventKey(event),
          title,
          month: start.toLocaleDateString(undefined, { month: 'short' }),
          day: String(start.getDate()),
          time: formatEventTime(event),
          actionLabel: event.conferencing ? __('Join {0}', [title]) : __('Open {0}', [title]),
          route: event.conferencing ? meetRoute(event.conferencing.meeting_id) : '/calendar',
          participants: eventParticipants(event),
        }
      }),
    )
    .slice(0, 3),
)

const scheduleDialog = useTemplateRef<InstanceType<typeof ScheduleMeetingDialog>>('schedule-dialog')
const newMenuItems = documentTypes.map((definition) => ({
  label: definition.newLabel(),
  icon: definition.icon,
  onClick: () => createDocument(definition.contentDoctype),
}))
const meetMenuItems = [
  {
    label: __('Start meeting'),
    icon: 'lucide-zap',
    onClick: () => startMeeting('open'),
  },
  {
    label: __('Start private meeting'),
    icon: 'lucide-lock',
    onClick: () => startMeeting('restricted'),
  },
]
const scheduleMenuItems = [
  {
    label: __('Event'),
    icon: 'lucide-calendar-plus',
    onClick: () => router.push('/calendar'),
  },
  {
    label: __('Meeting'),
    icon: 'lucide-video',
    onClick: () => scheduleDialog.value?.show(),
  },
]
async function createDocument(contentDoctype: string) {
  // Loaded alongside the request, so the new document takes typing as soon as it opens.
  void documentTypes.find((type) => type.contentDoctype === contentDoctype)?.loadOpeningEditor?.()
  const node = await createDocumentMutation.run({
    content_doctype: contentDoctype,
  })
  if (node) {
    await router.push(newDocumentRoute(node))
  }
}
const creatingType = ref<string | null>(null)
/** A card creates as the New menu does; a second click while one is created does nothing. */
async function createFromCard(contentDoctype: string) {
  if (creatingType.value || createDocumentMutation.isPending) return
  creatingType.value = contentDoctype
  try {
    await createDocument(contentDoctype)
  } finally {
    creatingType.value = null
  }
}
async function startMeeting(type: 'open' | 'restricted') {
  const room = await createRoomMutation.run({
    type,
  })
  if (room) await router.push(meetRoute(room.code))
}
function meetRoute(code: string): string {
  return `/meet/${encodeURIComponent(code)}`
}
function eventKey(event: CalendarEvent): string {
  return String(event.id ?? event.name ?? event.uid ?? `${event.start}-${event.title}`)
}

function eventParticipants(event: CalendarEvent) {
  const participants: NonNullable<UpcomingEventRow['participants']>[number][] = []
  for (const participant of event.participants || []) {
    if (
      !participant ||
      typeof participant !== 'object' ||
      !('email' in participant) ||
      typeof participant.email !== 'string' ||
      !participant.email
    )
      continue
    participants.push({
      email: participant.email,
      name:
        '_name' in participant && typeof participant._name === 'string' && participant._name
          ? participant._name
          : participant.email,
      image:
        'user_image' in participant && typeof participant.user_image === 'string'
          ? participant.user_image
          : undefined,
    })
  }
  return participants
}
</script>
