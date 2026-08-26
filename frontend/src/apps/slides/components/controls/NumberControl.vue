<template>
	<div :class="rowClasses" @mousedown="onRowMouseDown">
		<span v-if="label" :class="labelClasses">{{ label }}</span>
		<label :class="fieldClasses">
			<input
				ref="inputRef"
				:value="current"
				type="number"
				:min="min"
				:max="max"
				:step="step"
				:placeholder="placeholder"
				:disabled="disabled"
				:style="{ width: inputWidth }"
				:class="inputClasses"
				@input="onInput"
				@focus="onFocus"
				@blur="onBlur"
				@keydown="onArrowStep"
			/>
			<span v-if="suffix" :class="suffixClasses">{{ suffix }}</span>
		</label>
	</div>
	<Teleport to="body">
		<lucide-move-horizontal
			v-if="isScrubbing"
			class="pointer-events-none fixed z-[10000] size-5 -translate-x-1/2 -translate-y-1/2 text-white [filter:drop-shadow(0_0_1.5px_rgb(0_0_0/0.9))]"
			:style="cursorStyle"
		/>
	</Teleport>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useDragScrub } from '@/apps/slides/composables/useDragScrub'
import { labelClasses } from '@/apps/slides/utils/constants'

const model = defineModel({ type: Number })
const emit = defineEmits(['changeStart', 'changeEnd'])
const props = defineProps({
	label: String,
	maxDigits: Number,
	suffix: String,
	placeholder: {
		type: String,
		default: '',
	},
	min: Number,
	max: Number,
	step: {
		type: Number,
		default: 1,
	},
	disabled: Boolean,
	// a measured value rather than a stored one, dimmed so it reads as such
	derived: Boolean,
})

const live = ref(null)
const current = computed(() => (live.value !== null ? live.value : model.value))

const inputRef = ref(null)

function clamp(value) {
	if (props.min != null && value < props.min) return props.min
	if (props.max != null && value > props.max) return props.max
	return value
}

function snapToStep(value, step) {
	const decimals = (String(step).split('.')[1] || '').length
	return Number(value.toFixed(decimals))
}

function incrementFor(event) {
	if (event.shiftKey) return props.step * 10
	if (event.metaKey || event.altKey) return props.step / 10
	return props.step
}

function applyDelta(base, units, increment) {
	model.value = clamp(snapToStep(base + units * increment, increment))
}

function onInput(event) {
	live.value = event.target.value
}

function onChange() {
	if (live.value === null) return
	const parsed = parseFloat(live.value)
	live.value = null
	if (Number.isNaN(parsed)) return
	model.value = clamp(parsed)
}

function onFocus() {
	emit('changeStart')
}

function onBlur() {
	onChange()
	emit('changeEnd')
}

function onArrowStep(event) {
	if (event.key === 'Enter') {
		event.stopPropagation()
		inputRef.value?.blur()
		return
	}
	if (event.key === 'Escape') {
		event.stopPropagation()
		live.value = null
		inputRef.value?.blur()
		return
	}
	if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
	event.preventDefault()
	const typed = live.value !== null ? parseFloat(live.value) : Number(model.value)
	live.value = null
	const base = Number.isNaN(typed) ? 0 : typed
	const direction = event.key === 'ArrowUp' ? 1 : -1
	applyDelta(base, direction, incrementFor(event))
}

function onRowMouseDown(event) {
	if (event.target === inputRef.value) return
	startScrub(event)
}

let scrubStartValue = 0
const {
	isScrubbing,
	cursorStyle,
	start: startScrub,
} = useDragScrub({
	disabled: computed(() => props.disabled),
	onStart: () => {
		// Blur flushes any pending typed edit into model before we snapshot the base, and
		// must run before the first applyDelta so the whole scrub commits as one undo step.
		inputRef.value?.blur()
		scrubStartValue = Number(model.value) || 0
		emit('changeStart')
	},
	onStep: (steps, event) => applyDelta(scrubStartValue, steps, incrementFor(event)),
	onEnd: () => emit('changeEnd'),
})

const typography = 'align-middle font-text text-base'

const plainTextInput = [
	'border-none bg-transparent p-0 outline-none',
	'focus:outline-none focus:ring-0',
	'[appearance:textfield]',
	'[&::-webkit-inner-spin-button]:appearance-none',
	'[&::-webkit-outer-spin-button]:appearance-none',
]

const textColor = computed(() => {
	if (props.disabled) return 'text-ink-gray-4'
	return props.derived ? 'text-ink-gray-5' : 'text-ink-gray-7'
})

const rowClasses = computed(() => [
	'flex h-7 w-full items-center justify-between',
	props.disabled ? 'cursor-not-allowed' : 'cursor-ew-resize',
])

const fieldClasses = computed(() => [
	'inline-flex items-center gap-0.5 rounded-3 p-1',
	'focus-within:ring-1 focus-within:ring-outline-gray-3',
	props.disabled ? 'cursor-not-allowed' : 'cursor-text',
])

const inputClasses = computed(() => ['text-right', typography, textColor.value, plainTextInput])

const suffixClasses = computed(() => [typography, textColor.value])

const inputWidth = computed(() => {
	const isEmpty = current.value == null
	if (isEmpty && props.placeholder) {
		return `${props.placeholder.length}ch`
	}
	const text = String(current.value ?? '')
	const whole = text.split('.')[0]
	// the sign is not a digit, so maxDigits must not spend a slot on it
	const sign = whole.startsWith('-') ? 1 : 0
	const wholeDigits = whole.length - sign || 1
	const capped = props.maxDigits ? Math.min(wholeDigits, props.maxDigits) : wholeDigits
	const fractionDigits = text.length - whole.length
	return `${capped + sign + fractionDigits}ch`
})
</script>
