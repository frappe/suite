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
		</div>
	</AppSettingsBody>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import {
	Button,
	FormControl,
	createResource,
} from 'frappe-ui'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'

import { raiseToast } from '@/apps/calendar/utils'

const user = inject('$user')

const colorScheme = ref(user.data.color_scheme)

const isNotDirty = computed(() => colorScheme.value === user.data.color_scheme)

const saveSettings = createResource({
	url: 'frappe.client.set_value',
	makeParams: () => ({
		doctype: 'User Settings',
		name: user.data.user_settings,
		fieldname: { color_scheme: colorScheme.value },
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
</script>
