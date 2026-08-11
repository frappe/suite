<template>
	<Tooltip text="Unlock" :hover-delay="0.7">
		<div
			:style="[styles.handle, { pointerEvents: 'auto' }]"
			class="flex cursor-pointer items-center justify-center"
			aria-label="Unlock"
			@mousedown.stop
			@click="toggleLock()"
		>
			<div :style="styles.stem"></div>
			<LucideLockOpen
				class="stroke-[1.5]"
				:style="[styles.icon, { transform: `rotate(${-rotation}deg)` }]"
			/>
		</div>
	</Tooltip>
</template>
<script setup>
import { computed } from 'vue'
import { Tooltip } from 'frappe-ui'

import { slideBounds } from '@/apps/slides/stores/slide'
import { toggleLock } from '@/apps/slides/stores/element'
import { lockColor, getStemHandleStyles } from '@/apps/slides/utils/constants'

defineProps({
	rotation: {
		type: Number,
		default: 0,
	},
})

const styles = computed(() => getStemHandleStyles(slideBounds.scale, lockColor))
</script>
