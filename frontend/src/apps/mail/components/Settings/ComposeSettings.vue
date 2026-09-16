<template>
	<AppSettingsHeader :title="__('Compose')">
		<template #actions>
			<Button
				:label="__('Save')"
				variant="solid"
				:size="isMobile ? 'md' : 'sm'"
				:loading="saveSettings.loading"
				:disabled="isNotDirty"
				@click="saveSettings.submit()"
			/>
		</template>
	</AppSettingsHeader>
	<AppSettingsBody>
		<div class="flex flex-col gap-5">
			<SettingsRow
				class="!py-0"
				:title="__('Undo Send')"
				:description="
					__('How long a sent message waits before delivery, so you can still take it back.')
				"
			>
				<Select
					v-model="undoSendPeriod"
					:options="UNDO_SEND_OPTIONS"
				/>
			</SettingsRow>
		</div>
	</AppSettingsBody>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { Button, Select, SettingsRow, createResource } from 'frappe-ui'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'

import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { UNDO_SEND_PERIODS, undoSendPeriodOf } from '@/apps/mail/utils/undoSend'
import type { User, UserResource } from '@/apps/mail/types'

const user = inject('$user') as UserResource
const { isMobile } = useScreenSize()

// The select speaks the Select field's strings; the saved value is compared through the same
// fallback the composer uses, so an unset row reads as the default rather than as dirty.
const savedPeriod = computed(() => String(undoSendPeriodOf(user.data)))
const undoSendPeriod = ref(savedPeriod.value)
const isNotDirty = computed(() => undoSendPeriod.value === savedPeriod.value)

const saveSettings = createResource({
	url: 'frappe.client.set_value',
	makeParams: () => ({
		doctype: 'User Settings',
		name: user.data.user_settings,
		fieldname: 'undo_send_period',
		value: undoSendPeriod.value,
	}),
	onSuccess: () => {
		// Apply locally before the reload lands, so nothing reads the old period in between.
		user.data.undo_send_period = undoSendPeriod.value as User['undo_send_period']
		raiseToast(__('Compose settings updated.'))
		user.reload()
	},
	onError: () => raiseToast(__('Unable to save compose settings.'), 'error'),
})

const UNDO_SEND_OPTIONS = UNDO_SEND_PERIODS.map((seconds) => ({
	label: __('{0} seconds', [String(seconds)]),
	value: String(seconds),
}))
</script>
