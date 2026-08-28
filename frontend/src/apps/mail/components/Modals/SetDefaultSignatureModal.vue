<template>
	<Dialog v-model:open="show" v-bind="addSignatureOptions">
		<template #default>
			<FormControl
				v-model="identity"
				type="combobox"
				:label="__('Identity')"
				variant="outline"
				:options="
					identities.data.map((identity: Identity) => ({
						label: `${identity.email} (${identity.id})`,
						value: identity.name,
					}))
				"
				:open-on-click="true"
			/>

			<div class="mt-4 space-y-1.5">
				<label class="text-ink-gray-5 block text-xs"> {{ __('Signature') }} </label>
				<TextEditor
					editor-class="prose-sm min-h-[8rem] border rounded-4 p-2 max-w-none border-outline-gray-2"
					:extensions="[CustomParagraphExtension]"
					:placeholder="__('Write your signature here')"
					:content="signature"
					:editable="false"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Dialog, FormControl, createResource } from 'frappe-ui'
import { TextEditor } from 'frappe-ui/experimental'

import { raiseToast } from '@/apps/mail/utils'
import { CustomParagraphExtension } from '@/apps/mail/utils/text-editor'
import { userStore } from '@/apps/mail/stores/user'

import type { Identity } from '@/apps/mail/types'

const { identities } = userStore()

const show = defineModel<boolean>()

const { signature } = defineProps<{ signature: string }>()

const identity = ref(identities?.data[0]?.name || '')

const addSignatureOptions = computed(() => ({
	title: __('Set Default Signature'),
	actions: [
		{
			label: __('Save'),
			variant: 'solid',
			disabled: !identity.value,
			onClick: () => {
				setSignature.submit()
				show.value = false
			},
		},
	],
}))

const setSignature = createResource({
	url: 'suite.mail.api.account.set_signature',
	makeParams: () => ({ identity: identity.value, signature }),
	onSuccess: () => {
		raiseToast(__('Identity updated.'))
		identities.reload()
	},
	onError: (error) => raiseToast(error.message, 'error'),
})
</script>
