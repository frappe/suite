<template>
	<!-- Slide Navigation Panel -->
	<div
		:class="[panelClasses, attrs.class]"
		@mouseenter="handleHoverChange"
		@mouseleave="handleHoverChange"
		@wheel="handleScrollBarWheelEvent"
		@click.stop
	>
		<div
			ref="scrollableArea"
			class="h-svh overflow-y-auto p-4 pe-3 custom-scrollbar"
			:class="{ 'pb-14': !inReadonlyMode }"
			:style="scrollbarStyles"
		>
			<div :style="virtualContainerStyles">
				<div
					v-for="virtualRow in virtualRows"
					:key="virtualRow.key"
					:class="getRowClasses(orderedSlides[virtualRow.index])"
					:style="getRowStyles(virtualRow)"
					@click="handleSlideClick(orderedSlides[virtualRow.index])"
					@mousedown="slideSort.handleSortStart($event, virtualRow.index)"
				>
					<ThumbnailContainer
						:slide="orderedSlides[virtualRow.index]"
						:isActive="isSlideActive(orderedSlides[virtualRow.index])"
					/>
				</div>
			</div>

			<!-- add slide option -->
			<div
				v-if="!inReadonlyMode"
				:class="insertButtonClasses"
				@click="emit('openLayoutDialog')"
			>
				<LucidePlus class="size-3.5" />
			</div>
		</div>
	</div>

	<!-- Slide Navigator Toggle -->
	<div v-if="!isNavigationPanelOpen" :class="toggleButtonClasses" @click="toggleNavigationPanel">
		<LucideChevronRight class="size-3.5 text-gray-500" />
	</div>
</template>

<script setup>
import { ref, computed, watch, useTemplateRef, useAttrs, inject, onActivated, nextTick } from 'vue'

import ThumbnailContainer from '@/apps/slides/components/ThumbnailContainer.vue'

import { useVirtualizer } from '@tanstack/vue-virtual'
import { useNavigationPanel } from '@/apps/slides/composables/useNavigationPanel'
import { useDragSort } from '@/apps/slides/composables/useDragSort'

import { slides, slideIndex, focusedSlide } from '@/apps/slides/stores/slide'
import { commandHistory } from '@/apps/slides/stores/historyMeta'
import { reorderSlidesCommand } from '@/apps/slides/stores/commands'
import { resetFocus } from '@/apps/slides/stores/element'
import { slidesLength } from '@/apps/slides/stores/presentation'
import { handleScrollBarWheelEvent } from '@/apps/slides/utils/helpers'

const attrs = useAttrs()

const inReadonlyMode = inject('inReadonlyMode', ref(false))

const emit = defineEmits(['changeSlide', 'openLayoutDialog'])

const ROW_HEIGHT = 90
const ROW_GAP = 8
const ROW_SIZE = ROW_HEIGHT + ROW_GAP * 2

const scrollableArea = useTemplateRef('scrollableArea')

const { isNavigationPanelOpen, toggleNavigationPanel } = useNavigationPanel()

const handleSortEnd = (sortChange) => {
	if (!sortChange) return

	resetFocus()
	commandHistory.execute(reorderSlidesCommand(sortChange))
}

const slideSort = useDragSort(scrollableArea, slidesLength, ROW_SIZE, handleSortEnd)

const showCollapseShortcut = ref(false)

const insertButtonClasses =
	'flex w-full aspect-video cursor-pointer items-center justify-center rounded border border-dashed border-gray-400 hover:border-blue-400 hover:bg-blue-50'

const panelClasses = computed(() => {
	// can't add it from parent attrs.class since attrs is not reactive
	const positionClass = isNavigationPanelOpen.value ? 'left-0' : '-left-48'
	const baseClasses = [
		'w-48',
		'border-r',
		'bg-white',
		'transition-all',
		'duration-300',
		'ease-in-out',
	]
	return [...baseClasses, positionClass]
})

const toggleButtonClasses = computed(() => {
	const baseClasses = 'flex cursor-pointer items-center border bg-white'
	if (isNavigationPanelOpen.value) {
		return `${baseClasses} fixed -left-0.4 bottom-0 h-10 w-48 justify-between p-4`
	}
	return `${baseClasses} absolute top-1/2 transform -transform-y-1/2 h-12 w-4 justify-center rounded-r-lg shadow-xl`
})

const scrollbarStyles = computed(() => ({
	'--scrollbar-thumb-color': showCollapseShortcut.value ? '#cfcfcf' : 'transparent',
}))

const orderedSlides = computed(() => {
	const startIndex = slideSort.itemStartIndex.value
	const previewIndex = slideSort.itemPreviewIndex.value

	if (startIndex == null || previewIndex == null) {
		return slides.value
	}

	const nextSlides = [...slides.value]

	const [draggedSlide] = nextSlides.splice(startIndex, 1)
	nextSlides.splice(previewIndex, 0, draggedSlide)

	return nextSlides
})

const rowVirtualizer = useVirtualizer(
	computed(() => ({
		count: slides.value.length,
		getScrollElement: () => scrollableArea.value,
		estimateSize: () => ROW_SIZE,
		overscan: 3,
	})),
)

const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems())
const totalSize = computed(() => rowVirtualizer.value.getTotalSize())

const virtualContainerStyles = computed(() => ({
	height: `${totalSize.value}px`,
	width: '100%',
	position: 'relative',
}))

const isSlideActive = (slide) => slideIndex.value === slides.value.indexOf(slide)

const handleSlideClick = async (slide) => {
	if (slideSort.shouldIgnoreClick()) return

	const index = slides.value.indexOf(slide)

	if (isSlideActive(slide) && !inReadonlyMode.value) {
		resetFocus()
		focusedSlide.value = index
		return
	}
	emit('changeSlide', index)
}

const handleHoverChange = (e) => {
	if (e.type === 'mouseenter') {
		showCollapseShortcut.value = true
	} else if (e.type === 'mouseleave') {
		showCollapseShortcut.value = false
	}
}

const scrollToVirtualItem = (index, behavior = 'smooth') => {
	rowVirtualizer.value.scrollToIndex(index, {
		align: 'center',
		behavior,
	})
}

const isItemFullyVisible = (scrollElement, virtualItem) => {
	const viewportTop = scrollElement.scrollTop
	const viewportBottom = viewportTop + scrollElement.clientHeight

	const itemTop = virtualItem.start
	const itemBottom = virtualItem.end

	return itemTop >= viewportTop && itemBottom <= viewportBottom
}

const scrollToSlide = (index) => {
	const scrollElement = scrollableArea.value
	if (!scrollElement) return

	const virtualItem = rowVirtualizer.value.getVirtualItems().find((v) => v.index === index)
	if (!virtualItem) {
		// jump instantly; a smooth scroll here can stall on re-measurement during a reload
		return scrollToVirtualItem(index, 'auto')
	}

	const fullyVisible = isItemFullyVisible(scrollElement, virtualItem)
	if (!fullyVisible) {
		scrollToVirtualItem(index)
	}
}

const getRowClasses = (slide) => ['virtual-row-wrapper', { 'is-active': isSlideActive(slide) }]

const getRowStyles = (virtualRow) => ({
	position: 'absolute',
	top: 0,
	left: 0,
	width: '100%',
	height: `${virtualRow.size}px`,
	transform: `translateY(${virtualRow.start}px)`,
})

watch(
	() => slideIndex.value,
	(index) => {
		if (!isNavigationPanelOpen.value) return
		scrollToSlide(index)
	},
)

// keep-alive detaches the panel and resets scrollTop, but the virtualizer keeps its cached
// offset (no scroll event fires); dispatch one so it re-reads before repositioning
onActivated(() => {
	nextTick(() => {
		const scrollElement = scrollableArea.value
		if (!scrollElement || !isNavigationPanelOpen.value) return
		scrollElement.dispatchEvent(new Event('scroll'))
		rowVirtualizer.value.scrollToIndex(slideIndex.value, { align: 'start', behavior: 'auto' })
	})
})
</script>

<style scoped>
.virtual-row-wrapper.is-active::before {
	content: '';
	position: absolute;
	left: -1.25rem;
	top: 0;
	width: 0.5rem;
	height: 90px;
	border-radius: 0 0.25rem 0.25rem 0;
	background: rgb(59 130 246 / 0.9);
	pointer-events: none;
}
</style>
