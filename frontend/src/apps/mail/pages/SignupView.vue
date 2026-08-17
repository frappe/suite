<template>
	<form class="flex flex-col space-y-4" @submit.prevent="next">
		<div v-if="route.query.step === '1'" class="flex items-center justify-between">
			<FormControl
				v-model="user.username"
				:label="__('Username')"
				placeholder="johndoe"
				autocomplete="username"
				class="w-full"
				required
				@update:model-value="usernameVerified = false"
			/>
			<FeatherIcon class="text-ink-gray-3 mx-2.5 mb-1.5 mt-auto h-4 w-4" name="at-sign" />
			<FormControl
				v-if="signupDomains?.data?.length"
				v-model="user.domain"
				:type="signupDomains?.data?.length === 1 ? 'text' : 'select'"
				:readonly="signupDomains?.data?.length === 1"
				:options="signupDomains?.data"
				:label="__('Domain Name')"
				class="w-full"
				required
				@update:model-value="usernameVerified = false"
			/>
		</div>

		<FormControl
			v-else-if="route.query.step === '2'"
			v-model="user.email"
			type="email"
			:label="__('Backup Email')"
			placeholder="johndoe@personal.com"
			autocomplete="email"
			class="w-full"
			required
		/>

		<FormControl
			v-else-if="route.query.step === '3'"
			v-model="user.password"
			type="password"
			:label="__('Password')"
			placeholder="*********"
			autocomplete="new-password"
			class="w-full"
			required
		/>

		<template v-else-if="route.query.step === '4'">
			<FormControl
				v-model="otp"
				:label="__('Verification Code')"
				:description="__('Enter the code sent to {0}.', [user.email])"
				placeholder="123456"
				autocomplete="one-time-code"
				class="w-full"
				required
			/>
			<button
				class="text-left text-base text-ink-gray-6 hover:underline"
				type="button"
				:disabled="resendOtp.loading"
				@click="resendOtp.submit()"
			>
				{{ __('Resend code') }}
			</button>
		</template>

		<template v-else>
			<FormControl
				v-model="user.first_name"
				:label="__('First Name')"
				placeholder="John"
				autocomplete="given-name"
				class="w-full"
				required
			/>
			<FormControl
				v-model="user.last_name"
				:label="__('Last Name')"
				placeholder="Doe"
				autocomplete="family-name"
				class="w-full"
			/>
		</template>

		<ErrorMessage
			:message="validateUsername.error || signup.error || verifyOtp.error || createAccount.error"
		/>
		<Button
			variant="solid"
			:label="
				route.query.step === '4' ? __('Verify') : route.query.step === '3' ? __('Sign Up') : __('Next')
			"
			:loading="validateUsername.loading || signup.loading || verifyOtp.loading || createAccount.loading"
			type="submit"
		/>
		<Button
			v-if="route.query.step"
			:label="__('Back')"
			@click.prevent="router.push({ query: { step: Number(route.query.step) - 1 } })"
		/>
	</form>
	<div class="mt-6 text-center">
		<router-link class="text-center text-base-medium hover:underline" :to="{ name: 'mail-login' }">
			{{ __('Already have an account? Log in.') }}
		</router-link>
	</div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, ErrorMessage, FormControl, createResource } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import { sessionStore } from '@/apps/mail/stores/session'

const router = useRouter()
const route = useRoute()
const { login } = sessionStore()

const usernameVerified = ref(false)
const accountRequest = ref('')
const otp = ref('')

const user = reactive({
	first_name: '',
	last_name: '',
	username: '',
	domain: '',
	email: '',
	password: '',
})

createResource({
	url: 'suite.mail.api.get_signup_settings',
	auto: true,
	onSuccess: (data) => {
		if (!Number(data.allow_signup)) {
			router.push({ name: 'mail-login' })
		}
	},
})

const signupDomains = createResource({
	url: 'suite.mail.api.get_signup_domains',
	auto: true,
	onSuccess: (data) => (user.domain = data[0]),
})

const validateUsername = createResource({
	url: 'suite.mail.api.account.validate_email_assigned',
	makeParams: () => ({ email: `${user.username}@${user.domain}` }),
	onSuccess: () => {
		usernameVerified.value = true
		router.push({ query: { step: '2' } })
	},
})

// Signup only records the request and emails a verification code; the account is
// created after the code is verified (verify_otp releases the request key).
const signup = createResource({
	url: 'suite.mail.api.account.signup',
	makeParams: () => ({ username: user.username, domain: user.domain, email: user.email }),
	onSuccess: (name: string) => {
		accountRequest.value = name
		router.push({ query: { step: '4' } })
	},
})

const resendOtp = createResource({
	url: 'suite.mail.api.account.resend_otp',
	makeParams: () => ({ account_request: accountRequest.value }),
})

const verifyOtp = createResource({
	url: 'suite.mail.api.account.verify_otp',
	makeParams: () => ({ account_request: accountRequest.value, otp: otp.value }),
	onSuccess: (requestKey: string) =>
		createAccount.submit({
			request_key: requestKey,
			first_name: user.first_name,
			last_name: user.last_name,
			password: user.password,
		}),
})

const createAccount = createResource({
	url: 'suite.mail.api.account.create_account',
	onSuccess: () => login.submit({ usr: `${user.username}@${user.domain}`, pwd: user.password }),
})

const next = () => {
	if (route.query.step === '1') validateUsername.submit()
	else if (route.query.step === '3') signup.submit()
	else if (route.query.step === '4') verifyOtp.submit()
	else router.push({ query: { step: Number(route.query.step || 0) + 1 } })
}

watch(
	() => route.query.step,
	(step) => {
		switch (step) {
			case '4':
				if (!accountRequest.value) {
					router.replace({ query: { step: '3' } })
					break
				}
			// fallthrough
			case '3':
				if (!user.email) {
					router.replace({ query: { step: '2' } })
					break
				}
			// fallthrough
			case '2':
				if (!usernameVerified.value) {
					router.replace({ query: { step: '1' } })
					break
				}
			// fallthrough
			case '1':
				if (!user.first_name) {
					router.replace({ query: {} })
				}
				break
			default:
				router.replace({ query: {} })
		}
	},
	{ immediate: true },
)
</script>
