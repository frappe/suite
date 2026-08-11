<template>
	<Section label="Transition">
		<Button v-if="!hasTransition" class="w-full" label="Add transition" @click="addTransition">
			<template #prefix>
				<lucide-plus class="size-3.5 stroke-[1.5]" />
			</template>
		</Button>

		<template v-else>
			<PropertyRow label="Type">
				<Select
					:modelValue="currentSlide.transition"
					variant="ghost"
					:options="transitionOptions"
					class="-me-1"
					@update:modelValue="setSlideTransition"
				>
					<template #trigger="{ selectedOption }">
						<span :class="valueClasses">{{ selectedOption?.label }}</span>
						<span :class="chevronClasses" />
					</template>
				</Select>
			</PropertyRow>

			<NumberControl
				:modelValue="parseFloat(currentSlide.transitionDuration) || 0"
				label="Duration"
				suffix="s"
				:min="0"
				:max="4"
				:max-digits="1"
				:step="0.1"
				@update:modelValue="duration.set"
				@change-start="duration.begin"
				@change-end="duration.commit"
			/>

			<PropertyRow v-if="currentSlide.transition == 'Magic Move'" label="Fade unmatched">
				<Checkbox
					size="sm"
					class="cursor-pointer"
					:modelValue="currentSlide.fadeUnmatchedElements"
					@update:modelValue="setFadeUnmatched"
				/>
			</PropertyRow>

			<div class="flex w-full items-center gap-2">
				<Button title="Remove transition" @click="removeTransition">
					<template #icon>
						<lucide-trash-2 class="size-3.5 stroke-[1.5]" />
					</template>
				</Button>

				<Button class="flex-1" label="Apply to all slides" @click="applyTransitionToAllSlides">
					<template #prefix>
						<lucide-check-check class="size-3.5 stroke-[1.5]" />
					</template>
				</Button>
			</div>
		</template>
	</Section>
</template>

<script setup>
import { computed } from 'vue'

import { Button, Select, Checkbox, toast } from 'frappe-ui'

import PropertyRow from '@/apps/slides/components/controls/PropertyRow.vue'
import NumberControl from '@/apps/slides/components/controls/NumberControl.vue'
import Section from '@/apps/slides/components/controls/Section.vue'
import { chevronClasses } from '@/apps/slides/utils/constants'

import { slides, slideIndex, currentSlide } from '@/apps/slides/stores/slide'
import { getCommandsToSetTransition } from '@/apps/slides/stores/transition'
import { editSlideCommand, batchCommand } from '@/apps/slides/stores/commands'
import { commandHistory } from '@/apps/slides/stores/historyMeta'
import { useSlideProperty } from '@/apps/slides/composables/editProperty'

const duration = useSlideProperty('transitionDuration')

const transitionOptions = [
	{ label: 'Magic Move', value: 'Magic Move' },
	{ label: 'Fade', value: 'Fade' },
	{ label: 'Slide In', value: 'Slide In' },
]

const hasTransition = computed(
	() => currentSlide.value.transition && currentSlide.value.transition != 'None',
)

const addTransition = () => setSlideTransition('Fade')

const removeTransition = () => setSlideTransition('None')

const setSlideTransition = (option) => {
	const slide = currentSlide.value
	const commands = getCommandsToSetTransition(slide, slideIndex.value, {
		transition: option,
		transitionDuration: option == 'None' ? 0 : 1,
		fadeUnmatchedElements: option == 'Magic Move',
	})

	commandHistory.execute(
		batchCommand({
			slideId: slide.clientId,
			elementIds: [],
			commands,
		}),
	)
}

const setFadeUnmatched = (value) => {
	if (Boolean(value) === Boolean(currentSlide.value.fadeUnmatchedElements)) return
	commandHistory.execute(
		editSlideCommand({
			slideId: currentSlide.value.clientId,
			property: 'fadeUnmatchedElements',
			oldValue: currentSlide.value.fadeUnmatchedElements,
			newValue: value,
		}),
	)
}

const applyTransitionToAllSlides = () => {
	const sourceSlide = currentSlide.value
	const commands = []

	slides.value.forEach((slide, index) => {
		if (index === slideIndex.value) return
		commands.push(
			...getCommandsToSetTransition(slide, index, {
				transition: sourceSlide.transition,
				transitionDuration: sourceSlide.transitionDuration,
				fadeUnmatchedElements: sourceSlide.fadeUnmatchedElements,
			}),
		)
	})

	commandHistory.execute(
		batchCommand({
			slideId: sourceSlide.clientId,
			elementIds: [],
			commands,
		}),
	)

	toast.success('Applied transition to all slides')
}

const valueClasses = 'block text-right font-text text-base text-ink-gray-7'
</script>
