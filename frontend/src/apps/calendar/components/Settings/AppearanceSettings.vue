<template>
	<AppSettingsHeader :title="__('Appearance')">
		<template #actions>
			<Button
				:label="__('Save')"
				variant="solid"
				:loading="saving"
				:disabled="isNotDirty"
				@click="saveSettings"
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
import { computed, ref } from 'vue'
import { Button, FormControl } from 'frappe-ui'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'

import { raiseToast } from '@/apps/calendar/utils'
import { switchTheme, themeMode } from '@/utils/setupTheme'

const colorScheme = ref(themeMode.value)
const saving = ref(false)

const isNotDirty = computed(() => colorScheme.value === themeMode.value)

const saveSettings = async () => {
	saving.value = true
	try {
		if (!(await switchTheme(colorScheme.value))) return
		raiseToast(__('Appearance updated.'))
	} finally {
		saving.value = false
	}
}

const COLOR_SCHEMES = [
	{ label: __('Automatic'), value: 'automatic' },
	{ label: __('Light'), value: 'light' },
	{ label: __('Dark'), value: 'dark' },
]
</script>
