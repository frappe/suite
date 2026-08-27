<template>
	<AppSettingsHeader :title="__('Appearance')">
		<template #actions>
			<Button
				:label="__('Save')"
				variant="solid"
				:size="isMobile ? 'md' : 'sm'"
				:loading="saving"
				:disabled="isNotDirty"
				@click="saveAppearance"
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
			<!-- Desktop-only concepts: the reading pane doesn't exist on mobile and
			     the mobile list renders without group headers. -->
			<template v-if="user.data.is_jmap_configured && !isMobile">
				<SettingsRow
					class="!py-0"
					:title="__('Split View')"
					:description="__('Preview emails alongside the message list.')"
				>
					<Switch
						:model-value="showReadingPane"
						@update:model-value="(v) => (showReadingPane = v)"
					/>
				</SettingsRow>
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
	SettingsRow,
	Switch,
	createResource,
} from 'frappe-ui'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'

import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { switchTheme, themeMode } from '@/utils/setupTheme'

const user = inject('$user')
const { isMobile } = useScreenSize()

const colorScheme = ref(themeMode.value)
const showReadingPane = ref(!!user.data.show_reading_pane)
const groupMessagesBy = ref(user.data.group_messages_by)
const saving = ref(false)

const isNotDirty = computed(
	() =>
		colorScheme.value === themeMode.value &&
		showReadingPane.value === !!user.data.show_reading_pane &&
		groupMessagesBy.value === user.data.group_messages_by,
)

const saveSettings = createResource({
	url: 'frappe.client.set_value',
	makeParams: () => ({
		doctype: 'User Settings',
		name: user.data.user_settings,
		fieldname: {
			show_reading_pane: showReadingPane.value ? 1 : 0,
			group_messages_by: groupMessagesBy.value,
		},
	}),
})

const saveAppearance = async () => {
	saving.value = true
	try {
		const [, themeSaved] = await Promise.all([saveSettings.submit(), switchTheme(colorScheme.value)])
		if (!themeSaved) return
		raiseToast(__('Appearance updated.'))
		user.reload()
	} catch {
		raiseToast(__('Unable to save appearance settings.'), 'error')
	} finally {
		saving.value = false
	}
}

const COLOR_SCHEMES = [
	{ label: __('Automatic'), value: 'automatic' },
	{ label: __('Light'), value: 'light' },
	{ label: __('Dark'), value: 'dark' },
]

const GROUP_MESSAGES_OPTIONS = [
	{ label: __('None'), value: 'None' },
	{ label: __('Day'), value: 'Day' },
	{ label: __('Month'), value: 'Month' },
]
</script>
