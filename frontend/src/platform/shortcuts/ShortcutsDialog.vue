<template>
  <KeyboardShortcutsDialog v-model:open="open" :title="__('Keyboard shortcuts')">
    <template #default="{ groups }">
      <p
        v-if="!listedGroups(groups).length"
        class="h-[20vh] py-8 text-center text-sm text-ink-gray-5"
      >
        {{ __('No shortcuts match your search.') }}
      </p>
      <!-- Columns, not a grid: a short group sits under the one before it
           instead of leaving a row of empty cells beside it. -->
      <div v-else class="max-h-[70vh] columns-1 gap-x-10 overflow-y-auto pr-1 md:columns-2">
        <section
          v-for="group in listedGroups(groups)"
          :key="group.name"
          class="mb-8 break-inside-avoid space-y-1"
        >
          <h3 class="mb-3 text-base-medium text-ink-gray-8">{{ group.name }}</h3>
          <div
            v-for="row in group.rows"
            :key="row.description"
            class="flex items-start justify-between gap-3 py-0.5"
          >
            <span class="text-p-base text-ink-gray-6">{{ row.description }}</span>
            <span
              class="flex shrink-0 items-center gap-1.5"
              role="img"
              :aria-label="spokenKeys(row)"
            >
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
  </KeyboardShortcutsDialog>
</template>

<script setup lang="ts">
import { KeyboardShortcutsDialog, type KeyboardShortcutGroup } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'

import { comboKeycaps, isMacPlatform, letterKeycap, type KeyStroke } from './keycaps'
import { liveKeySequences } from './keySequences'

/**
 * The one shortcuts list in Suite. It lists frappe-ui's registry, which the
 * dialog hands to its slot already searched, and the key sequences, in two
 * packed columns. frappe-ui files a shortcut registered without a group, such
 * as its Settings dialog's toggle, under "General"; Suite lists those with its
 * own under "Suite".
 */
const SUITE_GROUP = 'Suite'
const FRAPPE_UI_DEFAULT_GROUP = 'General'

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

const open = defineModel<boolean>('open', { required: true })

const mac = isMacPlatform()

function listedGroups(registry: readonly KeyboardShortcutGroup[]): ListedGroup[] {
  const groups = new Map<string, ShortcutRow[]>([[SUITE_GROUP, []]])
  function add(group: string, row: ShortcutRow) {
    const name = group === FRAPPE_UI_DEFAULT_GROUP ? SUITE_GROUP : group
    const rows = groups.get(name) ?? []
    rows.push(row)
    groups.set(name, rows)
  }
  for (const group of registry) {
    for (const { description, combo, altCombos } of group.shortcuts) {
      const combos = [combo, ...altCombos]
      add(group.name, { description, sequences: combos.map((each) => [comboKeycaps(each, mac)]) })
    }
  }
  for (const { group, description, keys } of liveKeySequences()) {
    add(group, { description, sequences: [keys.map((key) => [letterKeycap(key)])] })
  }
  return [...groups].filter(([, rows]) => rows.length).map(([name, rows]) => ({ name, rows }))
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
