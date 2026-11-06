<template>
  <TextInput
    v-if="searchable"
    v-model="query"
    type="text"
    class="mb-6 w-64"
    :placeholder="__('Search shortcuts')"
    :aria-label="__('Search shortcuts')"
  />
  <p v-if="!groups.length" class="h-[20vh] py-8 text-center text-sm text-ink-gray-5">
    {{ __('No keyboard shortcuts available on this page.') }}
  </p>
  <p v-else-if="!shown.length" class="h-[20vh] py-8 text-center text-sm text-ink-gray-5">
    {{ __('No shortcuts match your search.') }}
  </p>
  <!-- Columns, not a grid: a short group sits under the one before it
       instead of leaving a row of empty cells beside it. -->
  <div v-else class="max-h-[70vh] columns-1 gap-x-10 overflow-y-auto pr-1 md:columns-2">
    <section v-for="group in shown" :key="group.name" class="mb-8 break-inside-avoid space-y-1">
      <h3 class="mb-3 text-base-medium text-ink-gray-8">{{ group.name }}</h3>
      <div
        v-for="row in group.rows"
        :key="row.description"
        class="flex items-start justify-between gap-3 py-0.5"
      >
        <span class="text-p-base text-ink-gray-6">{{ row.description }}</span>
        <span class="flex shrink-0 items-center gap-1.5" role="img" :aria-label="spokenKeys(row)">
          <template v-for="(sequence, index) in row.sequences" :key="index">
            <span v-if="index" class="text-xs text-ink-gray-4">/</span>
            <template v-for="(stroke, step) in sequence" :key="step">
              <span v-if="step" class="text-xs text-ink-gray-5">{{ __('then') }}</span>
              <span class="flex gap-0.5">
                <kbd
                  v-for="keycap in stroke"
                  :key="keycap.label"
                  class="inline-flex h-6 min-w-6 items-center justify-center rounded-4 bg-surface-gray-2 px-1.5 font-sans text-xs-medium text-ink-gray-7"
                >
                  {{ keycap.label }}
                </kbd>
              </span>
            </template>
          </template>
        </span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { TextInput, type KeyboardShortcutGroup } from 'frappe-ui'
import { computed, ref } from 'vue'

import { translate as __ } from '@/platform/translation'

import { comboKeycaps, isMacPlatform, letterKeycap, type KeyStroke } from './keycaps'
import { liveKeySequences } from './keySequences'

/**
 * Every shortcut on the page, from frappe-ui's registry and from the key
 * sequences, in two packed columns with one search over both. frappe-ui files a
 * shortcut registered without a group, such as its Settings dialog's toggle,
 * under "General"; Suite lists those with its own under "Suite". Mounted fresh
 * each time the dialog opens, so the search starts empty.
 */
const SUITE_GROUP = 'Suite'
const FRAPPE_UI_DEFAULT_GROUP = 'General'
/** frappe-ui's own threshold: a short list is read, not searched. */
const SEARCH_THRESHOLD = 20

/** Strokes pressed one after the other: `[⌘ K]`, or `[G] then [H]`. */
type KeySequence = readonly KeyStroke[]

interface ShortcutRow {
  description: string
  /** Equivalent ways to press it. */
  sequences: readonly KeySequence[]
}

interface ListedGroup {
  name: string
  rows: readonly ShortcutRow[]
}

const props = defineProps<{ registry: readonly KeyboardShortcutGroup[] }>()

const mac = isMacPlatform()
const query = ref('')

const groups = computed<ListedGroup[]>(() => {
  const rowsByGroup = new Map<string, ShortcutRow[]>([[SUITE_GROUP, []]])
  function add(group: string, row: ShortcutRow) {
    const name = group === FRAPPE_UI_DEFAULT_GROUP ? SUITE_GROUP : group
    rowsByGroup.set(name, [...(rowsByGroup.get(name) ?? []), row])
  }
  for (const group of props.registry) {
    for (const { description, combo, altCombos } of group.shortcuts) {
      const combos = [combo, ...altCombos]
      add(group.name, { description, sequences: combos.map((each) => [comboKeycaps(each, mac)]) })
    }
  }
  for (const { group, description, keys } of liveKeySequences()) {
    add(group, { description, sequences: [keys.map((key) => [letterKeycap(key)])] })
  }
  return [...rowsByGroup].filter(([, rows]) => rows.length).map(([name, rows]) => ({ name, rows }))
})

const searchable = computed(
  () => groups.value.reduce((total, group) => total + group.rows.length, 0) > SEARCH_THRESHOLD,
)

/** A group whose name matches keeps every row; otherwise a row matches on its label or its keys. */
const shown = computed<ListedGroup[]>(() => {
  const wanted = query.value.trim().toLowerCase()
  if (!searchable.value || !wanted) return groups.value
  return groups.value.flatMap((group) => {
    if (group.name.toLowerCase().includes(wanted)) return [group]
    const rows = group.rows.filter((row) => searchText(row).includes(wanted))
    return rows.length ? [{ name: group.name, rows }] : []
  })
})

function searchText(row: ShortcutRow): string {
  const labels = row.sequences.flat(2).map((keycap) => keycap.label)
  return [row.description, ...labels, spokenKeys(row)].join(' ').toLowerCase()
}

function spokenKeys(row: ShortcutRow): string {
  const spoken = row.sequences.map((sequence) =>
    sequence
      .map((stroke) => stroke.map((keycap) => keycap.spoken).join(' '))
      .join(` ${__('then')} `),
  )
  return spoken.join(` ${__('or')} `)
}
</script>
