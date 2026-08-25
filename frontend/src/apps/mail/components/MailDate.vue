<template>
	<Tooltip :text="tooltipText" :disabled="inList">
		<div class="text-ink-gray-5 text-nowrap text-xs" :class="{ 'mr-1': !inList }">
			{{ formattedDate }}
		</div>
	</Tooltip>
</template>
<script setup lang="ts">
import { computed, inject } from 'vue'
import { useTimeAgo } from '@vueuse/core'
import { Tooltip } from 'frappe-ui'

const {
	datetime,
	inList = false,
	clock = false,
} = defineProps<{ datetime: string; inList?: boolean; clock?: boolean }>()

const dayjs = inject('$dayjs')

const formattedDate = computed(() => {
	// The thread's day dividers already state the date, so its rows carry only the clock —
	// the sequence and the gaps between replies, which a relative stamp hides.
	if (clock) return dayjs(datetime).format('h:mm A')
	if (!inList) {
		const timeAgo = useTimeAgo(datetime).value
		return __(timeAgo.charAt(0).toUpperCase() + timeAgo.slice(1))
	}
	if (dayjs(datetime).isToday()) return dayjs(datetime).format('h:mm A')
	if (dayjs(datetime).isYesterday()) return __('Yesterday')
	if (dayjs(datetime).year() === dayjs().year()) return dayjs(datetime).format('D MMM')
	return dayjs(datetime).format('D MMM YYYY')
})

const tooltipText = computed(() =>
	__(`${dayjs(datetime).format('D MMM YYYY')} at ${dayjs(datetime).format('h:mm A')}`),
)
</script>
