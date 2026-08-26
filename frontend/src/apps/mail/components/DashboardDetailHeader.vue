<template>
	<div class="flex flex-wrap items-center gap-x-4 gap-y-3">
		<div
			class="bg-surface-gray-2 text-ink-gray-6 flex h-11 w-11 shrink-0 items-center justify-center rounded-6"
		>
			<slot name="icon">
				<span class="text-md font-semibold uppercase">{{ initial }}</span>
			</slot>
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex min-w-0 items-center gap-2">
				<h1 class="text-ink-gray-9 truncate text-lg font-semibold leading-6">{{ title }}</h1>
				<Badge v-if="badgeLabel" :label="badgeLabel" :theme="badgeTheme" />
			</div>
			<div
				v-if="metaItems.length"
				class="text-ink-gray-5 mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm"
			>
				<template v-for="(item, index) in metaItems" :key="index">
					<span v-if="index" class="text-ink-gray-4">·</span>
					<span class="truncate">{{ item }}</span>
				</template>
			</div>
		</div>
		<div class="flex shrink-0 items-center gap-2">
			<slot name="actions" />
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from 'frappe-ui'

const { title, meta = [] } = defineProps<{
	title: string
	// Short facts shown under the title, separated by dots. Falsy entries are
	// dropped so callers can pass optional fields without guarding each one.
	meta?: (string | undefined | null)[]
	badgeLabel?: string
	badgeTheme?: 'green' | 'red' | 'gray' | 'amber' | 'blue' | 'violet'
}>()

const initial = computed(() => title.trim().charAt(0) || '?')

const metaItems = computed(() => meta.filter(Boolean) as string[])
</script>
