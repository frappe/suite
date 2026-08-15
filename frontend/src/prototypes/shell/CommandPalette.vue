<!--
  PROTOTYPE — remove. Cmd+K palette stub: static grouped fake results, no real
  search. Esc closes (handled by Dialog).
-->
<template>
  <Dialog v-model:open="open" size="xl" position="top" bare>
    <div class="flex flex-col">
      <!-- TextInput, not a bare <input>: the suite's global form styles were
           painting a blue border and their own padding inside the palette. -->
      <div class="border-b border-outline-gray-1">
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
          <template #suffix>
            <KeyboardShortcut combo="Esc" />
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
          </button>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Dialog, KeyboardShortcut, TextInput } from 'frappe-ui'

import { DOC_KIND_META, RECENT_DOCS, type AreaId } from './fixtures'
import { commandPaletteOpen as open } from './useCommandPalette'
import { useShellNav } from './useShellNav'

const { go } = useShellNav()
const query = ref('')
// TextInput exposes its native element as `el`.
const inputEl = ref<{ el: HTMLInputElement | null } | null>(null)

interface PaletteItem {
  label: string
  icon: string
  area?: AreaId
}

const GROUPS: { label: string; items: PaletteItem[] }[] = [
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
  if (item.area) go(item.area)
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
