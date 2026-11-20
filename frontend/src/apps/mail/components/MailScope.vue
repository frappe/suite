<!--
  Gives a Mail component outside Mail the injections MailLayout gives Mail pages:
  a settings tab in the Suite Settings dialog, or Mail's composer over another
  app (with `overlay`, Mail's overlay layer too). What it holds renders once
  Mail's user info is in; until then, the `loading` slot.
-->
<template>
  <slot v-if="userResource.data" />
  <slot v-else name="loading">
    <div
      class="flex min-h-0 flex-1 items-center justify-center"
      role="status"
      :aria-label="__('Loading')"
    >
      <LoadingIndicator class="text-ink-gray-5 size-5" />
    </div>
  </slot>
</template>

<script setup lang="ts">
import { LoadingIndicator } from 'frappe-ui'
import { onScopeDispose, provide } from 'vue'

import { provideMailOverlayLayer } from '@/apps/mail/composables/mailOverlayLayer'
import { initSocket } from '@/apps/mail/socket'
import { userStore } from '@/apps/mail/stores/user'
import dayjs from '@/apps/mail/utils/dayjs'
import { translate as __ } from '@/platform/translation'

const props = defineProps<{ socket?: boolean; overlay?: boolean }>()

const { userResource } = userStore()
provide('$user', userResource)
provide('$dayjs', dayjs)
if (props.overlay) provideMailOverlayLayer()
if (props.socket) {
  const socket = initSocket()
  provide('$socket', socket)
  onScopeDispose(() => socket.disconnect())
}
</script>
