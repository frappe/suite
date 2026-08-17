<template>
	<div class="flex shrink-0 flex-col rounded-4 border">
		<div class="h-13 py-auto flex shrink-0 items-center justify-between border-b px-4">
			<h2>{{ title }}</h2>
			<slot name="actions">
				<!-- Default action renders only when the parent listens for @action,
				     so read-only cards get a plain header with no extra markup. -->
				<Button
					v-if="hasActionListener"
					variant="ghost"
					:label="buttonLabel"
					@click="emit('action')"
				/>
			</slot>
		</div>
		<slot />
	</div>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance } from 'vue'
import { Button } from 'frappe-ui'

const { buttonLabel = __('Add') } = defineProps<{ title: string; buttonLabel?: string }>()

const emit = defineEmits(['action'])

const hasActionListener = computed(() => !!getCurrentInstance()?.vnode.props?.onAction)
</script>
