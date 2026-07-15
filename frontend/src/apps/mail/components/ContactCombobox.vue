<template>
	<Combobox
		v-model="model"
		:label="label"
		:options="options"
		placeholder=""
		:open-on-click="false"
		@input="search"
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
import { computed } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { Avatar, Combobox, createResource } from 'frappe-ui'

import { userStore } from '@/apps/mail/stores/user'

// Self-contained contact-autocomplete combobox: searches contacts as you type (Avatar + name over email)
// and offers a "use what you typed" create row for a value that isn't a contact.
defineProps<{ label: string }>()
const model = defineModel<string>()

const store = userStore()

const contactSearch = createResource({
	url: 'suite.mail.api.contacts.get_contacts',
	auto: false,
	makeParams: (text: string) => ({
		account: store.accountId,
		filter: { operator: 'OR', conditions: [{ text }, { email: text }] },
	}),
	transform: (data: { email: string; full_name?: string; user_image?: string }[]) =>
		data.map((o) => {
			const name = o.full_name || ''
			return { value: o.email, label: name || o.email, email: o.email, display_name: name, image: o.user_image }
		}),
})
const search = useDebounceFn((text: string) => {
	if (text) contactSearch.fetch(text)
}, 300)

// Contact matches plus a "create" entry (like compose's RecipientInput) so a typed value that isn't a
// contact can still be applied.
const options = computed(() => [
	...(contactSearch.data ?? []),
	{
		type: 'custom',
		slot: 'create',
		condition: () => !contactSearch.data?.length,
		onClick: ({ query }: { query: string }) => {
			model.value = query
		},
	},
])
</script>
