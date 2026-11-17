<!--
  Gives a Mail settings tab the injections MailLayout gives Mail pages, so the
  tab also works in the Suite Settings dialog outside Mail. Until the user
  info is in, it shows the tab's header and the settings loading state, where
  the tab will put them, or the load failure.
-->
<template>
  <slot v-if="userResource.data" />
  <SettingsPage v-else loading :reads="[userResource]" />
</template>

<script setup lang="ts">
import { onScopeDispose, provide } from 'vue'

import { initSocket } from '@/apps/mail/socket'
import { userStore } from '@/apps/mail/stores/user'
import dayjs from '@/apps/mail/utils/dayjs'
import { SettingsPage } from '@/platform/settings-tab'

const props = defineProps<{ socket?: boolean }>()

const { userResource } = userStore()
provide('$user', userResource)
provide('$dayjs', dayjs)
if (props.socket) {
  const socket = initSocket()
  provide('$socket', socket)
  onScopeDispose(() => socket.disconnect())
}
</script>
