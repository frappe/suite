<template>
	<UserProfileSettings>
		<section>
			<h2 class="text-lg-semibold text-ink-gray-8">
				{{ __('Preferences') }}
			</h2>
			<div class="mt-2">
				<Switch v-model="detectLinks" :label="__('Automatically detect links')" />
			</div>
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
