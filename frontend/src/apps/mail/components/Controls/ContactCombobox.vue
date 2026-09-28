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
			<ContactOption :contact="item" />
		</template>
		<template #item-create="{ query }"> {{ query }} </template>
	</Combobox>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { Avatar, Combobox, createResource } from 'frappe-ui'

import ContactOption from '@/apps/mail/components/Controls/ContactOption.vue'
import { userStore } from '@/apps/mail/stores/user'

// Self-contained contact-autocomplete combobox: searches contacts as you type (Avatar + name over email)
// and offers a "use what you typed" create row for a value that isn't a contact.
//
// `account` is whose address book to look in. It defaults to the mail account in view, which is
// what every caller inside mail wants; a caller from another app — the calendar's search filters,
// say — passes its own, since the two apps number their accounts separately. The mail store is
// only reached for when the default is the one in use: outside mail there may be none to reach.
const props = defineProps<{ label: string; account?: string }>()
const model = defineModel<string>()

let mailUser: ReturnType<typeof userStore> | undefined
const searchAccount = () => props.account ?? (mailUser ??= userStore()).accountId

const contactSearch = createResource({
	url: 'suite.mail.api.mail.get_email_suggestions',
	auto: false,
	makeParams: (text: string) => ({
		account: searchAccount(),
		text,
	}),
	transform: (data: { email: string; name?: string; user_image?: string }[]) =>
		data.map((o) => {
			const name = o.name || ''
			return {
				value: o.email,
				label: name || o.email,
				email: o.email,
				display_name: name,
				image: o.user_image,
			}
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
