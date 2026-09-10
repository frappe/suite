<template>
	<CommandPaletteGroup
		v-if="suggestions.length"
		label="Suggestions"
		class="border-b border-outline-gray-1 pb-2"
	>
		<CommandPaletteItem
			v-for="suggestion in suggestions"
			:key="`${suggestion.resultType}-${suggestion.value}`"
			:value="suggestion"
		>
			<template #prefix>
				<Avatar
					v-if="suggestion.resultType === 'mail-contact'"
					:image="suggestion.user_image"
					:label="suggestion.name || suggestion.email"
					size="xs"
					class="mr-3 shrink-0"
				/>
				<span v-else class="mr-3 flex size-4 shrink-0 items-center justify-center text-ink-gray-7">
					<Icon :name="suggestion.icon" class="size-4" :class="suggestion.iconClass" />
				</span>
			</template>
			<span class="truncate">{{ suggestion.label }}</span>
			<template #suffix>
				<span
					v-if="suggestion.resultType === 'mail-contact' && suggestion.name"
					class="max-w-64 truncate text-ink-gray-5"
				>
					{{ suggestion.email }}
				</span>
			</template>
		</CommandPaletteItem>
	</CommandPaletteGroup>
</template>

<script setup lang="ts">
import { Avatar, Icon } from 'frappe-ui'
import { CommandPaletteGroup, CommandPaletteItem } from 'frappe-ui/experimental'
import type { MailContactSuggestion, MailFilterSuggestion } from './types'

defineProps<{
	suggestions: (MailContactSuggestion | MailFilterSuggestion)[]
}>()
</script>
