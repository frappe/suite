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
      <TabButtons v-model="direction" class="self-start" :options="DIRECTIONS" />
      <ImportSettings v-if="direction === 'import'" />
      <ExportSettings v-else />
    </div>
  </SettingsPage>
</template>

<script setup lang="ts">
import { TabButtons } from 'frappe-ui'
import { ref } from 'vue'

import { SettingsPage } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

import ExportSettings from './ExportSettings.vue'
import ImportSettings from './ImportSettings.vue'

const DIRECTIONS = [
  { label: __('Import'), value: 'import' },
  { label: __('Export'), value: 'export' },
]

const direction = ref<string | number>('import')
</script>
