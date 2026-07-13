<template>
	<AppSettingsHeader :title="__('Appearance')">
		<template #actions>
			<Button
				:label="__('Save')"
				variant="solid"
				:loading="saveSettings.loading"
				:disabled="isNotDirty"
				@click="() => saveSettings.submit()"
			/>
		</template>
	</AppSettingsHeader>
	<AppSettingsBody>
		<div class="flex flex-col gap-5">
			<FormControl
				v-model="colorScheme"
				:label="__('Color Scheme')"
				type="select"
				variant="outline"
				:options="COLOR_SCHEMES"
			/>
			<template v-if="user.data.is_jmap_configured">
				<Switch
					:model-value="showReadingPane"
					:label="__('Show Reading Pane')"
					:description="__('Preview emails alongside the message list.')"
					class="!p-0"
					@update:model-value="(v) => (showReadingPane = v)"
				/>
				<FormControl
					:model-value="groupMessagesBy"
					:label="__('Group Messages By')"
					type="select"
					variant="outline"
					:options="GROUP_MESSAGES_OPTIONS"
					@update:model-value="(v) => (groupMessagesBy = v)"
				/>
			</template>
		</div>
	</AppSettingsBody>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import {
	Button,
	FormControl,
	Switch,
	createResource,
} from 'frappe-ui'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'

import { raiseToast } from '@/apps/mail/utils'

const user = inject('$user')

const colorScheme = ref(user.data.color_scheme)
const showReadingPane = ref(!!user.data.show_reading_pane)
const groupMessagesBy = ref(user.data.group_messages_by)

const isNotDirty = computed(
	() =>
		colorScheme.value === user.data.color_scheme &&
		showReadingPane.value === !!user.data.show_reading_pane &&
		groupMessagesBy.value === user.data.group_messages_by,
)

const saveSettings = createResource({
	url: 'frappe.client.set_value',
	makeParams: () => ({
		doctype: 'User Settings',
		name: user.data.user_settings,
		fieldname: {
			color_scheme: colorScheme.value,
			show_reading_pane: showReadingPane.value ? 1 : 0,
			group_messages_by: groupMessagesBy.value,
		},
	}),
	onSuccess: () => {
		raiseToast(__('Appearance updated.'))
		user.reload()
	},
	onError: () => raiseToast(__('Unable to save appearance settings.'), 'error'),
})

const COLOR_SCHEMES = [
	{ label: __('System Default'), value: 'System Default' },
	{ label: __('Light Mode'), value: 'Light Mode' },
	{ label: __('Dark Mode'), value: 'Dark Mode' },
]

const GROUP_MESSAGES_OPTIONS = [
	{ label: __('None'), value: 'None' },
	{ label: __('Day'), value: 'Day' },
	{ label: __('Month'), value: 'Month' },
]
</script>
