<template>
	<div class="bg-surface-gray-1 flex min-h-screen flex-col items-center justify-center p-6">
		<div class="w-full max-w-xl">
			<div class="mb-5 flex flex-col items-center gap-3 text-center">
				<MailLogo class="h-10 w-10" />
				<h1 class="text-xl-semibold text-ink-gray-9">{{ __('Set up Mail') }}</h1>
				<p class="text-base text-ink-gray-6">
					{{ __('Enter your credentials to start using Mail.') }}
				</p>
			</div>
			<div class="bg-surface-base rounded-lg px-6 py-6 shadow-xl">
				<CredentialsSettings />
			</div>
			<div class="mt-4 text-center">
				<router-link to="/suite" class="text-sm text-ink-blue-link hover:underline">
					{{ __('Back to launcher') }}
				</router-link>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { useRouter } from 'vue-router'

import { userStore } from '@/apps/mail/stores/user'
import CredentialsSettings from '@/apps/mail/components/Settings/CredentialsSettings.vue'
import MailLogo from '@/apps/mail/components/Icons/MailLogo.vue'

const router = useRouter()
const { userResource } = userStore()

// Saving valid credentials sets the username on User Settings and reloads $user, flipping
// is_jmap_configured to true — at which point we drop the user into the app.
watch(
	() => userResource.data?.is_jmap_configured,
	(configured) => {
		if (configured) router.replace({ name: 'mail-root-shortcut' })
	},
	{ immediate: true },
)
</script>
