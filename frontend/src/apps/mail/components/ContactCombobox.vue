<template>
	<Combobox
		v-model="model"
		v-model:open="showSuggestions"
		:label="label"
		:options="options"
		placeholder=""
		:open-on-click="false"
		@update:query="search"
	>
		<template #item-prefix="{ item, query }">
			<Avatar :image="item.image" :label="item.label || query" size="sm" />
		</template>
		<template #item-label="{ item }">
			<div class="truncate">{{ item.display_name || item.email }}</div>
			<div v-if="item.display_name" class="text-ink-gray-5 truncate text-xs">{{ item.email }}</div>
		</template>
		<template #item-create="{ query }"> {{ query }} </template>
	</Combobox>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { Avatar, Combobox, createResource } from 'frappe-ui'

import { userStore } from '@/apps/mail/stores/user'

// Self-contained contact-autocomplete combobox: searches contacts as you type (Avatar + name over email)
// and offers a "use what you typed" create row for a value that isn't a contact.
defineProps<{ label: string }>()
const model = defineModel<string>()

const store = userStore()

const contactSearch = createResource({
	url: 'suite.mail.api.mail.get_email_suggestions',
	auto: false,
	makeParams: (text: string) => ({
		account: store.accountId,
		text,
	}),
	transform: (data: { email: string; name?: string; user_image?: string }[]) =>
		data.map((o) => {
			const name = o.name || ''
			return { value: o.email, label: name || o.email, email: o.email, display_name: name, image: o.user_image }
		}),
})
const searchText = ref('')
const showSuggestions = ref(false)

const fetchSuggestions = useDebounceFn((text: string) => {
	if (text) contactSearch.fetch(text)
}, 300)

const search = (text: string) => {
	searchText.value = text
	if (!text) showSuggestions.value = false
	fetchSuggestions(text)
}

// Suggestions only exist for a typed query — with an empty input the popover
// would show stale results from the previous query (or a bare "No results"
// panel), so block reka's focus/arrow-key opens too, not just hide options.
watch(showSuggestions, (open) => {
	if (open && !searchText.value) showSuggestions.value = false
})

// Contact matches plus a "create" entry (like compose's RecipientInput) so a typed value that isn't a
// contact can still be applied.
const options = computed(() => {
	if (!searchText.value) return []
	return [
		...(contactSearch.data ?? []),
		{
			type: 'custom',
			slot: 'create',
			condition: () => !contactSearch.data?.length,
			onClick: ({ query }: { query: string }) => {
				model.value = query
			},
		},
	]
})
</script>
