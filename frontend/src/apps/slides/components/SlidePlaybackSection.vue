<template>
	<Section label="Playback">
		<PropertyRow label="Advance">
			<Select
				:modelValue="advancesAutomatically ? 'after delay' : 'on click'"
				variant="ghost"
				:options="advanceOptions"
				class="-me-1"
				@update:modelValue="setAdvance"
			>
				<template #trigger="{ selectedOption }">
					<span :class="selectValueClasses">{{ selectedOption?.label }}</span>
					<span :class="chevronClasses" />
				</template>
			</Select>
		</PropertyRow>

		<NumberControl
			v-if="advancesAutomatically"
			:modelValue="parseFloat(currentSlide.advanceAfter)"
			:label="waitsForVideo ? 'Delay after video' : 'Delay'"
			suffix="s"
			:min="1"
			:max="3600"
			:max-digits="4"
			@update:modelValue="delay.set"
			@change-start="delay.begin"
			@change-end="delay.commit"
		/>

		<Button class="w-full" label="Apply to all slides" @click="applyToAllSlides">
			<template #prefix>
				<lucide-check-check class="size-3.5 stroke-[1.5]" />
			</template>
		</Button>
	</Section>
</template>

<script setup>
import { computed } from 'vue'

import { Button, Select, toast } from 'frappe-ui'

import PropertyRow from '@/apps/slides/components/controls/PropertyRow.vue'
import NumberControl from '@/apps/slides/components/controls/NumberControl.vue'
import Section from '@/apps/slides/components/controls/Section.vue'
import { chevronClasses, selectValueClasses } from '@/apps/slides/utils/constants'

import { slides, currentSlide } from '@/apps/slides/stores/slide'
import { editSlideCommand } from '@/apps/slides/stores/commands'
import { pushSlideCommands, useSlideProperty } from '@/apps/slides/composables/editProperty'

const DEFAULT_DELAY = 5

const advanceOptions = [
	{ label: 'On click', value: 'on click' },
	{ label: 'After delay', value: 'after delay' },
]

const delay = useSlideProperty('advanceAfter')

const advancesAutomatically = computed(() => parseFloat(currentSlide.value.advanceAfter) > 0)

const waitsForVideo = computed(() =>
	currentSlide.value.elements.some((element) => element.type === 'video' && !element.loop),
)

const setAdvance = (option) => {
	const automatically = option == 'after delay'
	if (automatically === advancesAutomatically.value) return
	delay.begin()
	delay.set(automatically ? DEFAULT_DELAY : null)
	delay.commit()
}

const applyToAllSlides = () => {
	const sourceSlide = currentSlide.value
	const commands = slides.value
		.filter((slide) => slide.advanceAfter != sourceSlide.advanceAfter)
		.map((slide) =>
			editSlideCommand({
				slideId: slide.clientId,
				property: 'advanceAfter',
				oldValue: slide.advanceAfter,
				newValue: sourceSlide.advanceAfter,
			}),
		)

	pushSlideCommands(commands)

	const seconds = parseFloat(sourceSlide.advanceAfter)
	const timing = advancesAutomatically.value ? `after ${seconds}s` : 'on click'
	toast.success(`All slides advance ${timing}`)
}
</script>
