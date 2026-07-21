<template>
	<AppSettingsHeader
		:title="__('Preferences')"
		:description="__('Control how Drive behaves for you')"
	/>
	<AppSettingsBody>
		<div class="space-y-3">
			<SettingsRow :title="__('Automatically detect links')">
				<Switch v-model="detectLinks" />
			</SettingsRow>
		</div>
	</AppSettingsBody>
</template>

<script setup>
import { ref, watch } from 'vue'
import { SettingsRow, Switch } from 'frappe-ui'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import { settings, setSettings } from '@/apps/drive/resources/permissions'

const detectLinks = ref(Boolean(settings.data?.auto_detect_links))

watch(detectLinks, (v) => {
	setSettings.submit({
		updates: { auto_detect_links: v },
	})
})
</script>
