<!-- PROTOTYPE — remove. Fake Home overview page: Recent, Upcoming. -->
<template>
  <PageHeader>
    <div class="text-xl font-semibold text-ink-gray-9">Home</div>
    <NewMenu />
  </PageHeader>

  <div class="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-6">
    <!-- Recent -->
    <section>
      <div class="flex items-center justify-between pb-3">
        <h2 class="text-lg font-medium text-ink-gray-9">Recent</h2>
        <Button label="View all" variant="ghost" :route="areaTo('files')" />
      </div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <!-- Rows that open something are links, so the whole card is a real
             navigation target; the rest stay inert buttons. -->
        <component
          :is="recentTo(doc) ? RouterLink : 'button'"
          v-for="doc in RECENT_DOCS"
          :key="doc.id"
          :to="recentTo(doc)"
          class="flex flex-col items-start gap-3 rounded-5 border border-outline-gray-1 bg-surface-base p-3 text-left hover:bg-surface-gray-1"
        >
          <!-- No tile behind the icon: the kind already reads from its colour,
               so the grey box was carrying nothing. -->
          <span
            class="size-4.5"
            :class="[DOC_KIND_META[doc.kind].icon, DOC_KIND_META[doc.kind].tint]"
            aria-hidden="true"
          />
          <!-- The card aligns its children to the start, so this block has to
               claim the full width itself before truncate has an edge to cut at. -->
          <span class="flex w-full min-w-0 flex-col gap-0.5">
            <span class="w-full truncate text-base font-medium text-ink-gray-8">
              {{ doc.name }}
            </span>
            <span class="text-xs text-ink-gray-5">{{ doc.opened }}</span>
          </span>
        </component>
      </div>
    </section>

    <!-- Upcoming -->
    <section>
      <div class="flex items-center justify-between pb-3">
        <h2 class="text-lg font-medium text-ink-gray-9">Upcoming</h2>
        <div class="flex items-center gap-1">
          <!-- Rooms are standing links, not scheduled items, so they hang off
               this header instead of holding a section of their own. -->
          <Dropdown :options="ROOM_MENU_ITEMS" align="end">
            <Button label="Rooms" icon-right="lucide-chevron-down" variant="ghost" />
          </Dropdown>
          <Dropdown :options="SCHEDULE_MENU_ITEMS" align="end">
            <Button label="Schedule" icon-right="lucide-chevron-down" variant="ghost" />
          </Dropdown>
          <Button label="View all" variant="ghost" :route="areaTo('calendar')" />
        </div>
      </div>
      <!-- One row per event, grouped by day. The day lives in the group
           header, so each row carries only its time.
           The rows keep their 12px hover inset, so the list is pulled out by
           the same amount: row content then lines up with the section title
           and the links above it, not 12px inside them. -->
      <List
        class="-mx-3 list-row-px-3"
        :columns="['7rem', 'minmax(0,1fr)', '5rem']"
        :row-height="40"
      >
        <ListGroup v-for="group in eventsByDay" :key="group.day" :label="group.day">
          <ListRow
            v-for="event in group.events"
            :key="event.id"
            :value="event.id"
            @click="() => {}"
          >
            <ListCell>
              <span class="truncate text-base text-ink-gray-5">{{ event.time }}</span>
            </ListCell>
            <ListCell>
              <span class="truncate text-base text-ink-gray-8">{{ event.title }}</span>
            </ListCell>
            <ListCell class="justify-end">
              <Button
                v-if="event.meet"
                label="Join"
                icon-left="lucide-video"
                variant="outline"
                :route="meetTo(event.meet)"
                @click.stop
              />
            </ListCell>
          </ListRow>
        </ListGroup>
      </List>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button, Dropdown, PageHeader } from 'frappe-ui'
import { RouterLink, useRouter } from 'vue-router'
import { List, ListCell, ListGroup, ListRow } from 'frappe-ui/list'

import {
  DOC_KIND_META,
  MEETING_ROOMS,
  meetTo,
  pdfRef,
  RECENT_DOCS,
  UPCOMING_EVENTS,
  type RecentDoc,
} from '../fixtures'
import NewMenu from '../parts/NewMenu.vue'
import { useShellNav } from '../useShellNav'

const router = useRouter()
const { areaTo, docTo } = useShellNav()

// A PDF has no editor behind it, so it opens the shell's own preview. Cards
// with neither stay inert.
function recentTo(doc: RecentDoc) {
  if (doc.kind === 'pdf') return docTo(pdfRef(doc.name))
  return doc.doc ? docTo(doc.doc) : undefined
}

// One click joins. The handle rides along as the description because the URL
// is the part worth remembering; the cadence says when the room is busy.
const ROOM_MENU_ITEMS = [
  {
    group: 'Rooms',
    hideLabel: true,
    options: MEETING_ROOMS.map((room) => ({
      label: room.name,
      description: [room.handle, room.cadence].filter(Boolean).join(' · '),
      icon: 'lucide-video',
      onClick: () => router.push(meetTo(room.code)),
    })),
  },
  {
    group: 'New',
    hideLabel: true,
    options: [{ label: 'New room', icon: 'lucide-plus', onClick: () => {} }],
  },
]

const SCHEDULE_MENU_ITEMS = [
  { label: 'Event', icon: 'lucide-calendar-plus', onClick: () => {} },
  { label: 'Meeting', icon: 'lucide-video', onClick: () => {} },
]

// Groups in the order the days first appear, so the list stays chronological
// without a second sort.
const eventsByDay = computed(() => {
  const groups: { day: string; events: typeof UPCOMING_EVENTS }[] = []
  for (const event of UPCOMING_EVENTS) {
    const group = groups.find((g) => g.day === event.day)
    if (group) group.events.push(event)
    else groups.push({ day: event.day, events: [event] })
  }
  return groups
})
</script>
