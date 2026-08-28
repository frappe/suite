<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Add Recipients'),
			actions: [
				{
					label: __('Add'),
					variant: 'solid',
					disabled: !validEmails.length,
					loading: addRecipients.loading,
					onClick: addRecipients.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<div class="space-y-2">
					<label class="text-ink-gray-5 block text-xs">{{ __('Recipients') }}</label>
					<div v-for="(row, index) in emails" :key="index" class="flex items-center gap-2">
						<FormControl
							v-model="row.email"
							type="email"
							placeholder="someone@example.com"
							class="w-full"
						/>
						<Button
							v-if="emails.length > 1"
							variant="ghost"
							theme="red"
							@click="emails.splice(index, 1)"
						>
							<template #icon><FeatherIcon name="x" class="h-4 w-4" /></template>
						</Button>
					</div>
					<Button variant="ghost" size="sm" :label="__('Add another')" @click="emails.push({ email: '' })">
						<template #prefix><FeatherIcon name="plus" class="h-4 w-4" /></template>
					</Button>
				</div>
				<ErrorMessage
					:message="addRecipients.error && (addRecipients.error?.messages?.[0] || addRecipients.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import { raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()
const { listId } = defineProps<{ listId: string }>()
const emit = defineEmits(['reload'])

const emails = ref<{ email: string }[]>([{ email: '' }])

const validEmails = computed(() => emails.value.map((e) => e.email.trim()).filter(Boolean))

watch(show, () => {
	if (show.value) {
		emails.value = [{ email: '' }]
		addRecipients.reset()
	}
})

const addRecipients = createResource({
	url: 'suite.mail.api.admin.add_mailing_list_recipients',
	makeParams: () => ({ list_id: listId, recipients: validEmails.value }),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Recipients added.'))
	},
})
</script>
