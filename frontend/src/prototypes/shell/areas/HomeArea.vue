<!-- PROTOTYPE — remove. Fake Home overview page: Recent, Upcoming. -->
<template>
  <PageHeader>
    <div class="text-xl font-semibold text-ink-gray-9">Home</div>
    <NewMenu />
  </PageHeader>

  <div class="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-6">
    <!-- Join with code stays on the page: it is the one create-adjacent action
         the New menu does not carry, because it opens someone else's meeting. -->
    <div class="flex flex-wrap items-center gap-2">
      <Button label="Join with code" icon-left="lucide-arrow-right" variant="outline" size="md" />
    </div>

    <!-- Recent -->
    <section>
      <div class="flex items-center justify-between pb-3">
        <h2 class="text-lg font-medium text-ink-gray-9">Recent</h2>
        <Button label="View all" variant="ghost" />
      </div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          v-for="doc in RECENT_DOCS"
          :key="doc.id"
          class="flex flex-col items-start gap-3 rounded-5 border border-outline-gray-1 bg-surface-base p-3 text-left hover:bg-surface-gray-1"
        >
          <span
            class="flex size-8 items-center justify-center rounded-4 bg-surface-gray-2"
          >
            <span
              class="size-4 text-ink-gray-7"
              :class="DOC_KIND_META[doc.kind].icon"
              aria-hidden="true"
            />
          </span>
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
        <Button label="View all" variant="ghost" />
      </div>
      <!-- One row per event: day and time share a cell so nothing stacks. -->
      <List :columns="['11rem', 'minmax(0,1fr)', '5rem']" :row-height="40">
        <ListRows :items="UPCOMING_EVENTS" row-key="id">
          <template #default="{ item: event }">
            <ListRow :value="event.id" @click="() => {}">
              <ListCell>
                <span class="truncate text-base text-ink-gray-5">
                  {{ event.day }} · {{ event.time }}
                </span>
              </ListCell>
              <ListCell>
                <span class="truncate text-base text-ink-gray-8">{{ event.title }}</span>
              </ListCell>
              <ListCell>
                <Button
                  v-if="event.meet"
                  label="Join"
                  icon-left="lucide-video"
                  variant="outline"
                />
              </ListCell>
            </ListRow>
          </template>
        </ListRows>
      </List>
    </section>
  </div>
</template>

<script setup lang="ts">
import { Button, PageHeader } from 'frappe-ui'
import { List, ListCell, ListRow, ListRows } from 'frappe-ui/list'

import { DOC_KIND_META, RECENT_DOCS, UPCOMING_EVENTS } from '../fixtures'
import NewMenu from '../parts/NewMenu.vue'
</script>
