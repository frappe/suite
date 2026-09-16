<template>
	<AppSettingsHeader
		:title="__('External Access')"
		:description="__('Connect Drive to desktop, mobile, and other file apps')"
	/>
	<AppSettingsBody>
		<div class="flex flex-col gap-6">
			<div v-if="config.is_admin">
				<SettingsRow
					:title="__('Enable WebDAV')"
					:description="
						__('Let WebDAV clients (Windows Explorer, Finder, rclone…) connect to Drive.')
					"
				>
					<Switch v-model="globalEnabled" />
				</SettingsRow>
			</div>

			<div v-if="config.globally_enabled" class="flex flex-col gap-4">
				<SettingsRow
					:title="__('Allow WebDAV access to my files')"
					:description="__('Off by default — turn on before connecting a client.')"
				>
					<Switch v-model="userEnabled" />
				</SettingsRow>

				<div class="space-y-1">
					<h2 class="text-base-semibold text-ink-gray-8">
						{{ __('Client Configuration') }}
					</h2>
					<p class="text-ink-gray-6 text-base">
						{{
							__(
								'Connect any WebDAV client with these details. The mount shows your Home folder and the shared Everyone tree.',
							)
						}}
					</p>
				</div>

				<CopyControl :label="__('Server URL')" :value="config.server_url" />
				<CopyControl :label="__('Username')" :value="config.username" />
				<p class="text-ink-gray-5 text-sm">
					{{
						__(
							'Sign in with your Frappe password, or with the API key and secret below in place of username and password.',
						)
					}}
				</p>
				<p v-if="config.two_factor_blocked" class="text-ink-amber-3 text-sm">
					{{
						__(
							'Your account uses two-factor authentication, which WebDAV clients cannot perform with a password — sign in with an API key and secret instead.',
						)
					}}
				</p>

				<div class="space-y-3 border-t pt-4">
					<h2 class="text-base-semibold text-ink-gray-8">{{ __('API Access') }}</h2>
					<CopyControl
						v-if="config.api_key"
						:label="__('API Key')"
						:value="config.api_key"
					/>
					<p v-else class="text-base">
						{{
							__(`You don't have an API key yet. Generate one to sign in without your password.`)
						}}
					</p>
					<Button
						class="min-h-7 self-start"
						:label="config.api_key ? __('Regenerate Secret') : __('Generate Keys')"
						@click="generateKeys.submit()"
					/>

					<Dialog v-model="showSecret" :options="{ title: __('API Access') }">
						<template #body-content>
							<p class="text-base">
								{{
									__(`Please copy the API secret now. You won't be able to see it again!`)
								}}
							</p>
							<CopyControl :label="__('API Key')" :value="config.api_key" />
							<CopyControl :label="__('API Secret')" :value="apiSecret" />
						</template>
					</Dialog>
				</div>
			</div>
		</div>
	</AppSettingsBody>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Button, createResource, Dialog, SettingsRow, Switch } from 'frappe-ui'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import CopyControl from '@/components/CopyControl.vue'
import { setSettings, webdavConfig } from '@/apps/drive/resources/permissions'

const config = computed(() => webdavConfig.data ?? {})

const globalEnabled = ref(Boolean(config.value.globally_enabled))
const userEnabled = ref(config.value.enabled_for_user === true)

watch(config, (value) => {
	globalEnabled.value = Boolean(value.globally_enabled)
	userEnabled.value = value.enabled_for_user === true
})

const showSecret = ref(false)
const apiSecret = ref('')

const generateKeys = createResource({
	url: 'suite.utils.user.generate_user_keys',
	makeParams: () => ({ user: config.value.username }),
	onSuccess: async (data) => {
		apiSecret.value = data.api_secret
		await webdavConfig.fetch()
		showSecret.value = true
	},
})

const setGlobal = createResource({
	url: 'suite.drive.api.product.set_webdav_enabled',
	onSuccess: () => webdavConfig.fetch(),
})

watch(globalEnabled, (value) => {
	if (value !== Boolean(config.value.globally_enabled)) {
		setGlobal.submit({ enabled: value })
	}
})

watch(userEnabled, (value) => {
	if (value !== (config.value.enabled_for_user === true)) {
		setSettings.submit({ updates: { webdav_enabled: value } })
	}
})
</script>
