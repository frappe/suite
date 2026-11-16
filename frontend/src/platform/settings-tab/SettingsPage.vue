<!--
  The root of every settings tab body. Use it once per tab, with
  `SettingsSection`s inside.

  - The title equals the tab's sidebar label; the description is one line
    that says what the tab is for.
  - `#actions` sits right of the title, for actions on the whole tab. When
    the body is one untitled list (Folders, Calendars), its "New" button goes
    here; when the tab has several titled lists, each "New" goes in its
    section header. Save belongs to its form.
  - `loading` shows the one loading state in place of the body. Pass it while
    the data the tab renders is still on its way, so no tab shows blank.

  In the dialog, the header stays in place while the body scrolls. On the
  phone page the page bar already shows the title, so the description and
  body flow in one scrolling page and `#actions` moves into the bar.
-->
<template>
  <template v-if="phonePage">
    <!-- defer: the phone page mounts as one new layer, so the bar's target
         is not in the document yet while this tab mounts. -->
    <Teleport v-if="$slots.actions" defer :to="`#${SETTINGS_PAGE_ACTIONS_ID}`">
      <slot name="actions" />
    </Teleport>
    <div class="flex flex-col gap-6 px-4 pb-8 pt-4">
      <p v-if="description" class="text-p-base text-ink-gray-6">{{ description }}</p>
      <div class="flex flex-col gap-8">
        <SettingsLoading v-if="loading" />
        <slot v-else />
      </div>
    </div>
  </template>
  <template v-else>
    <SettingsHeader :title="title" :description="description">
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </SettingsHeader>
    <SettingsBody>
      <div class="flex flex-col gap-10 pt-6">
        <SettingsLoading v-if="loading" />
        <slot v-else />
      </div>
    </SettingsBody>
  </template>
</template>

<script setup lang="ts">
import { SettingsBody, SettingsHeader } from 'frappe-ui'
import { inject } from 'vue'

import { SETTINGS_PAGE_ACTIONS_ID, SETTINGS_PHONE_PAGE } from '@/platform/settings'

import SettingsLoading from './SettingsLoading.vue'

defineProps<{
  title: string
  description?: string
  loading?: boolean
}>()
defineSlots<{ default?: () => unknown; actions?: () => unknown }>()

const phonePage = inject(SETTINGS_PHONE_PAGE, false)
</script>
