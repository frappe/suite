<template>
	<div
		class="no-scrollbar flex h-full w-72 flex-col overflow-y-auto border-l bg-surface-base px-4"
		@mousedown="keepEditorFocus"
	>
		<div v-if="activeElementIds.length">
			<PositionSection />
			<Divider flexItem />
			<LayoutSection />
			<Divider flexItem />
			<ElementSection />
			<template v-if="activeElement?.type === 'text' || isEditingShapeText">
				<Divider flexItem />
				<TypographySection />
				<Divider flexItem />
				<ParagraphSection />
				<Divider flexItem />
				<SpacingSection />
			</template>
			<template v-if="activeElement?.type === 'shape' && !isEditingShapeText">
				<Divider flexItem />
				<ShapeStyleSection />
			</template>
			<template v-if="activeElement?.type === 'image'">
				<Divider flexItem />
				<ImageSection />
			</template>
			<template v-if="activeElement?.type === 'video'">
				<Divider flexItem />
				<PlaybackSection />
			</template>
			<template v-if="['image', 'video'].includes(activeElement?.type)">
				<Divider flexItem />
				<BorderSection :key="activeElement?.id" />
			</template>
			<template v-if="['image', 'video', 'shape'].includes(activeElement?.type)">
				<Divider flexItem />
				<ShadowSection :key="activeElement?.id" />
			</template>
			<template v-if="activeElement">
				<Divider flexItem />
				<AppearanceSection />
			</template>
		</div>
		<div v-else-if="currentSlide">
			<BackgroundSection />
			<Divider flexItem />
			<TransitionSection />
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
} from '@/apps/slides/stores/element'
import { currentSlide } from '@/apps/slides/stores/slide'

import { Divider } from 'frappe-ui'

import PositionSection from './PositionSection.vue'
import LayoutSection from './LayoutSection.vue'
import ElementSection from './ElementSection.vue'
import AppearanceSection from './AppearanceSection.vue'
import TypographySection from './TypographySection.vue'
import ParagraphSection from './ParagraphSection.vue'
import SpacingSection from './SpacingSection.vue'
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

const keepEditorFocus = (e) => {
	if (e.target.closest('input, textarea')) return
	e.preventDefault()
}
</script>
