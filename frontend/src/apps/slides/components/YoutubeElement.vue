<template>
	<div class="relative h-full">
		<img
			v-if="mode == 'thumbnail'"
			class="size-full object-cover"
			:style="frameStyle"
			:src="thumbnailSrc"
		/>
		<iframe
			v-else
			class="size-full"
			:style="frameStyle"
			:src="embedSrc"
			title="YouTube video"
			frameborder="0"
			allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
			allowfullscreen
		/>
		<!-- the iframe swallows every pointer event, so while editing this blocks
		clicks from reaching the YouTube player and moves/selects the element instead -->
		<div v-if="mode != 'thumbnail' && !inViewerMode" class="absolute left-0 top-0 size-full"></div>
	</div>
</template>

<script setup>
import { computed, inject, ref } from 'vue'

import { useBoxShadow } from '@/apps/slides/composables/useShadow'
import { defaultBorderColor } from '@/apps/slides/utils/constants'
import { getYoutubeEmbedSrc, getYoutubeThumbnailSrc } from '@/apps/slides/utils/youtube'

const props = defineProps({
	mode: {
		type: String,
		default: 'editor',
	},
	transitionStyles: {
		type: Object,
		default: () => ({}),
	},
})

const element = defineModel('element', {
	type: Object,
	default: null,
})

const inReadonlyMode = inject('inReadonlyMode', ref(false))
const inSlideShowMode = inject('inSlideShowMode', ref(false))
const inViewerMode = computed(() => inReadonlyMode.value || inSlideShowMode.value)

const boxShadow = useBoxShadow(element)

const embedSrc = computed(() => getYoutubeEmbedSrc(element.value.videoId))
const thumbnailSrc = computed(() => getYoutubeThumbnailSrc(element.value.videoId))

const frameStyle = computed(() => ({
	opacity: (element.value.opacity ?? 100) / 100,
	borderRadius: `${element.value.borderRadius}px`,
	borderStyle: element.value.borderStyle || 'none',
	borderColor: element.value.borderColor || defaultBorderColor,
	borderWidth: `${element.value.borderWidth}px`,
	boxShadow: boxShadow.value,
	...props.transitionStyles,
}))
</script>
