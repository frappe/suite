<template>
  <SettingList>
    <SettingRow title="Density" :description="densityHint">
      <Select v-model="mailDensity" :options="availableDensities" class="w-48" />
    </SettingRow>
    <SettingRow
      title="Layout"
      description="Split view shows the reading pane beside the list."
    >
      <Select v-model="mailLayout" :options="MAIL_LAYOUTS" class="w-48" />
    </SettingRow>
    <SettingRow
      title="Sender avatars"
      description="Show people and brand icons beside messages."
    >
      <Switch v-model="showAvatars" />
    </SettingRow>
  </SettingList>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Select, Switch } from 'frappe-ui'

import {
  MAIL_LAYOUTS,
  availableDensities,
  mailDensity,
  mailLayout,
  showAvatars,
} from '../../useMailAppearance'
import SettingList from './SettingList.vue'
import SettingRow from './SettingRow.vue'

const densityHint = computed(() =>
  mailLayout.value === 'split'
    ? 'Row spacing for the message list. Dense needs the full-width list.'
    : 'Row spacing for the message list.',
)
</script>
