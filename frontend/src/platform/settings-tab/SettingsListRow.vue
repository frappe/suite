<!--
  One item of a management list in Settings: a folder, signature, identity,
  calendar, filter script, push subscription or screened sender. Put the rows
  straight in a `SettingsSection`, with the list's "New" button in the
  section's `#actions` and a `SettingsEmpty` when there are none.

  - `#leading`: an icon, avatar or colour dot.
  - `title` and an optional one-line `subtitle`.
  - `#trailing`: badges or a switch, before the menu.
  - `menu`: the row's actions, behind one "…" button.
  - `@open`: the row's main action, usually "edit". With a listener the whole
    row is the button for it and shows the hover; without one it is static.
  - `selected` / `selecting`: a list with bulk actions puts a checkbox first in
    each row. Bind them with `v-bind="selection.row(key)"` from
    `useSettingsSelection`. The checkbox shows on hover or focus, on a touch
    screen, and on every row once any row is selected.

  The row's content and its divider stay on the content column's edges, like
  a `SettingsRow`. Only the hover background reaches 8px past them, so the
  text does not sit against its edge.
-->
<template>
  <div
    class="group/row relative isolate flex min-h-12 items-center gap-3 py-2"
    :class="{
      'before:absolute before:-inset-x-2 before:inset-y-0 before:-z-10 before:rounded-6 hover:before:bg-surface-gray-1':
        onOpen,
    }"
  >
    <!-- Above the stretched title button, so a click selects instead of opening. -->
    <Checkbox
      v-if="selected !== undefined"
      class="relative"
      :class="
        !selecting &&
        'opacity-0 focus-within:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100'
      "
      :model-value="selected"
      :aria-label="__('Select {0}', [title])"
      @update:model-value="(on) => emit('update:selected', !!on)"
    />
    <div v-if="$slots.leading" class="flex shrink-0 items-center">
      <slot name="leading" />
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <!-- The title button stretches over the row and its hover area, so the
           row opens on a click anywhere, and the menu stays its own button. -->
      <button
        v-if="onOpen"
        type="button"
        class="truncate text-left text-base text-ink-gray-8 outline-none after:absolute after:-inset-x-2 after:inset-y-0 after:rounded-6 focus-visible:after:ring-2 focus-visible:after:ring-outline-gray-3"
        @click="onOpen"
      >
        {{ title }}
      </button>
      <span v-else class="truncate text-base text-ink-gray-8">{{ title }}</span>
      <span v-if="subtitle" class="truncate text-sm text-ink-gray-5">{{ subtitle }}</span>
    </div>
    <div v-if="$slots.trailing || menu?.length" class="relative flex shrink-0 items-center gap-2">
      <slot name="trailing" />
      <Dropdown v-if="menu?.length" :options="menu" align="end">
        <Button
          variant="ghost"
          icon="lucide-ellipsis"
          :aria-label="__('Actions for {0}', [title])"
        />
      </Dropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button, Checkbox, type DropdownOptions } from 'frappe-ui'

import { Dropdown } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

// `selected` defaults to undefined, not to false as a boolean prop would: undefined means the row
// has no checkbox.
withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    menu?: DropdownOptions
    /** Declared as a prop so the row knows whether `@open` has a listener. */
    onOpen?: () => void
    /** Whether the row is selected; left out, the row has no checkbox. */
    selected?: boolean
    /** Some row of the list is selected, so every checkbox shows. */
    selecting?: boolean
  }>(),
  { selected: undefined },
)
const emit = defineEmits<{ 'update:selected': [selected: boolean] }>()
defineSlots<{ leading?: () => unknown; trailing?: () => unknown }>()
</script>
