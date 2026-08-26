<template>
	<div class="flex h-full w-72 flex-col border-l border-outline-elevation-1 bg-surface-elevation-1" @mousedown="keepEditorFocus">
		<!-- outside every Section, so locking can never disable the way back out -->
		<template v-if="activeElementIds.length">
			<div class="flex shrink-0 items-center justify-between px-4 py-3">
				<span :class="labelClasses">{{ selectionLabel }}</span>
				<button
					type="button"
					:title="isSelectionLocked ? 'Unlock' : 'Lock'"
					:class="lockClasses"
					@click="toggleLock()"
				>
					<lucide-lock v-if="isSelectionLocked" class="size-3.5" />
					<lucide-lock-open v-else class="size-3.5" />
				</button>
			</div>
			<hr class="border-t" />
		</template>
		<div class="no-scrollbar flex-1 overflow-y-auto px-4">
			<div v-if="activeElementIds.length">
				<FrameSection />
				<hr class="border-t" />
				<ArrangeSection />
				<template v-if="activeElement?.type === 'table'">
					<hr class="border-t" />
					<TableSection />
					<hr class="border-t" />
					<TableGridSection />
					<hr class="border-t" />
					<TableCellSection />
				</template>
				<template v-if="['text', 'table'].includes(activeElement?.type) || isEditingShapeText">
					<hr class="border-t" />
					<FontSection />
					<hr class="border-t" />
					<ParagraphSection />
				</template>
				<template v-if="activeElement?.type === 'shape' && !isEditingShapeText">
					<hr class="border-t" />
					<ShapeStyleSection />
				</template>
				<template v-if="activeElement?.type === 'image'">
					<hr class="border-t" />
					<ImageSection />
				</template>
				<template v-if="activeElement?.type === 'video'">
					<hr class="border-t" />
					<PlaybackSection />
				</template>
				<template v-if="['image', 'video'].includes(activeElement?.type)">
					<hr class="border-t" />
					<BorderSection :key="activeElement?.id" />
				</template>
				<template v-if="['image', 'video', 'shape'].includes(activeElement?.type)">
					<hr class="border-t" />
					<ShadowSection :key="activeElement?.id" />
				</template>
				<template v-if="activeElement">
					<hr class="border-t" />
					<AppearanceSection />
				</template>
			</div>
			<div v-else-if="currentSlide">
				<BackgroundSection />
				<hr class="border-t" />
				<TransitionSection />
			</div>
		</div>
	</div>
</template>

<script setup>
import { computed, provide } from 'vue'

import {
	activeElement,
	activeElementIds,
	focusElementId,
	isSelectionLocked,
	toggleLock,
} from '@/apps/slides/stores/element'
import { currentSlide } from '@/apps/slides/stores/slide'

import { labelClasses } from '@/apps/slides/utils/constants'

import FrameSection from './FrameSection.vue'
import ArrangeSection from './ArrangeSection.vue'
import AppearanceSection from './AppearanceSection.vue'
import TableSection from './TableSection.vue'
import TableCellSection from './TableCellSection.vue'
import TableGridSection from './TableGridSection.vue'
import FontSection from './FontSection.vue'
import ParagraphSection from './ParagraphSection.vue'
import ShapeStyleSection from './ShapeStyleSection.vue'
import ImageSection from './ImageSection.vue'
import PlaybackSection from './PlaybackSection.vue'
import BorderSection from './BorderSection.vue'
import ShadowSection from './ShadowSection.vue'
import BackgroundSection from './BackgroundSection.vue'
import TransitionSection from './TransitionSection.vue'

provide('sectionInert', isSelectionLocked)

const isEditingShapeText = computed(
	() => activeElement.value?.type === 'shape' && focusElementId.value === activeElement.value?.id,
)

const selectionLabel = computed(() => {
	const count = activeElementIds.value.length
	if (count > 1) return `${count} elements`
	const type = activeElement.value?.type
	return type ? type[0].toUpperCase() + type.slice(1) : ''
})

// size-6 keeps the hit area equal to the p-1 icon buttons in ButtonGroup
const lockClasses = computed(() => [
	'flex size-6 cursor-pointer items-center justify-center rounded-4 hover:bg-surface-gray-3',
	isSelectionLocked.value ? 'bg-surface-gray-3 text-ink-gray-7' : 'text-ink-gray-6',
])

const keepEditorFocus = (e) => {
	if (e.target.closest('input, textarea')) return
	e.preventDefault()
}
</script>
