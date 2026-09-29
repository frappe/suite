<!--
  Gives a Calendar settings tab the injections CalendarLayout gives Calendar
  pages, so the tab also works in the Suite Settings dialog outside Calendar.
  The tab renders once the user info is in.
-->
<template>
	<slot v-if="userResource.data" />
	<div
		v-else
		class="flex min-h-0 flex-1 items-center justify-center"
		role="status"
		:aria-label="__('Loading')"
	>
		<LoadingIndicator class="text-ink-gray-5 size-5" />
	</div>
</template>

<script setup lang="ts">
import { onScopeDispose, provide } from 'vue'
import { LoadingIndicator } from 'frappe-ui'

import { initSocket } from '@/apps/calendar/socket'
import { userStore } from '@/apps/calendar/stores/user'
import dayjs from '@/apps/calendar/utils/dayjs'
import { translate as __ } from '@/platform/translation'

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
