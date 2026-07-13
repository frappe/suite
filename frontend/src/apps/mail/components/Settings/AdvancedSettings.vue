<template>
	<AppSettingsHeader :title="__('Advanced')" />
	<AppSettingsBody>
		<div class="flex flex-col gap-5">
			<h2 class="text-base-semibold text-ink-gray-8">{{ __('API Access') }}</h2>
			<CopyControl
				v-if="user.data?.api_key"
				:label="__('API Key')"
				:value="user.data?.api_key"
			/>
			<p v-else class="text-base">
				{{ __(`You don't have an API key yet. Generate one to access the API.`) }}
			</p>
			<Button
				class="min-h-7 self-start"
				:label="user.data?.api_key ? __('Regenerate Secret') : __('Generate Keys')"
				@click="generateKeys.submit()"
			/>

			<Dialog v-model="showSecret" :options="{ title: __('API Access') }">
				<template #body-content>
					<p class="text-base">
						{{
							__(`Please copy the API secret now. You won’t be able to see it again!`)
						}}
					</p>
					<CopyControl :label="__('API Key')" :value="user.data?.api_key" />
					<CopyControl :label="__('API Secret')" :value="apiSecret" />
				</template>
			</Dialog>

			<div v-if="configRows.length" class="space-y-4 border-t pt-5">
				<div class="space-y-1">
					<h2 class="text-base-semibold text-ink-gray-8">
						{{ __('Mail Client Configuration') }}
					</h2>
					<p class="text-ink-gray-6 text-base">
						{{
							__(
								'Use these details to connect a third-party mail client such as Thunderbird or the Gmail app.',
							)
						}}
					</p>
				</div>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div
						v-for="row in configRows"
						:key="row.key"
						class="space-y-3 rounded-lg border p-4"
					>
						<div class="flex items-center justify-between gap-2">
							<span class="text-ink-gray-8 font-medium">{{ row.protocol }}</span>
							<Badge
								:label="row.connection_security"
								theme="gray"
								variant="subtle"
							/>
						</div>
						<div class="space-y-2 text-base">
							<div
								v-for="field in row.fields"
								:key="field.label"
								class="flex items-center justify-between gap-3"
							>
								<span class="text-ink-gray-5">{{ field.label }}</span>
								<Tooltip :text="__('Click to copy')">
									<span
										class="text-ink-gray-8 cursor-copy truncate"
										@click="copyToClipBoard(field.value)"
									>
										{{ field.value }}
									</span>
								</Tooltip>
							</div>
						</div>
					</div>
				</div>

				<CopyControl :label="__('Username')" :value="user.data?.email" />
				<p class="text-ink-gray-5 text-sm">
					{{ __('Sign in using your existing mail account password.') }}
				</p>
			</div>
		</div>
	</AppSettingsBody>
</template>
<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import {
	Badge,
	Button,
	Dialog,
	Tooltip,
	createResource,
} from 'frappe-ui'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'

import CopyControl from '@/apps/mail/components/Controls/CopyControl.vue'
import { copyToClipBoard } from '@/apps/mail/utils'

const user = inject('$user')

const showSecret = ref(false)
const apiSecret = ref('')

const generateKeys = createResource({
	url: 'suite.mail.utils.user.generate_user_keys',
	makeParams: () => ({ user: user.data?.name }),
	onSuccess: (data) => {
		if (!user.data?.api_key) user.reload()
		apiSecret.value = data.api_secret
		showSecret.value = true
	},
})

const clientConfig = createResource({
	url: 'suite.mail.api.account.get_mail_client_config',
	auto: true,
})

const configRows = computed(() =>
	(clientConfig.data ?? []).map(
		(row: Record<string, string | number>, index: number) => ({
			key: `${row.protocol}-${row.port}-${index}`,
			protocol: row.protocol,
			connection_security: row.connection_security,
			fields: [
				{ label: __('Hostname'), value: String(row.hostname) },
				{ label: __('Port'), value: String(row.port) },
			],
		}),
	),
)
</script>
