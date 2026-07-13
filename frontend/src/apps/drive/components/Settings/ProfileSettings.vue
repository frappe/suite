<template>
	<UserProfileSettings>
		<section class="mt-6 space-y-4 border-t border-outline-gray-2 pt-6">
			<h2 class="text-base-semibold text-ink-gray-8">
				{{ __('Preferences') }}
			</h2>
			<Switch v-model="detectLinks" :label="__('Automatically detect links')" />
		</section>
	</UserProfileSettings>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Switch } from 'frappe-ui'
import UserProfileSettings from '@/components/settings/UserProfileSettings.vue'
import { settings, setSettings } from '@/apps/drive/resources/permissions'

const detectLinks = ref(Boolean(settings.data?.auto_detect_links))

watch(detectLinks, (v) => {
	setSettings.submit({
		updates: { auto_detect_links: v },
	})
})
</script>
