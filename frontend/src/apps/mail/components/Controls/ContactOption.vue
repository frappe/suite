<template>
	<!-- The scale's line-height is 1.15, so stacked lines sit all but flush. A list row wants that
	     tightness; the bigger, standalone form wants the two lines to read as one card. -->
	<div class="min-w-0" :class="{ 'space-y-0.5': size === 'md' }">
		<div class="text-ink-gray-8 truncate" :class="{ 'text-base': size === 'md' }">
			{{ contact.display_name || contact.email }}
		</div>
		<!-- Only worth a second line when the first one isn't already the address. -->
		<div
			v-if="contact.display_name"
			class="text-ink-gray-5 truncate"
			:class="size === 'md' ? 'text-sm' : 'text-xs'"
		>
			{{ contact.email }}
		</div>
	</div>
</template>

<script setup lang="ts">
import type { DraftRecipient } from '@/apps/mail/types'

// How a contact reads in any of the pickers — recipient autocomplete, the contacts
// combobox, `@` mentions. The address is the disambiguator between two people with
// the same name, so it stays visible under the name rather than replacing it.
//
// `md` is the same contact one size up, for somewhere it is the subject rather than one
// row of many: a chip's menu is about that person, so it leads with them. `sm` takes the
// name from whatever the row sets, which is how every picker has always sized it.
defineProps<{ contact: DraftRecipient; size?: 'sm' | 'md' }>()
</script>
