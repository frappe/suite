<template>
	<div class="bg-surface-gray-1 flex h-screen flex-col items-center justify-center p-6">
		<div
			class="bg-surface-base flex w-full max-w-md flex-col items-center gap-4 rounded-lg px-8 py-10 text-center shadow-xl"
		>
			<MailLogo class="h-10 w-10" />
			<h1 class="text-xl-semibold text-ink-gray-9">
				{{ __('Mail is not set up yet') }}
			</h1>

			<p v-if="isAdmin" class="text-base text-ink-gray-6">
				{{
					__(
						'The mail server hasn’t been configured yet. To get started, set the server connection details (server_url, username and password) in your site config (site_config.json) or under Mail Settings.',
					)
				}}
			</p>
			<p v-else class="text-base text-ink-gray-6">
				{{
					__(
						'The mail server hasn’t been configured yet. Please contact your administrator to finish setting up Mail.',
					)
				}}
			</p>

			<div class="mt-2 flex items-center gap-2">
				<Button
					v-if="isAdmin"
					variant="solid"
					:label="__('Open Mail Settings')"
					@click="openMailSettings"
				/>
				<router-link
					to="/suite"
					class="text-sm text-ink-blue-link hover:underline"
				>
					{{ __('Back to launcher') }}
				</router-link>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button } from 'frappe-ui'

import { userStore } from '@/apps/mail/stores/user'
import MailLogo from '@/apps/mail/components/Icons/MailLogo.vue'

const { userResource } = userStore()

const isAdmin = computed(
	() => !!(userResource.data?.is_suite_admin || userResource.data?.is_system_manager),
)

const openMailSettings = () => {
	window.open('/app/mail-settings', '_blank')
}
</script>
