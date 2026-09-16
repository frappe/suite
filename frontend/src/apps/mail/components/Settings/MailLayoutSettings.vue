<template>
	<AppSettingsHeader :title="__('Mail layout')">
		<template #actions>
			<Button
				:label="__('Save')"
				variant="solid"
				:size="isMobile ? 'md' : 'sm'"
				:loading="saving"
				:disabled="isNotDirty"
				@click="saveLayout"
			/>
		</template>
	</AppSettingsHeader>
	<AppSettingsBody>
		<div class="flex flex-col gap-5">
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
				<SettingsRow
					class="!py-0"
					:title="__('Group Messages By')"
					:description="__('Organize the message list into date-based sections.')"
				>
					<Select
						:model-value="groupMessagesBy"
						:options="GROUP_MESSAGES_OPTIONS"
						@update:model-value="(v) => (groupMessagesBy = v)"
					/>
				</SettingsRow>
			</template>
		</div>
	</AppSettingsBody>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import {
	Button,
	Select,
	SettingsRow,
	Switch,
	createResource,
} from 'frappe-ui'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'

import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'

const user = inject('$user')
const { isMobile } = useScreenSize()

const showReadingPane = ref(!!user.data.show_reading_pane)
const groupMessagesBy = ref(user.data.group_messages_by)
const saving = ref(false)

const isNotDirty = computed(
	() =>
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

const saveLayout = async () => {
	saving.value = true
	try {
		await saveSettings.submit()
		raiseToast(__('Mail layout updated.'))
		user.reload()
	} catch {
		raiseToast(__('Unable to save mail layout settings.'), 'error')
	} finally {
		saving.value = false
	}
}

const GROUP_MESSAGES_OPTIONS = [
	{ label: __('None'), value: 'None' },
	{ label: __('Day'), value: 'Day' },
	{ label: __('Month'), value: 'Month' },
]
</script>
