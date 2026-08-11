<template>
	<Popover @open="syncCurrentColor">
		<template #target="{ togglePopover, isOpen }">
			<div
				class="me-0.5 size-4 cursor-pointer rounded-sm ring-[1.5px] ring-outline-gray-2 ring-offset-1"
				:style="{ backgroundColor: currentColor }"
				@click="handleColorPickerClick(togglePopover, isOpen)"
			></div>
		</template>
		<template #body>
			<div class="m-2 rounded-lg border bg-surface-elevation-2 p-3 shadow-xl">
				<div class="flex flex-col gap-3">
					<div
						ref="shadeSlider"
						class="cursor-pointer rounded-t shadow-xl"
						:style="shadeStyles"
						@mousedown="handleUpdateShade"
					>
						<div
							class="relative size-3 rounded border shadow-md transition-transform duration-200 ease-in-out hover:scale-[1.2]"
							:style="shadeRectStyles"
						></div>
					</div>
					<div class="flex h-8 justify-between py-1">
						<div
							class="h-full w-6 rounded-sm ring-1 ring-outline-gray-1 ring-offset-1"
							:style="{ backgroundColor: currentColor }"
						></div>
						<div class="flex flex-col justify-between px-1">
							<div
								ref="colorSlider"
								:class="sliderClasses"
								:style="colorSliderStyles"
								@mousedown="handleUpdateHue"
							>
								<div
									:class="sliderCursorClasses"
									:style="{ left: hueCursorLeft, top: '-0.25rem' }"
								></div>
							</div>
							<div
								ref="opacitySlider"
								:class="sliderClasses"
								:style="opacitySliderStyles"
								@mousedown="handleUpdateOpacity"
							>
								<div
									:class="sliderCursorClasses"
									:style="{ left: opacityCursorLeft, top: '-0.25rem' }"
								></div>
							</div>
						</div>
					</div>
					<div class="flex items-center gap-2">
						<Input
							:key="revertKey"
							type="text"
							placeholder="Set Color"
							:aria-label="'Hex color input'"
							:value="getDisplayColor()"
							class="max-w-[94px] border-none text-sm"
							@update:modelValue="
								(val) => {
									setColor(val)
								}
							"
							@keydown.enter.prevent.stop="(e) => e.target.blur()"
							@click="handleColorInputClick"
						/>

						<div class="flex justify-center">
							<Button
								@click="handleClipboardCopy"
								class="flex items-center justify-center rounded text-ink-gray-6 transition-colors hover:bg-surface-gray-3"
								title="Copy Color"
							>
								<LucideClipboard class="size-3.5 text-ink-gray-7" />
							</Button>
						</div>

						<div class="flex justify-center">
							<Button
								v-if="isSupported"
								@click="openEyeDropper"
								class="flex items-center justify-center rounded transition-colors hover:bg-surface-gray-3"
								title="Pick color from screen"
							>
								<EyeDropper class="size-3.5 text-ink-gray-7" />
							</Button>
						</div>
					</div>
				</div>
			</div>
		</template>
	</Popover>
</template>

<script setup>
import { ref, unref, computed, useTemplateRef, watch } from 'vue'
import { useElementBounding, useEyeDropper } from '@vueuse/core'

import { Button, Popover, Input } from 'frappe-ui'

import { copyToClipboard } from '@/apps/slides/stores/copyPaste'
import EyeDropper from '@/apps/slides/icons/EyeDropper.vue'

import tinycolor from 'tinycolor2'
import opacityCheckered from '@/apps/slides/assets/opacityCheckered.png'

const shadeSlider = useTemplateRef('shadeSlider')
const colorSlider = useTemplateRef('colorSlider')

let colorRect = useElementBounding(colorSlider)
let shadeRect = useElementBounding(shadeSlider)

// EyeDropper functionality
const { isSupported, sRGBHex, open } = useEyeDropper()

const SLIDER_WIDTH = 125
const SHADE_RECT_WIDTH = 170
const SHADE_RECT_HEIGHT = 130

const sliderClasses = 'h-1/5 rounded cursor-pointer'
const sliderCursorClasses =
	'relative size-[0.8rem] rounded shadow border border-outline-gray-2 bg-white hover:scale-[1.1] transition-transform duration-200 ease-in-out'

const currentColor = defineModel()

const emit = defineEmits(['colordown', 'colorup', 'update:modelValue'])

const currentHue = ref()
const currentOpacity = ref()

const revertKey = ref(0)

const colorHue = ref(0)
const colorSaturation = ref()
const colorValue = ref()

const shadeStyles = computed(() => {
	return {
		background: `linear-gradient(transparent, black), linear-gradient(to right, white, ${currentHue.value})`,
		width: `${SHADE_RECT_WIDTH}px`,
		height: `${SHADE_RECT_HEIGHT}px`,
	}
})

const colorSliderStyles = computed(() => {
	return {
		width: `${SLIDER_WIDTH}px`,
		background: `linear-gradient(to right, rgb(255, 0, 0), rgb(255, 0, 255), rgb(0, 0, 255), rgb(0, 255, 255), rgb(0, 255, 0), rgb(255, 255, 0), rgb(255, 0, 0))`,
	}
})

const opacitySliderStyles = computed(() => ({
	backgroundImage: `linear-gradient(to right, rgb(0, 0, 0, 0), ${currentHue.value}), url('${opacityCheckered}')`,
	backgroundSize: 'cover',
	backgroundPosition: 'center',
	backgroundRepeat: 'no-repeat',
}))

const shadeRectStyles = computed(() => {
	return {
		backgroundColor: currentColor.value,
		left: shadeCursorLeft.value,
		top: shadeCursorTop.value,
	}
})

const handleUpdateHue = (e) => {
	emit('colordown')
	updateHue(e)
	window.addEventListener('mousemove', updateHue)
	window.addEventListener('mouseup', endUpdateHue)
}

const hueCursorLeft = computed(() => {
	return `${SLIDER_WIDTH - (colorHue.value / 360) * SLIDER_WIDTH - 6}px`
})

const opacityCursorLeft = computed(() => {
	return `${currentOpacity.value * SLIDER_WIDTH - 6}px`
})

const shadeCursorLeft = computed(() => {
	return `${colorSaturation.value * SHADE_RECT_WIDTH - 6}px`
})

const shadeCursorTop = computed(() => {
	return `${(1 - colorValue.value) * SHADE_RECT_HEIGHT - 6}px`
})

const updateHue = (e) => {
	e.preventDefault()
	const clientX = e.clientX - unref(colorRect.left)

	const x = Math.min(Math.max(clientX, 0), SLIDER_WIDTH)
	colorHue.value = 360 - (360 * x) / SLIDER_WIDTH

	// set currentHue with full saturation and 50% lightness
	currentHue.value = tinycolor({ h: colorHue.value, s: 1, l: 0.5 })

	// update currentColor based on exact hue, saturation, and value
	currentColor.value = tinycolor
		.fromRatio({
			h: colorHue.value,
			s: colorSaturation.value * 100,
			v: colorValue.value * 100,
			a: currentOpacity.value,
		})
		.toHex8String()
}

const endUpdateHue = (e) => {
	emit('colorup')
	window.removeEventListener('mousemove', updateHue)
	window.removeEventListener('mouseup', endUpdateHue)
}

const handleUpdateShade = (e) => {
	emit('colordown')
	updateShade(e)
	window.addEventListener('mousemove', updateShade)
	window.addEventListener('mouseup', endUpdateShade)
}

const updateShade = (e) => {
	e.preventDefault()

	const clientX = e.clientX - unref(shadeRect.left)
	const clientY = e.clientY - unref(shadeRect.top)

	const x = Math.min(Math.max(clientX, 0), SHADE_RECT_WIDTH)
	const y = Math.min(Math.max(clientY, 0), SHADE_RECT_HEIGHT)

	colorSaturation.value = x / SHADE_RECT_WIDTH
	colorValue.value = 1 - y / SHADE_RECT_HEIGHT

	currentColor.value = tinycolor({
		h: colorHue.value,
		s: colorSaturation.value * 100,
		v: colorValue.value * 100,
		a: currentOpacity.value,
	}).toHex8String()
}

const endUpdateShade = (e) => {
	emit('colorup')
	window.removeEventListener('mousemove', updateShade)
	window.removeEventListener('mouseup', endUpdateShade)
}

const handleUpdateOpacity = (e) => {
	emit('colordown')
	updateOpacity(e)
	window.addEventListener('mousemove', updateOpacity)
	window.addEventListener('mouseup', endUpdateOpacity)
}

const updateOpacity = (e) => {
	e.preventDefault()

	const clientX = e.clientX - unref(colorRect.left)

	const x = Math.min(Math.max(clientX, 0), SLIDER_WIDTH)

	currentOpacity.value = x / SLIDER_WIDTH
	currentColor.value = tinycolor(currentColor.value).setAlpha(currentOpacity.value).toHex8String()
}

const endUpdateOpacity = (e) => {
	emit('colorup')
	window.removeEventListener('mousemove', updateOpacity)
	window.removeEventListener('mouseup', endUpdateOpacity)
}

const syncCurrentColor = () => {
	const initialHsv = tinycolor(currentColor.value).toHsv()

	colorHue.value = initialHsv.h
	colorSaturation.value = initialHsv.s
	colorValue.value = initialHsv.v
	currentOpacity.value = initialHsv.a

	currentHue.value = tinycolor({ h: colorHue.value, s: 1, l: 0.5 })
}

const openEyeDropper = async () => {
	try {
		await open()
	} catch (error) {
		console.error('Error opening eyedropper:', error)
	}
}

// Watch for eyedropper color changes
watch(sRGBHex, (newColor) => {
	if (newColor) {
		setColor(newColor)
	}
})

const setColor = (newColor) => {
	const parsed = tinycolor(newColor)
	if (!parsed.isValid()) {
		revertKey.value++
		return
	}

	// keep the slider's transparency unless the typed value carries its own alpha
	if (parsed.getAlpha() === 1 && currentOpacity.value < 1) {
		parsed.setAlpha(currentOpacity.value)
	}

	emit('colordown')
	currentColor.value = parsed.toHex8String()
	const initialHsv = parsed.toHsv()
	colorHue.value = initialHsv.h
	colorSaturation.value = initialHsv.s
	colorValue.value = initialHsv.v
	currentOpacity.value = initialHsv.a
	currentHue.value = tinycolor({ h: colorHue.value, s: 1, l: 0.5 })
	emit('colorup')

	// remount the input so the display re-syncs to the normalized value
	revertKey.value++
}

const getDisplayColor = () => {
	if (!currentColor.value) return ''
	return tinycolor(currentColor.value).toHexString().toUpperCase()
}

const handleClipboardCopy = () => {
	copyToClipboard(getDisplayColor())
}

const handleColorInputClick = (e) => {
	e.target.select()
}

const handleColorPickerClick = (togglePopover, isOpen) => {
	if (!isOpen) syncCurrentColor()
	togglePopover()
}

watch(
	() => currentColor.value,
	(newColor) => {
		syncCurrentColor()
	},
)
</script>
