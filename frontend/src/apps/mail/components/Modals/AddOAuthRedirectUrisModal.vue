<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Add Redirect URIs'),
			actions: [
				{
					label: __('Add'),
					variant: 'solid',
					disabled: !validUris.length,
					loading: addUris.loading,
					onClick: addUris.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<div class="space-y-2">
					<label class="text-ink-gray-5 block text-xs">{{ __('Redirect URIs') }}</label>
					<div v-for="(row, index) in uris" :key="index" class="flex items-center gap-2">
						<FormControl
							v-model="row.value"
							placeholder="https://app.example.com/callback"
							class="w-full"
						/>
						<Button v-if="uris.length > 1" variant="ghost" theme="red" @click="uris.splice(index, 1)">
							<template #icon><FeatherIcon name="x" class="h-4 w-4" /></template>
						</Button>
					</div>
					<Button variant="ghost" size="sm" :label="__('Add another')" @click="uris.push({ value: '' })">
						<template #prefix><FeatherIcon name="plus" class="h-4 w-4" /></template>
					</Button>
				</div>
				<ErrorMessage
					:message="addUris.error && (addUris.error?.messages?.[0] || addUris.error?.message || __('Request failed.'))"
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
const { clientId } = defineProps<{ clientId: string }>()
const emit = defineEmits(['reload'])

const uris = ref<{ value: string }[]>([{ value: '' }])

const validUris = computed(() => uris.value.map((u) => u.value.trim()).filter(Boolean))

watch(show, () => {
	if (show.value) {
		uris.value = [{ value: '' }]
		addUris.reset()
	}
})

const addUris = createResource({
	url: 'suite.mail.api.admin.add_oauth_client_redirect_uris',
	makeParams: () => ({ client_id: clientId, redirect_uris: validUris.value }),
	onSuccess: () => {
		show.value = false
		emit('reload')
		raiseToast(__('Redirect URIs added.'))
	},
})
</script>
