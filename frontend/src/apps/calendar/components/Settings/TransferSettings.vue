<!--
  Calendar > Import & export: one tab for both directions, switched by the
  segmented control at the top of the body. Each side starts a background job
  and emails the user when it is done.
-->
<template>
  <SettingsPage
    :title="__('Import & export')"
    :description="__('Bring in events from a file, or download a copy of your calendars')"
  >
    <!-- The switch belongs to the form under it, so it sits closer to it than
         the page gap. -->
    <div class="flex flex-col gap-2">
      <TabButtons
        :model-value="direction"
        class="self-start"
        :options="DIRECTIONS"
        @update:model-value="selectDirection"
      />
      <ImportSection v-if="direction === 'import'" />
      <ExportSection v-else />
    </div>
  </SettingsPage>
</template>

<script setup lang="ts">
import { TabButtons } from 'frappe-ui'
import { ref } from 'vue'

import { SettingsPage } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

import ExportSection from './ExportSection.vue'
import ImportSection from './ImportSection.vue'

type Direction = 'import' | 'export'
const DIRECTIONS: { label: string; value: Direction }[] = [
  { label: __('Import'), value: 'import' },
  { label: __('Export'), value: 'export' },
]

const direction = ref<Direction>('import')
function selectDirection(value: string | number) {
  if (value === 'import' || value === 'export') direction.value = value
}
</script>
