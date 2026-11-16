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
-->
<template>
  <div
    class="relative -mx-2 flex min-h-12 items-center gap-3 rounded-6 px-2 py-2"
    :class="{ 'hover:bg-surface-gray-1': onOpen }"
  >
    <div v-if="$slots.leading" class="flex shrink-0 items-center">
      <slot name="leading" />
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <!-- The title button stretches over the row (after:inset-0), so the
           row opens on a click anywhere, and the menu stays its own button. -->
      <button
        v-if="onOpen"
        type="button"
        class="truncate text-left text-base text-ink-gray-8 outline-none after:absolute after:inset-0 after:rounded-6 focus-visible:after:ring-2 focus-visible:after:ring-outline-gray-3"
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
import { Button, type DropdownOptions } from 'frappe-ui'

import { Dropdown } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

defineProps<{
  title: string
  subtitle?: string
  menu?: DropdownOptions
  /** Declared as a prop so the row knows whether `@open` has a listener. */
  onOpen?: () => void
}>()
defineSlots<{ leading?: () => unknown; trailing?: () => unknown }>()
</script>
