<!--
  What the tab strip's + opens: pick the app the new tab should start in.

  It is deliberately not the ⌘K palette. That one searches everything you
  have and jumps the tab you are standing in; this one does one thing, to one
  new tab, so it lists apps and nothing else.

  No search field. Eight rows all fit on screen at once, so a box to narrow
  them would cost a keystroke and a focus trap to save nothing — ⌘K is where
  searching belongs. What replaces it is the ordinary Frappe dialog opening:
  a title and a close.

  Keyboard still works without being advertised: arrows move, Enter opens,
  Esc closes.
-->
<template>
  <Dialog v-model:open="open" size="lg" position="top" bare>
    <div class="flex flex-col p-5">
      <div class="flex items-start justify-between gap-4">
        <h2 class="text-2xl font-semibold text-ink-gray-9">New tab</h2>
        <Button variant="ghost" icon="lucide-x" aria-label="Close" @click="open = false" />
      </div>

      <!-- Tall enough for the whole app list, so it never opens on a half-cut
           row. It still scrolls if the list grows. -->
      <div class="-mx-1 mt-3 max-h-[25rem] overflow-y-auto px-1">
        <button
          v-for="(app, index) in ALL_APPS"
          :key="app.id"
          :ref="(el) => setRowRef(el, index)"
          type="button"
          class="flex h-12 w-full items-center gap-3 rounded-5 px-2 text-left transition-colors"
          :class="index === active ? 'bg-surface-gray-2' : 'hover:bg-surface-gray-1'"
          @click="choose(app)"
          @mousemove="active = index"
        >
          <!-- The tile lifts to white on the active row, so the row reads as
               picked from the keyboard rather than merely hovered. -->
          <span
            class="grid size-8 shrink-0 place-items-center rounded-3 transition-colors"
            :class="index === active ? 'bg-surface-base shadow-sm' : 'bg-surface-gray-2'"
          >
            <span :class="[app.icon, 'size-4 text-ink-gray-7']" aria-hidden="true" />
          </span>
          <span class="min-w-0 flex-1 truncate text-base text-ink-gray-8">{{ app.label }}</span>
          <span
            v-if="index === active"
            class="lucide-arrow-right size-4 shrink-0 text-ink-gray-5"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Button, Dialog } from 'frappe-ui'
import { useEventListener } from '@vueuse/core'

import { ALL_APPS, type SuiteApp } from '../fixtures'
import { newTabOpen as open, useTabRouting } from '../useTabs'

const { openInNewTab } = useTabRouting()

const active = ref(0)
const rowRefs = ref<HTMLElement[]>([])

function setRowRef(el: unknown, index: number) {
  if (el) rowRefs.value[index] = el as HTMLElement
}

function choose(app: SuiteApp) {
  openInNewTab(app.id)
  open.value = false
}

function step(delta: number) {
  const count = ALL_APPS.length
  active.value = (active.value + delta + count) % count
  nextTick(() => rowRefs.value[active.value]?.scrollIntoView({ block: 'nearest' }))
}

// Bound to the window rather than a field: with no input to hold focus, the
// arrows have nowhere else to be listened for.
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (!open.value) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    step(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    step(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    choose(ALL_APPS[active.value])
  }
})

watch(open, (isOpen) => {
  if (!isOpen) return
  active.value = 0
  rowRefs.value = []
})
</script>
