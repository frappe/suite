<template>
  <!-- A phone settings page scrolls as a whole, so the body is plain padded
       flow. The dialog keeps frappe-ui's scrolling body. -->
  <div v-if="phonePage" class="px-4 pb-8 pt-4">
    <slot />
  </div>
  <SettingsBody v-else v-bind="$attrs">
    <div class="pt-6">
      <slot />
    </div>
  </SettingsBody>
</template>

<script setup lang="ts">
import { SettingsBody } from 'frappe-ui'
import { inject } from 'vue'

import { SETTINGS_PHONE_PAGE } from '@/shell/settings/settings'

defineOptions({ inheritAttrs: false })
defineSlots<{ default?: () => unknown }>()

const phonePage = inject(SETTINGS_PHONE_PAGE, false)
</script>
