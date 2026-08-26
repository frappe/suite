<template>
	<!-- Slide Navigation Panel -->
	<div
		:class="[panelClasses, attrs.class]"
		@wheel="handleScrollBarWheelEvent"
		@click.stop
	>
		<div
			v-if="slidesLength"
			class="flex items-center justify-between px-4 pt-3"
		>
			<span :class="labelClasses">Slide</span>
			<span :class="labelClasses">{{ (slideIndex ?? 0) + 1 }} of {{ slidesLength }}</span>
		</div>
		<div
			ref="scrollableArea"
			class="faded-scroll [--fade-length:6px] min-h-0 flex-1 overflow-y-auto p-4 pt-3 no-scrollbar"
		>
			<component :is="menuWrapper" v-bind="menuWrapperProps">
				<div :style="virtualContainerStyles">
					<div
						v-for="virtualRow in virtualRows"
						:key="virtualRow.key"
						:class="getRowClasses(orderedSlides[virtualRow.index])"
						:style="getRowStyles(virtualRow)"
						@click="handleSlideClick(orderedSlides[virtualRow.index])"
						@mousedown="slideSort.handleSortStart($event, virtualRow.index)"
						@contextmenu="handleSlideContextMenu(virtualRow.index)"
					>
						<ThumbnailContainer
							:slide="orderedSlides[virtualRow.index]"
							:isActive="isSlideActive(orderedSlides[virtualRow.index])"
							:scale="thumbnailScale"
							:height="thumbnailHeight"
						/>
						<div
							v-if="isSlideActive(orderedSlides[virtualRow.index])"
							class="pointer-events-none absolute -left-4 top-0 z-10 w-1 rounded-r-6 bg-surface-gray-8 dark:bg-surface-gray-5"
							:style="{ height: `${thumbnailHeight}px` }"
						/>
					</div>
				</div>
			</component>

			<div
				v-if="!inReadonlyMode && presentationDoc"
				:class="insertButtonClasses"
				@click="openLayoutDialog(slidesLength - 1)"
			>
				<LucidePlus class="size-4 stroke-[1.5]" />
				<span class="font-text text-base">Add Slide</span>
			</div>
		</div>
	</div>

	<!-- Slide Navigator Toggle -->
	<div v-if="!isNavigationPanelOpen" :class="toggleButtonClasses" @click="toggleNavigationPanel">
		<LucideChevronRight class="size-4 stroke-[1.5]" />
	</div>
</template>

<script setup>
import { ref, computed, watch, useTemplateRef, useAttrs, inject, onActivated, nextTick } from 'vue'

import { ContextMenu } from 'frappe-ui'

import ThumbnailContainer from '@/apps/slides/components/ThumbnailContainer.vue'

import { useVirtualizer } from '@tanstack/vue-virtual'
import { useNavigationPanel } from '@/apps/slides/composables/useNavigationPanel'
import { useDragSort } from '@/apps/slides/composables/useDragSort'

import { slides, slideIndex, focusedSlide } from '@/apps/slides/stores/slide'
import { commandHistory } from '@/apps/slides/stores/historyMeta'
import { reorderSlidesCommand } from '@/apps/slides/stores/commands'
import { resetFocus } from '@/apps/slides/stores/element'
import { slidesLength, presentationDoc } from '@/apps/slides/stores/presentation'
import { handleScrollBarWheelEvent } from '@/apps/slides/utils/helpers'
import { labelClasses } from '@/apps/slides/utils/constants'
import { buildSlideContextOptions } from '@/apps/slides/utils/slideMenu'

const attrs = useAttrs()

const inReadonlyMode = inject('inReadonlyMode', ref(false))

const emit = defineEmits(['changeSlide'])

const openLayoutDialog = inject('openLayoutDialog', () => {})

const activeOptions = ref([])

const menuWrapper = computed(() => (inReadonlyMode.value ? 'div' : ContextMenu))
const menuWrapperProps = computed(() =>
	inReadonlyMode.value ? {} : { options: activeOptions.value },
)

const handleSlideContextMenu = (index) => {
	if (inReadonlyMode.value) return
	activeOptions.value = buildSlideContextOptions({ index, openLayoutDialog })
}

const SLIDE_WIDTH = 960
const SLIDE_ASPECT = 540 / 960
const ROW_GAP = 8

// keep in sync with the panel's w-56 width and its p-4 horizontal padding
const PANEL_WIDTH = 224
const PANEL_PADDING_X = 16
const THUMBNAIL_WIDTH = PANEL_WIDTH - PANEL_PADDING_X * 2
const thumbnailScale = THUMBNAIL_WIDTH / SLIDE_WIDTH
const thumbnailHeight = THUMBNAIL_WIDTH * SLIDE_ASPECT
const rowSize = thumbnailHeight + ROW_GAP * 2

const scrollableArea = useTemplateRef('scrollableArea')

const { isNavigationPanelOpen, toggleNavigationPanel } = useNavigationPanel()

const handleSortEnd = (sortChange) => {
	if (!sortChange) return

	resetFocus()
	commandHistory.execute(reorderSlidesCommand(sortChange))
}

const slideSort = useDragSort(scrollableArea, slidesLength, rowSize, handleSortEnd)

const insertButtonClasses =
	'mb-10 flex aspect-video w-full cursor-pointer items-center justify-center gap-2 rounded-6 bg-surface-gray-2 text-ink-gray-5 hover:bg-surface-gray-3'

const panelClasses = computed(() => {
	// can't add it from parent attrs.class since attrs is not reactive
	const positionClass = isNavigationPanelOpen.value ? 'left-0' : '-left-56'
	const baseClasses = [
		'w-56',
		'flex',
		'flex-col',
		'border-r',
		'border-outline-elevation-1',
		'bg-surface-elevation-1',
		'transition-all',
		'duration-300',
		'ease-in-out',
	]
	return [...baseClasses, positionClass]
})

const toggleButtonClasses = computed(() => {
	const baseClasses = 'flex cursor-pointer items-center bg-surface-elevation-1'
	if (isNavigationPanelOpen.value) {
		return `${baseClasses} border border-outline-elevation-1 fixed -left-0.4 bottom-0 h-10 w-48 justify-between p-4`
	}
	return `${baseClasses} absolute top-1/2 transform -transform-y-1/2 h-12 w-4 justify-center rounded-r-6 shadow-xl`
})

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
		estimateSize: () => rowSize,
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
