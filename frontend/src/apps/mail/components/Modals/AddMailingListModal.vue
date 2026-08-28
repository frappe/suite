<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Add Mailing List'),
			actions: [
				{
					label: __('Add Mailing List'),
					variant: 'solid',
					disabled: !(name && domain),
					loading: addList.loading,
					onClick: addList.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<FormControl
					v-model="name"
					:label="__('Name')"
					placeholder="announce"
					autocomplete="off"
					:description="__('Together with the domain, this forms the list\'s email address.')"
				/>
				<FormControl v-model="domain" type="select" :label="__('Domain')" :options="domainOptions" />
				<FormControl v-model="description" :label="__('Description')" type="textarea" />
				<FormControl
					v-model="recipients"
					:label="__('Recipients')"
					type="textarea"
					:placeholder="__('One email address per line')"
				/>
				<ErrorMessage
					:message="addList.error && (addList.error?.messages?.[0] || addList.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()
const router = useRouter()
const emit = defineEmits(['reload'])

const name = ref('')
const domain = ref('')
const description = ref('')
const recipients = ref('')

const domains = createResource({ url: 'suite.mail.api.admin.get_enabled_domains', auto: true })
const domainOptions = computed(() => (domains.data || []).map((d: string) => ({ label: d, value: d })))

const toLines = (text: string) =>
	text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)

watch(show, () => {
	if (show.value) {
		name.value = ''
		domain.value = ''
		description.value = ''
		recipients.value = ''
		addList.reset()
	}
})

const addList = createResource({
	url: 'suite.mail.api.admin.add_mailing_list',
	makeParams: () => ({
		name: name.value,
		domain: domain.value,
		description: description.value?.trim() || undefined,
		recipients: toLines(recipients.value),
	}),
	onSuccess: (data: string) => {
		if (!data) return
		show.value = false
		emit('reload')
		raiseToast(__('Mailing list added.'))
		router.push({ name: 'mail-mailing-list', params: { listId: data } })
	},
})
</script>
