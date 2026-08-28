<template>
	<AppSettingsHeader :title="__('Identity')">
		<template #actions>
			<Button
				v-if="identity?.doc && !identity.loading"
				:label="__('Save')"
				variant="solid"
				:size="isMobile ? 'md' : 'sm'"
				:disabled="
					identity.get.loading ||
					JSON.stringify(identity.doc) === JSON.stringify(identity.originalDoc)
				"
				:loading="identity.save.loading"
				@click="save"
			/>
			<Button
				icon-left="lucide-plus"
				:label="__('New')"
				:size="isMobile ? 'md' : 'sm'"
				variant="outline"
				@click="showAddIdentity"
			/>
		</template>
	</AppSettingsHeader>
	<AppSettingsBody>
	<template v-if="identities?.data?.length">
		<div class="flex min-h-full flex-col">
			<div class="flex-1 space-y-4">
				<FormControl
					v-model="identityName"
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

				<template v-if="identity?.doc && !identity.loading">
					<FormControl
						v-model="identity.doc._name"
						:label="__('Display Name')"
						variant="outline"
					/>

					<div class="space-y-1.5">
						<label class="text-ink-gray-5 block text-xs"> {{ __('Reply To') }} </label>
						<IdentitySettingsListView
							:data="identity.doc.reply_to || []"
							:empty-state-description="__('No Reply To addresses added.')"
							@delete="(index: number) => identity.doc.reply_to.splice(index, 1)"
						/>
					</div>
					<Button
						:label="__('Add Reply To')"
						class="min-h-7 w-full"
						variant="outline"
						@click="() => showAddEmailAddress(true)"
					/>

					<div class="space-y-1.5">
						<label class="text-ink-gray-5 block text-xs"> {{ __('Bcc') }} </label>
						<IdentitySettingsListView
							:data="identity.doc.bcc || []"
							:empty-state-description="__('No Bcc addresses added.')"
							@delete="(index: number) => identity.doc.bcc.splice(index, 1)"
						/>
					</div>
					<Button
						:label="__('Add Bcc')"
						class="min-h-7 w-full"
						variant="outline"
						@click="() => showAddEmailAddress(false)"
					/>

					<FormControl
						v-if="signatures.data?.length"
						v-model="savedSignature"
						type="combobox"
						:label="__('Use Saved Signature')"
						:options="
							signatures.data?.map((sig) => ({
								label: sig.signature_name,
								value: sig.html_body,
							}))
						"
						variant="outline"
						:open-on-click="true"
						@update:model-value="(val: string) => (identity.doc.html_signature = val)"
					/>

					<div class="space-y-1.5">
						<label class="text-ink-gray-5 block text-xs">
							{{ __('Default Signature') }}
						</label>
						<TextEditor
							editor-class="prose-sm min-h-[8rem] border rounded-b-6 border-t-0 p-2 max-w-none border-outline-gray-2"
							:extensions="[CustomParagraphExtension]"
							:fixed-menu="buttons"
							:placeholder="__('Write your signature here')"
							:content="identity.doc.html_signature"
							@change="(val: string) => (identity.doc.html_signature = val)"
						/>
					</div>
				</template>
			</div>

			<Dialog
				v-model:open="showDialog"
			 v-bind="{
					title: isAddReplyTo ? __('New Reply To') : __('New Bcc'),
					actions: [
						{
							label: __('Save'),
							variant: 'solid',
							disabled: !email,
							onClick: () => addEmailAddress(),
						},
					],
				}"
			>
				<template #default>
					<FormControl
						v-model="email"
						:label="__('Email')"
						placeholder="johndoe@example.com"
						type="email"
						class="mb-4 w-full"
						:required="true"
					/>
					<FormControl
						v-model="displayName"
						:label="__('Display Name')"
						placeholder="John Doe"
						class="w-full"
					/>
				</template>
			</Dialog>
		</div>
	</template>

	<Dialog
		v-model:open="showAddIdentityDialog"
	 v-bind="{
			title: __('New Identity'),
			actions: [
				{
					label: __('Save'),
					variant: 'solid',
					disabled: !newEmail,
					loading: addIdentity.loading,
					onClick: () => addIdentity.submit(),
				},
			],
		}"
	>
		<template #default>
			<FormControl
				v-model="newEmail"
				:label="__('Email')"
				placeholder="johndoe@example.com"
				type="email"
				class="mb-4 w-full"
				:required="true"
			/>
			<FormControl
				v-model="newDisplayName"
				:label="__('Display Name')"
				placeholder="John Doe"
				class="w-full"
			/>
		</template>
	</Dialog>
	</AppSettingsBody>
</template>

<script setup lang="ts">
import { inject, ref, watch } from 'vue'
import {
	Button, Dialog, FormControl, createDocumentResource, createResource, useList } from 'frappe-ui'
import { TextEditor } from 'frappe-ui/experimental'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'

import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize, useTextEditorButtons } from '@/apps/mail/utils/composables'
import { CustomParagraphExtension } from '@/apps/mail/utils/text-editor'
import { userStore } from '@/apps/mail/stores/user'
import IdentitySettingsListView from '@/apps/mail/components/IdentitySettingsListView.vue'

import type { Identity } from '@/apps/mail/types'

const user = inject('$user')
const { accountId, identities } = userStore()

const { buttons } = useTextEditorButtons()
const { isMobile } = useScreenSize()

const signatures = useList({
	doctype: 'Mail Signature',
	immediate: true,
	fields: ['name', 'signature_name', 'html_body'],
	filters: { user: user.data.name },
	cacheKey: ['mailSignatures', user.data.name],
})

const identityName = ref(identities.data?.[0]?.name || '')

const getIdentity = () =>
	createDocumentResource({
		doctype: 'Identity',
		name: identityName.value,
		setValue: {
			onSuccess: () => {
				raiseToast(__('Identity updated.'))
				identities.reload()
			},
			onError: (error) => raiseToast(error.messages[0], 'error'),
		},
	})

// text_signature is derived server-side on save (Identity.validate), so the two forms of the
// signature stay the same signature rather than one being a flattened trace of the other.
const save = () => identity.value.save.submit()

const identity = ref(getIdentity())
const savedSignature = ref('')

const showDialog = ref(false)
const isAddReplyTo = ref(true)
const email = ref('')
const displayName = ref('')

const showAddEmailAddress = (isReplyTo: boolean) => {
	email.value = ''
	displayName.value = ''
	isAddReplyTo.value = isReplyTo
	showDialog.value = true
}

const addEmailAddress = () => {
	if (isAddReplyTo.value)
		identity.value.doc.reply_to.push({ email: email.value, display_name: displayName.value })
	else identity.value.doc.bcc.push({ email: email.value, display_name: displayName.value })
	showDialog.value = false
}

const showAddIdentityDialog = ref(false)
const newEmail = ref('')
const newDisplayName = ref('')

const showAddIdentity = () => {
	newEmail.value = ''
	newDisplayName.value = ''
	showAddIdentityDialog.value = true
}

const addIdentity = createResource({
	url: 'suite.mail.doctype.identity.identity.add_identity',
	makeParams: () => ({
		account: accountId,
		email: newEmail.value,
		name: newDisplayName.value,
	}),
	onSuccess: (id: string) => {
		raiseToast(__('Identity created.'))
		showAddIdentityDialog.value = false
		identityName.value = `${accountId}|${id}`
		identities.reload()
	},
	onError: (error) => raiseToast(error.messages?.[0] || error.message, 'error'),
})

watch(identityName, (val) => {
	if (val) identity.value = getIdentity()
})
</script>
