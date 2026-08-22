<!--
  PROTOTYPE — remove. Cmd+K palette stub: static grouped fake results, no real
  search. Esc closes (handled by Dialog).
-->
<template>
  <Dialog v-model:open="open" size="xl" position="top" bare>
    <div class="flex flex-col">
      <!-- TextInput, not a bare <input>: the suite's global form styles were
           painting a blue border and their own padding inside the palette. -->
      <div class="border-b border-outline-gray-2">
        <TextInput
          ref="inputEl"
          v-model="query"
          size="lg"
          variant="ghost"
          placeholder="Search or jump to…"
          class="palette-input"
        >
          <template #prefix>
            <span class="lucide-search size-4 text-ink-gray-5" aria-hidden="true" />
          </template>
        </TextInput>
      </div>
      <div class="max-h-96 overflow-y-auto p-2">
        <div v-for="group in GROUPS" :key="group.label" class="pb-1">
          <div class="px-2 py-1.5 text-sm text-ink-gray-5">{{ group.label }}</div>
          <button
            v-for="item in group.items"
            :key="item.label"
            class="flex h-8 w-full items-center gap-2 rounded-4 px-2 text-base text-ink-gray-8 hover:bg-surface-gray-2"
            @click="onItemClick(item)"
          >
            <span class="size-4 shrink-0 text-ink-gray-5" :class="item.icon" aria-hidden="true" />
            <span class="truncate">{{ item.label }}</span>
            <!-- The time sits at the end of the row, so the titles stay in one
                 column with every other item in the palette. -->
            <span v-if="item.meta" class="ml-auto shrink-0 pl-2 text-sm text-ink-gray-5">
              {{ item.meta }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Dialog, TextInput } from 'frappe-ui'

import {
  DOC_KIND_META,
  meetTo,
  RECENT_DOCS,
  UPCOMING_EVENTS,
  type AreaId,
} from './fixtures'
import { commandPaletteOpen as open } from './useCommandPalette'
import { useShellNav } from './useShellNav'

const { go } = useShellNav()
const router = useRouter()
const query = ref('')
// TextInput exposes its native element as `el`.
const inputEl = ref<{ el: HTMLInputElement | null } | null>(null)

interface PaletteItem {
  label: string
  icon: string
  /** Trailing text, right-aligned: a time, not a second label. */
  meta?: string
  area?: AreaId
  /** Path this item opens when it leads somewhere outside the shell. */
  path?: string
}

const GROUPS: { label: string; items: PaletteItem[] }[] = [
  {
    // The next few meetings come first: the palette is the fastest way to a
    // call that has already started, and one keystroke should reach it.
    label: 'Upcoming',
    items: UPCOMING_EVENTS.slice(0, 3).map((event) => ({
      label: event.title,
      icon: event.meet ? 'lucide-video' : 'lucide-calendar',
      meta: `${event.day}, ${event.time.split(' – ')[0]}`,
      path: event.meet ? meetTo(event.meet) : undefined,
      area: event.meet ? undefined : ('calendar' as AreaId),
    })),
  },
  {
    label: 'Jump to',
    items: [
      { label: 'Home', icon: 'lucide-home', area: 'home' },
      { label: 'Files', icon: 'lucide-folder', area: 'files' },
      { label: 'Mail', icon: 'lucide-mail', area: 'mail' },
      { label: 'Calendar', icon: 'lucide-calendar', area: 'calendar' },
    ],
  },
  {
    label: 'Create',
    items: [
      { label: 'Document', icon: 'lucide-file-text' },
      { label: 'Spreadsheet', icon: 'lucide-table' },
      { label: 'Presentation', icon: 'lucide-presentation' },
      { label: 'Meeting', icon: 'lucide-video' },
    ],
  },
  {
    label: 'Recent',
    items: RECENT_DOCS.slice(0, 3).map((doc) => ({
      label: doc.name,
      icon: DOC_KIND_META[doc.kind].icon,
    })),
  },
]

function onItemClick(item: PaletteItem) {
  if (item.path) router.push(item.path)
  else if (item.area) go(item.area)
  open.value = false
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    open.value = !open.value
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    query.value = ''
    nextTick(() => inputEl.value?.el?.focus())
  }
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<!--
  Not scoped: @tailwindcss/forms paints every text input white, and that
  survives dark mode inside the dialog. TextInput routes a class prop to its
  wrapper rather than the control, and the control carries no scope attribute,
  so :deep() cannot reach it. One selector, named for this component only.
-->
<style>
.palette-input input {
  @apply bg-transparent placeholder-ink-gray-4;
}
</style>
