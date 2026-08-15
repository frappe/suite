<!-- PROTOTYPE — remove. Fake Home overview page: Recent, Upcoming. -->
<template>
  <PageHeader>
    <div class="text-xl font-semibold text-ink-gray-9">Home</div>
    <div class="flex items-center gap-2">
      <SearchTrigger />
      <NewMenu />
    </div>
  </PageHeader>

  <div class="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-6">
    <!-- Recent -->
    <section>
      <div class="flex items-center justify-between pb-3">
        <h2 class="text-lg font-medium text-ink-gray-9">Recent</h2>
        <Button label="View all" variant="ghost" :route="areaTo('files')" />
      </div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          v-for="doc in RECENT_DOCS"
          :key="doc.id"
          class="flex flex-col items-start gap-3 rounded-5 border border-outline-gray-1 bg-surface-base p-3 text-left hover:bg-surface-gray-1"
        >
          <!-- No tile behind the icon: the kind already reads from its colour,
               so the grey box was carrying nothing. -->
          <span
            class="size-4.5"
            :class="[DOC_KIND_META[doc.kind].icon, DOC_KIND_META[doc.kind].tint]"
            aria-hidden="true"
          />
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="w-full truncate text-base font-medium text-ink-gray-8">
              {{ doc.name }}
            </span>
            <span class="text-xs text-ink-gray-5">{{ doc.opened }}</span>
          </span>
        </button>
      </div>
    </section>

    <!-- Upcoming -->
    <section>
      <div class="flex items-center justify-between pb-3">
        <h2 class="text-lg font-medium text-ink-gray-9">Upcoming</h2>
        <div class="flex items-center gap-1">
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
import { List, ListCell, ListGroup, ListRow } from 'frappe-ui/list'

import { DOC_KIND_META, RECENT_DOCS, UPCOMING_EVENTS } from '../fixtures'
import NewMenu from '../parts/NewMenu.vue'
import SearchTrigger from '../parts/SearchTrigger.vue'
import { useShellNav } from '../useShellNav'

const { areaTo } = useShellNav()

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
