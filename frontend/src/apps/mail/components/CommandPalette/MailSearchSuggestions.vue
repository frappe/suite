<template>
	<CommandPaletteGroup v-if="suggestions.length">
		<!-- A contact reads here as it reads in every picker — the avatar the combobox draws,
		     the name over the address — rather than as one line with the address pushed to the
		     far end. The label has to fill the row for the address to truncate against its
		     width rather than against its own words. -->
		<CommandPaletteItem
			v-for="suggestion in suggestions"
			:key="`${suggestion.resultType}-${suggestion.value}`"
			:value="suggestion"
			:class="
				suggestion.resultType === 'mail-contact' &&
				'[&_[data-slot=command-palette-item-label]]:flex-1'
			"
		>
			<template #prefix>
				<Avatar
					v-if="suggestion.resultType === 'mail-contact'"
					:image="suggestion.user_image"
					:label="suggestion.name || suggestion.email"
					:size="roomy ? 'lg' : 'sm'"
					class="mr-3 shrink-0"
				/>
				<span
					v-else
					class="mr-3 flex shrink-0 items-center justify-center text-ink-gray-7"
					:class="roomy ? 'size-5' : 'size-4'"
				>
					<Icon
						:name="suggestion.icon"
						:class="[roomy ? 'size-5' : 'size-4', suggestion.iconClass]"
					/>
				</span>
			</template>
			<ContactOption
				v-if="suggestion.resultType === 'mail-contact'"
				:contact="{ email: suggestion.email, display_name: suggestion.name }"
			/>
			<span v-else class="truncate">{{ suggestion.label }}</span>
		</CommandPaletteItem>
	</CommandPaletteGroup>
</template>

<script setup lang="ts">
import { Avatar } from 'frappe-ui'
import {
	CommandPaletteGroup,
	CommandPaletteItem,
	Icon,
} from 'frappe-ui/experimental'
import ContactOption from '@/apps/mail/components/Controls/ContactOption.vue'
import type { MailContactSuggestion, MailFilterSuggestion } from './types'

defineProps<{
	suggestions: (MailContactSuggestion | MailFilterSuggestion)[]
	/**
	 * A phone's list, not the palette's: the avatar two sizes up and the folder glyph at the 20px
	 * the app draws its mobile icons at. In the dialog, under a query line, the smaller pair
	 * is the right density; on a page that is nothing but the list, they read as specks.
	 */
	roomy?: boolean
}>()
</script>
