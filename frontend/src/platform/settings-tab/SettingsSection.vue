<!--
  One group of settings inside a `SettingsPage`. Every tab body is a stack of
  these, so headings and spacing match across tabs.

  - `title` is the one section heading style; leave it out only for a tab's
    first section when the tab title already says what it holds.
  - `description` is one line under the heading.
  - `#actions` sits right of the heading: the "New" button of a list.
  - The default slot holds the content: `SettingsRow`s (from frappe-ui),
    `SettingsListRow`s, a `SettingsEmpty` or a `SettingsForm`. Its direct
    children are divided by a hairline, so rows need no borders of their own.
-->
<template>
  <section :aria-labelledby="title ? headingId : undefined">
    <div v-if="title || $slots.actions" class="mb-2 flex items-start justify-between gap-4">
      <div class="flex min-w-0 flex-col gap-1">
        <h3 v-if="title" :id="headingId" class="text-base-semibold text-ink-gray-8">
          {{ title }}
        </h3>
        <p v-if="description" class="text-p-base text-ink-gray-6">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <div class="divide-y divide-outline-gray-1">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { useId } from 'vue'

defineProps<{
  title?: string
  description?: string
}>()
defineSlots<{ default?: () => unknown; actions?: () => unknown }>()

const headingId = useId()
</script>
