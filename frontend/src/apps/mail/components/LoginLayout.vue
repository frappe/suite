<template>
	<div class="sm:bg-surface-gray-1 min-h-screen">
		<div class="relative z-[1] mx-auto py-8 sm:w-max sm:py-32">
			<div class="flex">
				<slot name="logo">
					<div class="mx-auto flex items-center space-x-2">
						<MailLogo class="inline-block h-7 w-7" />
						<span class="select-none text-2xl-semibold tracking-tight">
							Frappe Mail
						</span>
					</div>
				</slot>
			</div>
			<div
				class="bg-surface-base mx-auto w-full px-4 py-8 sm:mt-6 sm:w-[26rem] sm:rounded-6 sm:px-8 sm:shadow-xl"
			>
				<div class="mb-6 text-center">
					<span class="text-center text-lg-medium leading-5 tracking-tight">
						{{ title }}
					</span>
				</div>
				<slot>
					<router-view />
				</slot>
			</div>
		</div>
		<div class="absolute bottom-4 flex w-full justify-center">
			<FrappeLogo class="h-4" />
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import FrappeLogo from '@/apps/mail/components/Icons/FrappeLogo.vue'
import MailLogo from '@/apps/mail/components/Icons/MailLogo.vue'

const route = useRoute()

const title = computed(() => {
	switch (route.name) {
		case 'mail-login':
			return __('Sign in to your account')
		case 'mail-forgot-password':
		case 'mail-reset-password':
			return __('Reset Password')
		default:
			return __('Create a new account')
	}
})
</script>
