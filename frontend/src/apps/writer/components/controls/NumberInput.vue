<template>
  <div class="flex h-7 w-full items-center justify-between rounded-4 border bg-gray-50/80">
    <div v-if="prefix" class="w-1/2 text-center text-xs-medium text-gray-500">
      {{ prefix }}
    </div>
    <input
      type="number"
      :class="inputClasses"
      :value="Math.round(modelValue)"
      :placeholder
      @change="changeValue"
    />
    <div v-if="suffix" class="w-1/2 text-center text-xs-medium text-gray-500">
      {{ suffix }}
    </div>
    <div v-if="!hideButtons" class="flex h-full w-12 flex-col border-l">
      <button
        class="flex h-1/2 cursor-pointer items-center justify-center rounded-tr-4 border-b bg-white hover:bg-gray-200"
        @click="updateValue('increment')"
      >
        <LucideChevronUp class="size-3" />
      </button>
      <button
        class="flex h-1/2 cursor-pointer items-center justify-center rounded-br-4 bg-white hover:bg-gray-200"
        @click="updateValue('decrement')"
      >
        <LucideChevronDown class="size-3" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import LucideChevronDown from '~icons/lucide/chevron-down'
import LucideChevronUp from '~icons/lucide/chevron-up'

const props = defineProps({
  prefix: String,
  suffix: String,
  rangeStart: Number,
  rangeEnd: Number,
  placeholder: String,
  rangeStep: {
    type: Number,
    default: 1,
  },
  hideButtons: {
    type: Boolean,
    default: false,
  },
})

const modelValue = defineModel()

const inputClasses = computed(() => {
  let baseClasses =
    'size-full border-none p-0 text-center text-xs font-medium text-gray-800 focus:border-none focus:outline-none focus:ring-0'
  if (props.hideButtons) baseClasses += ' rounded-r-4'
  if (props.prefix) return `${baseClasses}`
  else return `${baseClasses} rounded-l-4`
})

const changeValue = (e) => {
  let value = parseFloat(e.target.value)
  if (value < props.rangeStart) {
    modelValue.value = props.rangeStart
  } else if (value > props.rangeEnd) {
    modelValue.value = props.rangeEnd
  } else {
    modelValue.value = value
  }
}

const updateValue = (change) => {
  if (change == 'increment') {
    modelValue.value = Math.min(modelValue.value + props.rangeStep, props.rangeEnd)
  } else if (change == 'decrement') {
    modelValue.value = Math.max(modelValue.value - props.rangeStep, props.rangeStart)
  }
}
</script>

<style scoped>
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

input[type='number'] {
  -moz-appearance: textfield;
}
</style>
