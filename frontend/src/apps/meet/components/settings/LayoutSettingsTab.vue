<template>
  <AppSettingsHeader
    :title="__('Layout')"
    :description="__('Customize the meeting interface layout')"
  />
  <AppSettingsBody>
    <div class="space-y-6">
      <SettingsRow
        :title="__('Auto-hide header and controls')"
        :description="
          __('Automatically hide the header and toolbar after 10 seconds of inactivity')
        "
      >
        <Switch v-model="autoHideToolbarLocal" />
      </SettingsRow>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { SettingsRow, Switch } from 'frappe-ui'
import { ref, watch, type Ref } from 'vue'

import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import { translate as __ } from '@/platform/translation'

import { autoHideToolbar, setAutoHideToolbar } from '../../data/mediaPreferences'

const autoHideToolbarLocal: Ref<boolean> = ref(autoHideToolbar.value)

watch(autoHideToolbarLocal, (newValue) => {
  setAutoHideToolbar(newValue)
})

watch(autoHideToolbar, (newValue) => {
  autoHideToolbarLocal.value = newValue
})
</script>
