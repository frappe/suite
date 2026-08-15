<!-- PROTOTYPE — remove. Fake Home overview page: create row, Recent, Upcoming. -->
<template>
  <PageHeader>
    <div class="text-xl font-semibold text-ink-gray-9">Home</div>
    <NewMenu />
  </PageHeader>

  <div class="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-6">
    <!-- Create row -->
    <div class="flex flex-wrap items-center gap-2">
      <Button label="New document" icon-left="lucide-file-text" variant="outline" size="md" />
      <Button label="New spreadsheet" icon-left="lucide-table" variant="outline" size="md" />
      <Button label="New presentation" icon-left="lucide-presentation" variant="outline" size="md" />
      <Button label="New meeting" icon-left="lucide-video" variant="outline" size="md" />
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
              class="size-4"
              :class="[DOC_KIND_META[doc.kind].icon, DOC_KIND_META[doc.kind].tint]"
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
      <div class="flex flex-col rounded-5 border border-outline-gray-1">
        <div
          v-for="(event, i) in UPCOMING_EVENTS"
          :key="event.id"
          class="flex items-center gap-4 px-4 py-3"
          :class="i > 0 ? 'border-t border-outline-gray-1' : ''"
        >
          <div class="flex w-24 shrink-0 flex-col">
            <span class="text-sm font-medium text-ink-gray-8">{{ event.day }}</span>
            <span class="text-xs text-ink-gray-5">{{ event.time }}</span>
          </div>
          <span class="min-w-0 flex-1 truncate text-base text-ink-gray-8">
            {{ event.title }}
          </span>
          <Button
            v-if="event.meet"
            label="Join"
            icon-left="lucide-video"
            variant="outline"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { Button, PageHeader } from 'frappe-ui'

import { DOC_KIND_META, RECENT_DOCS, UPCOMING_EVENTS } from '../fixtures'
import NewMenu from '../parts/NewMenu.vue'
</script>
