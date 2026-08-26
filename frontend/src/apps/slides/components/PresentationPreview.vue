<template>
	<div :class="previewOverlayClasses" @click="hidePreview()">
		<div class="absolute left-[calc(50%-31%)] z-20 flex w-[70%] justify-between" @click.stop>
			<div class="flex w-[88%] flex-col gap-8">
				<!-- Preview -->
				<router-link
					v-if="presentation"
					:to="{
						name: 'slides-editor',
						params: { presentationId: presentation?.name },
					}"
					class="aspect-video cursor-pointer rounded-8 bg-white shadow-2xl"
					:style="previewStyles"
				></router-link>

				<!-- Details -->
				<div class="flex cursor-default flex-col gap-2 px-2 text-sm lg:text-base">
					<div
						v-for="(row, index) in previewDetails"
						:key="index"
						class="flex items-center justify-between"
					>
						<div
							v-for="(detailValue, detailLabel) in row"
							:key="detailLabel"
							class="flex items-center gap-2"
						>
							<div class="font-medium text-ink-gray-8">{{ detailLabel }}</div>
							<div class="font-medium text-ink-gray-6">{{ detailValue }}</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Actions -->
			<div class="flex w-[8%] flex-col gap-3 pt-[30%]">
				<Tooltip
					v-for="action in presentationActions"
					:text="action.label"
					:hover-delay="0.3"
					side="right"
				>
					<div :class="getActionButtonClasses(action.label)" @click="action.onClick">
						<component
							:is="action.icon"
							size="16"
							:class="getActionIconClasses(action.label)"
						/>
					</div>
				</Tooltip>
			</div>
		</div>

		<div class="absolute bottom-0 left-0 h-[53%] w-full bg-surface-base" @click.stop></div>
	</div>
</template>

<script setup>
import { computed } from 'vue'

import { Tooltip } from 'frappe-ui'

import { Presentation, Copy, PenLine, Trash } from 'lucide-vue-next'

import dayjs from '@/apps/slides/utils/dayjs'
import { getThumbnailCardStyles } from '@/apps/slides/utils/helpers'

const props = defineProps({
	presentation: Object,
	required: true,
})

const emit = defineEmits(['setPreview', 'openDialog', 'navigate', 'duplicatePresentation'])

const previewOverlayClasses = computed(() => {
	const baseClasses =
		'absolute left-0 size-full transition-all duration-300 ease-in-out flex items-center backdrop-blur-[1px] bg-black-overlay-200'
	if (props.presentation) {
		return `${baseClasses} top-0`
	}
	return `${baseClasses} top-[100%]`
})

const getActionButtonClasses = (action) => {
	const baseClasses = 'size-8 flex items-center justify-center rounded-4 cursor-pointer'
	if (action === 'Present') {
		return `${baseClasses} bg-surface-gray-10`
	}
	return `${baseClasses} bg-surface-gray-2`
}

const getActionIconClasses = (action) => {
	const baseClasses = 'stroke-[1.5]'
	if (action === 'Present') {
		return `${baseClasses} text-ink-base`
	}
	return `${baseClasses} text-ink-gray-7`
}

const previewStyles = computed(() => {
	return getThumbnailCardStyles(props.presentation.thumbnail, props.presentation)
})

const previewDetails = computed(() => {
	if (!props.presentation) return {}

	const { title, creation, modified, modified_by, owner } = props.presentation

	return [
		{
			Title: title,
			[`Modified by ${modified_by}`]: dayjs(modified).fromNow(),
		},
		{
			'Total Slides': props.presentation.slide_count,
			[`Created by ${owner}`]: dayjs(creation).fromNow(),
		},
	]
})

const presentationActions = [
	{
		icon: Presentation,
		label: 'Present',
		onClick: (e) => emit('navigate', props.presentation.name, true),
	},
	{
		icon: PenLine,
		label: 'Rename',
		onClick: (e) => emit('openDialog', 'Rename'),
	},
	{
		icon: Copy,
		label: 'Duplicate',
		onClick: (e) => emit('duplicatePresentation', props.presentation.name),
	},
	{
		icon: Trash,
		label: 'Delete',
		onClick: (e) => emit('openDialog', 'Delete'),
	},
]

const hidePreview = () => {
	emit('setPreview', null)
}
</script>
