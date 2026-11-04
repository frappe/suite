<!--
  Open apps, as tabs.

  A tab is the pairing an app shell usually throws away: the app you are in
  *and* where you were standing in it. Switching apps in the sidebar focuses
  the tab that app is already open in, so going to Mail and back to Calendar
  returns to the week you were reading, not to today.
-->
<template>
  <div
    class="flex h-12 shrink-0 items-center gap-1 border-b border-outline-gray-1 bg-surface-base pl-1 pr-2"
  >
    <div class="flex shrink-0 items-center">
      <Button
        variant="ghost"
        icon="lucide-chevron-left"
        aria-label="Back"
        @click="router.back()"
      />
      <Button
        variant="ghost"
        icon="lucide-chevron-right"
        aria-label="Forward"
        @click="router.forward()"
      />
    </div>

    <ScrollArea orientation="horizontal" class="min-w-0 flex-1">
      <div class="flex h-10 items-center gap-1">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="group flex h-8 w-36 shrink-0 items-center gap-1 rounded-4 border pl-2.5 pr-1 transition"
          :class="
            tab.id === activeTabId
              ? 'border-outline-gray-2 bg-surface-base shadow-[0_1px_2px_0_rgba(0,0,0,0.07)]'
              : 'border-transparent hover:bg-surface-gray-2'
          "
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2"
            @click="selectTab(tab.id)"
          >
            <span
              :class="[tabMeta(tab).icon, 'size-4 shrink-0 text-ink-gray-6']"
              aria-hidden="true"
            />
            <span
              class="min-w-0 truncate text-left text-base"
              :class="tab.id === activeTabId ? 'text-ink-gray-8' : 'text-ink-gray-6'"
            >
              {{ tabMeta(tab).label }}
            </span>
          </button>
          <!-- The close button holds its slot always, so a tab's label never
               reflows the moment the pointer crosses it. -->
          <Button
            variant="ghost"
            size="sm"
            icon="lucide-x"
            :aria-label="`Close ${tabMeta(tab).label}`"
            class="shrink-0 opacity-0 transition group-hover:opacity-100"
            :class="tab.id === activeTabId && 'opacity-100'"
            @click.stop="closeTab(tab.id)"
          />
        </div>
      </div>
    </ScrollArea>

    <Tooltip content="New tab" placement="bottom">
      <Button
        variant="ghost"
        icon="lucide-plus"
        aria-label="New tab"
        class="shrink-0"
        @click="newTabOpen = true"
      />
    </Tooltip>
  </div>
</template>

<script setup lang="ts">
import { Button, ScrollArea, Tooltip } from 'frappe-ui'
import { useRouter } from 'vue-router'

import { activeTabId, newTabOpen, tabMeta, tabs, useTabRouting } from '../useTabs'

const router = useRouter()
const { selectTab, closeTab } = useTabRouting()
</script>
