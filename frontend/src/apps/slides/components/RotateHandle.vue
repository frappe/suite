<template>
	<div
		:style="[styles.handle, { cursor: 'grab' }]"
		class="flex items-center justify-center"
		@mousedown="startRotate"
	>
		<div :style="styles.stem"></div>
		<LucideRotateCw class="stroke-[1.5]" :style="styles.icon" />
	</div>
</template>
<script setup>
import { computed, inject } from 'vue'

import { slideBounds } from '@/apps/slides/stores/slide'
import { getStemHandleStyles } from '@/apps/slides/utils/constants'

const { startRotate } = inject('rotator', {})

const styles = computed(() => getStemHandleStyles(slideBounds.scale))
</script>
