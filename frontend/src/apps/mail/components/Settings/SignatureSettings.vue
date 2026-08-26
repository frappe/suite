<template>
	<AppSettingsHeader :title="__('Signatures')">
		<template #actions>
			<Button
				icon-left="lucide-plus"
				:label="__('New')"
				:size="isMobile ? 'md' : 'sm'"
				@click="showAddSignature = true"
			/>
		</template>
	</AppSettingsHeader>
	<AppSettingsBody>
		<div v-if="signatures?.data?.length">
			<div
				v-for="signature in signatures?.data"
				:key="signature.name"
				class="hover:bg-surface-gray-1 -mx-2 flex cursor-pointer items-center justify-between rounded-4 px-3 py-1 max-sm:-mx-4 max-sm:px-4 max-sm:py-2"
				@click="editSignature(signature.name)"
			>
				<span class="text-base">{{ signature.signature_name }}</span>
				<!-- .stop lives on the wrapper: AdaptiveDropdown's mobile trigger opens
				     via the click bubbling to its own span, so stopping on the Button
				     itself would keep the sheet from opening. -->
				<div class="flex max-sm:-mr-1.5" @click.stop>
					<AdaptiveDropdown :options="signatureOptions(signature)" :title="signature.signature_name">
						<Button variant="">
							<template #icon>
								<Ellipsis class="text-ink-gray-5 h-4 w-4" />
							</template>
						</Button>
					</AdaptiveDropdown>
				</div>
			</div>
		</div>

		<div v-else class="text-ink-gray-6 flex flex-col space-y-2 text-sm">
			<p class="text-base-medium">{{ __('No signatures found.') }}</p>

			<p>
				{{ __('Signatures let you automatically add personalized content to your emails.') }}
			</p>
		</div>

		<AddSignatureModal v-model="showAddSignature" @reload-signatures="signatures.reload()" />
		<SetDefaultSignatureModal v-model="showSetSignature" :signature="selectedSignature" />
		<EditSignatureModal
			v-model="showEditSignature"
			:signature-i-d="selectedSignature"
			@reload-signatures="signatures.reload()"
		/>
	</AppSettingsBody>
</template>

<script setup lang="ts">
import { inject, ref } from 'vue'
import { Edit2, Ellipsis, Pin, Trash2 } from 'lucide-vue-next'
import { Button, toast, useList } from 'frappe-ui'

import { useScreenSize } from '@/apps/mail/utils/composables'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'

import AdaptiveDropdown from '@/apps/mail/components/AdaptiveDropdown.vue'
import AddSignatureModal from '@/apps/mail/components/Modals/AddSignatureModal.vue'
import EditSignatureModal from '@/apps/mail/components/Modals/EditSignatureModal.vue'
import SetDefaultSignatureModal from '@/apps/mail/components/Modals/SetDefaultSignatureModal.vue'

import type { MailSignature } from '@/apps/mail/types'

const user = inject('$user')
const { isMobile } = useScreenSize()

const showAddSignature = ref(false)
const selectedSignature = ref('')
const showSetSignature = ref(false)
const showEditSignature = ref(false)

const signatures = useList({
	doctype: 'Mail Signature',
	immediate: true,
	fields: ['name', 'signature_name', 'html_body'],
	filters: { user: user.data.name },
	cacheKey: ['mailSignatures', user.data.name],
})

const editSignature = (signature: string) => {
	selectedSignature.value = signature
	showEditSignature.value = true
}

const signatureOptions = (signature: MailSignature) => [
	{
		label: __('Set Default'),
		icon: Pin,
		onClick: () => {
			selectedSignature.value = signature.html_body!
			showSetSignature.value = true
		},
		condition: () => signature.html_body,
	},
	{
		label: __('Edit'),
		icon: Edit2,
		onClick: () => editSignature(signature.name),
	},
	{
		label: __('Delete'),
		icon: Trash2,
		theme: 'red',
		onClick: async () => {
			try {
				await signatures.delete.submit({ name: signature.name })
			} catch (e) {
				toast.error(e instanceof Error ? e.message : __('Could not delete signature'))
			}
		},
	},
]
</script>
