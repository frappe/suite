<template>
	<!-- A row inside MobileSettingsCard. The card clips the corners and draws the
	     hairlines, so a row is only its own padding, press state and contents. -->
	<button
		class="active:bg-surface-gray-2 flex w-full items-center gap-3 p-3 text-base"
		type="button"
	>
		<slot name="leading">
			<component :is="icon" v-if="icon" class="size-4 shrink-0" :class="iconTint" />
		</slot>
		<span class="min-w-0 flex-1 truncate text-left" :class="labelTint">{{ label }}</span>
		<slot name="trailing" />
		<!-- A prop rather than the trailing slot's fallback: rows that put something else
		     there (a checkmark, nothing at all) would otherwise have to fight the default. -->
		<ChevronRight v-if="chevron" class="text-ink-gray-4 size-4 shrink-0" />
	</button>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import { ChevronRight } from 'lucide-vue-next'

const props = withDefaults(
	defineProps<{
		label: string
		icon?: Component | string
		chevron?: boolean
		theme?: 'gray' | 'red'
	}>(),
	{ chevron: true, theme: 'gray' },
)

const isRed = computed(() => props.theme === 'red')
// The icon sits a step back from the label in the gray rows, but a destructive row is
// red end to end.
const iconTint = computed(() => (isRed.value ? 'text-ink-red-6' : 'text-ink-gray-6'))
const labelTint = computed(() => (isRed.value ? 'text-ink-red-6' : 'text-ink-gray-8'))
</script>
