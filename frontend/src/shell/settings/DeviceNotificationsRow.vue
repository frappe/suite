<!--
  The switch for this device's notifications, in Account > Preferences. When
  the switch cannot work, the row shows no switch and the description says
  why: the browser cannot show notifications, the site has no notification
  relay, or the person blocked notifications for the site.
-->
<template>
  <SettingsRow :title="__('Show notifications on this device')" :description="description">
    <Switch
      v-if="usable"
      :model-value="push.enabled.value"
      :disabled="switching"
      @update:model-value="toggle"
    />
  </SettingsRow>
</template>

<script setup lang="ts">
import { SettingsRow, Switch } from 'frappe-ui'
import { computed, ref } from 'vue'

import { toast } from '@/platform/feedback'
import { useDevicePush } from '@/platform/pwa'
import { translate as __ } from '@/platform/translation'

const push = useDevicePush()
const switching = ref(false)

const browserSupported = 'Notification' in window && 'serviceWorker' in navigator
// The browser does not announce a change made in its own settings; read it
// again after each ask.
const permission = ref(browserSupported ? Notification.permission : 'default')

const blocked = computed(() => permission.value === 'denied' && !push.enabled.value)
const usable = computed(() => push.available.value && !blocked.value)

const description = computed(() => {
  if (!browserSupported) return __('This browser cannot show notifications')
  if (!push.available.value) return __('Notifications are not set up on this site')
  if (blocked.value)
    return __(
      'Notifications are blocked for this site. To allow them, open the site settings from the icon beside the address bar.',
    )
  return __('Get notified on this device, even when Suite is closed')
})

async function toggle() {
  if (switching.value) return
  switching.value = true
  try {
    if (push.enabled.value) await push.disable()
    else await push.enable()
  } catch {
    toast.error(__('Could not turn on notifications'))
  } finally {
    permission.value = Notification.permission
    switching.value = false
  }
}
</script>
