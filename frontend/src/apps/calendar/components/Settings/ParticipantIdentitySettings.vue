<template>
	<AppSettingsHeader :title="__('Participant Identity')">
		<template #actions>
			<Button
				v-if="identity?.doc && !identity.loading"
				:label="__('Save')"
				variant="solid"
				:disabled="
					identity.get.loading ||
					JSON.stringify(identity.doc) === JSON.stringify(identity.originalDoc)
				"
				:loading="identity.save.loading"
				@click="save"
			/>
			<Button icon-left="lucide-plus" :label="__('New')" variant="outline" @click="showAddDialog" />
		</template>
	</AppSettingsHeader>
	<AppSettingsBody>
		<template v-if="participantIdentities?.data?.length">
			<div class="flex min-h-full flex-col">
				<div class="flex-1 space-y-4">
					<FormControl
						v-model="identityName"
						type="combobox"
						:label="__('Identity')"
						variant="outline"
						:options="
							participantIdentities.data.map((identity: ParticipantIdentity) => ({
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

						<FormControl
							v-model="identity.doc.email"
							:label="__('Email Address')"
							type="email"
							variant="outline"
						/>

						<FormControl
							v-model="identity.doc.default"
							type="checkbox"
							:label="__('Set as default Participant Identity')"
						/>

						<Button
							:label="__('Delete')"
							class="min-h-7 w-full"
							variant="outline"
							theme="red"
							@click="showDeleteDialog = true"
						/>
					</template>
				</div>
			</div>
		</template>
		<div
			v-else-if="!participantIdentities.loading"
			class="text-ink-gray-6 flex flex-col space-y-2 text-sm"
		>
			<p class="text-base font-medium">{{ __('No participant identities.') }}</p>
			<p>
				{{
					__(
						'Participant identities are the addresses you organize and attend calendar events as. Create one to get started.',
					)
				}}
			</p>
		</div>

		<Dialog
			v-model:open="showAddDialogState"
			v-bind="{
				title: __('New Participant Identity'),
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
					v-model="newName"
					:label="__('Display Name')"
					placeholder="John Doe"
					class="mb-4 w-full"
				/>
				<FormControl
					v-model="newDefault"
					type="checkbox"
					:label="__('Set as default Participant Identity')"
				/>
			</template>
		</Dialog>

		<Dialog
			v-model:open="showDeleteDialog"
			v-bind="{
				title: __('Delete Participant Identity'),
				message: __('Are you sure you want to delete this participant identity?'),
				actions: [
					{
						label: __('Confirm'),
						variant: 'solid',
						theme: 'red',
						loading: deleteIdentity.loading,
						onClick: () => deleteIdentity.submit(),
					},
				],
			}"
		/>
	</AppSettingsBody>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button, Dialog, FormControl, createDocumentResource, createResource } from 'frappe-ui'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'

import { raiseToast } from '@/apps/calendar/utils'
import { userStore } from '@/apps/calendar/stores/user'

import type { ParticipantIdentity } from '@/apps/calendar/types/doctypes'

const { accountId, participantIdentities } = userStore()

const identityName = ref(participantIdentities.data?.[0]?.name || '')

const getIdentity = () =>
	createDocumentResource({
		doctype: 'Participant Identity',
		name: identityName.value,
		setValue: {
			onSuccess: () => {
				raiseToast(__('Participant Identity updated.'))
				participantIdentities.reload()
			},
			onError: (error) => raiseToast(error.messages[0], 'error'),
		},
	})

const save = () => identity.value.save.submit()

const identity = ref(identityName.value ? getIdentity() : null)

const showAddDialogState = ref(false)
const showDeleteDialog = ref(false)
const newName = ref('')
const newEmail = ref('')
const newDefault = ref(false)

const showAddDialog = () => {
	newName.value = ''
	newEmail.value = ''
	newDefault.value = false
	showAddDialogState.value = true
}

const addIdentity = createResource({
	url: 'suite.mail.doctype.participant_identity.participant_identity.add_participant_identity',
	makeParams: () => ({
		account: accountId,
		name: newName.value,
		email: newEmail.value,
		default: newDefault.value,
	}),
	onSuccess: (id: string) => {
		raiseToast(__('Participant Identity created.'))
		showAddDialogState.value = false
		identityName.value = `${accountId}|${id}`
		participantIdentities.reload()
	},
	onError: (error) => raiseToast(error.messages?.[0] || error.message, 'error'),
})

const deleteIdentity = createResource({
	url: 'suite.mail.doctype.participant_identity.participant_identity.bulk_delete',
	makeParams: () => ({ names: [identityName.value] }),
	onSuccess: () => {
		raiseToast(__('Participant Identity deleted.'))
		showDeleteDialog.value = false
		identityName.value = ''
		participantIdentities.reload()
	},
	onError: (error) => {
		showDeleteDialog.value = false
		raiseToast(error.messages?.[0] || error.message, 'error')
	},
})

watch(identityName, (val) => {
	identity.value = val ? getIdentity() : null
})

// Keep the selection valid as the list loads or changes (e.g. after create/delete
// or an account switch): fall back to the first identity when the current one is gone.
watch(
	() => participantIdentities.data,
	(data) => {
		if (!data?.length) {
			identityName.value = ''
		} else if (!data.some((i: ParticipantIdentity) => i.name === identityName.value)) {
			identityName.value = data[0].name
		}
	},
)
</script>
