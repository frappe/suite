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
  - `reads` are the reads `loading` waits on. When one of them fails while
    the tab loads, a message and a Retry button take the loading state's
    place, and Retry runs the failed reads again.

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
        <LoadFailed
          v-if="loading && failedReads.length"
          :title="__('Could not load these settings')"
          :retry="retry"
        />
        <SettingsLoading v-else-if="loading" />
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
        <LoadFailed
          v-if="loading && failedReads.length"
          :title="__('Could not load these settings')"
          :retry="retry"
        />
        <SettingsLoading v-else-if="loading" />
        <slot v-else />
      </div>
    </SettingsBody>
  </template>
</template>

<script setup lang="ts">
import { SettingsBody, SettingsHeader } from 'frappe-ui'
import { computed, inject } from 'vue'

import { LoadFailed } from '@/platform/load-failed'
import { SETTINGS_PAGE_ACTIONS_ID, SETTINGS_PHONE_PAGE } from '@/platform/settings'
import { translate as __ } from '@/platform/translation'

import SettingsLoading from './SettingsLoading.vue'

/** A read a tab waits on, as `useQuery` and the app stores' resources give it. */
interface SettingsRead {
  readonly error: unknown
  refetch(): Promise<unknown>
}

const props = defineProps<{
  title: string
  description?: string
  loading?: boolean
  reads?: readonly SettingsRead[]
}>()
defineSlots<{ default?: () => unknown; actions?: () => unknown }>()

const phonePage = inject(SETTINGS_PHONE_PAGE, false)

const failedReads = computed(() => (props.reads ?? []).filter((read) => read.error))
// In order, so a read whose input comes from an earlier one runs after it.
async function retry() {
  for (const read of failedReads.value) await read.refetch()
}
</script>
