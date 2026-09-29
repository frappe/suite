<template>
	<div class="slides-container">
		<div
			v-for="slide in slides"
			:key="slide.cliendId"
			class="slide-page"
			:style="getSlidePageStyles(slide)"
		>
			<SlideElement
				v-for="element in slide?.elements"
				:key="`export-${element.id}`"
				mode="export"
				:element="element"
				:data-index="element.id"
			/>
		</div>
	</div>
</template>

<script setup>
import SlideElement from '@/apps/slides/components/SlideElement.vue'

const props = defineProps({
	slides: { type: Array, required: true },
})

const getSlidePageStyles = (slide) => {
	return {
		inset: 0,
		background: slide.background || 'white',
		// fallback to outline to ensure correct slide color
		// when browser print background setting is disabled
		// since we cannot really impose readonly for that setting
		outline: `9999px solid ${slide.background || 'white'}`,
		outlineOffset: '-9999px',
	}
}
</script>

<style>
@media print {
	body > * {
		display: none !important;
	}

	.slides-container {
		display: block !important;
	}

	.slides-container .slide-page {
		display: block !important;
	}

	@page {
		size: 960px 540px;
		margin: 0;
	}
}

.slides-container {
	display: none;
	background: white;
}

.slide-page {
	position: relative;
	width: 960px !important;
	height: 540px !important;
	transform: none !important;
	page-break-after: always;
	overflow: hidden;
}
</style>
