<template>
	<Dialog
		v-model:open="show"
	 v-bind="{
			title: __('Add Member'),
			actions: [
				{
					label: __(accountRequest.send_invite ? 'Invite Member' : 'Add Member'),
					variant: 'solid',
					loading: addMember.loading,
					onClick: addMember.submit,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<div class="space-y-3">
					<div v-for="(email, index) in emails" :key="index" class="space-y-1.5">
						<div class="flex items-center justify-between">
							<label class="text-ink-gray-5 block text-xs">
								{{ index === 0 ? __('Primary Email') : __('Alias') }}
							</label>
							<Button
								v-if="index > 0"
								variant="ghost"
								theme="red"
								size="sm"
								:label="__('Remove')"
								@click="emails.splice(index, 1)"
							/>
						</div>
						<div class="flex items-center justify-between">
							<FormControl
								v-model="email.username"
								placeholder="johndoe"
								class="w-full"
							/>
							<FeatherIcon class="text-ink-gray-3 mx-2.5 h-4 w-4" name="at-sign" />
							<FormControl
								v-model="email.domain"
								type="combobox"
								placeholder="yourdomain.com"
								class="w-full"
								:options="domains.data"
								:open-on-click="true"
							/>
						</div>
					</div>
					<Button
						variant="ghost"
						size="sm"
						:label="__('Add another email')"
						@click="emails.push({ username: '', domain: emails[0]?.domain || '' })"
					>
						<template #prefix>
							<FeatherIcon name="plus" class="h-4 w-4" />
						</template>
					</Button>
				</div>
				<FormControl
					v-model="accountRequest.role"
					type="select"
					:label="__('Role')"
					:options="ROLE_OPTIONS"
				/>
				<FormControl
					v-model="accountRequest.backup_email"
					type="email"
					:label="__('Backup Email')"
					placeholder="johndoe@personal.com"
					:description="__('Password resets and the invitation email are sent to this address.')"
				/>
				<FormControl
					v-model="accountRequest.quota_gb"
					type="number"
					:min="0"
					:label="__('Quota (GB, 0 = unlimited)')"
					:description="__('Leave blank to use the configured default disk quota.')"
				/>
				<div class="space-y-1.5">
					<label class="text-ink-gray-5 block text-xs">{{ __('Groups') }}</label>
					<MultiSelect v-model="groupIds" :options="groupOptions" />
				</div>
				<div class="space-y-1.5">
					<label class="text-ink-gray-5 block text-xs">{{ __('Mailing Lists') }}</label>
					<MultiSelect v-model="mailingListIds" :options="mailingListOptions" />
				</div>
				<hr />

				<Switch
					v-model="accountRequest.send_invite"
					:label="__('Send Invite')"
					class="hover:!bg-surface-base !cursor-default !p-0"
				/>
				<FormControl
					v-if="accountRequest.send_invite"
					v-model="accountRequest.expires_at"
					:label="__('Expires At')"
					type="datetime-local"
					:description="__('The invitation link stops working after this time.')"
				/>
				<template v-else>
					<FormControl
						v-model="accountRequest.first_name"
						:label="__('First Name')"
						placeholder="John"
					/>
					<FormControl
						v-model="accountRequest.last_name"
						:label="__('Last Name')"
						placeholder="Doe"
					/>
					<FormControl
						v-model="accountRequest.password"
						type="password"
						:label="__('Password')"
						placeholder="••••••••"
						:description="__('The member can change this later in their account settings.')"
					/>
					<!-- Only set here when the account is created right away; an invited member picks
					their own on the setup form. -->
					<div class="space-y-1.5">
						<label class="text-ink-gray-5 block text-xs">{{ __('Locale') }}</label>
						<Combobox
							v-model="accountRequest.locale"
							:options="localeOptions"
							:placeholder="__('Select a locale')"
						/>
					</div>
					<div class="space-y-1.5">
						<label class="text-ink-gray-5 block text-xs">{{ __('Time Zone') }}</label>
						<Combobox
							v-model="accountRequest.time_zone"
							:options="timeZoneOptions"
							:placeholder="__('Select a time zone')"
						/>
					</div>
				</template>
				<ErrorMessage
					:message="addMember.error && (addMember.error?.messages?.[0] || addMember.error?.message || __('Request failed.'))"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
	Button, Combobox, Dialog, ErrorMessage, FormControl, MultiSelect, Switch, createResource } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import { raiseToast } from '@/apps/mail/utils'
import { fromLocalInput, toLocalInput, utcFromNow } from '@/apps/mail/utils/datetime'
import { useAccountOptions } from '@/apps/mail/composables/useAccountOptions'
import { userStore } from '@/apps/mail/stores/user'

const show = defineModel<boolean>()

const { domains } = userStore()

const ROLE_OPTIONS = [
	{ label: __('User'), value: 'user' },
	{ label: __('Admin'), value: 'admin' },
]

const defaultAccountRequest = {
	role: 'user',
	send_invite: true,
	expires_at: '',
	backup_email: '',
	// Blank hands the choice to the server, which falls back to the configured default.
	quota_gb: '',
	first_name: '',
	last_name: '',
	password: '',
	locale: '',
	time_zone: '',
}

const accountRequest = reactive({ ...defaultAccountRequest })
const emails = ref<{ username: string; domain: string }[]>([{ username: '', domain: '' }])
const groupIds = ref<string[]>([])
const mailingListIds = ref<string[]>([])

const emit = defineEmits(['reload'])

type Directory = { id: string; name: string; email?: string }

// The account joins these once it exists: immediately when the invite is skipped, otherwise when the
// invited member verifies and their account is created. Both are read live from Stalwart, so they are
// fetched when the dialog opens rather than on every visit to the members list.
const groups = createResource({ url: 'suite.mail.api.admin.get_groups' })
const mailingLists = createResource({ url: 'suite.mail.api.admin.get_mailing_lists' })

const toOptions = (rows: Directory[]) => rows.map((r) => ({ label: r.email || r.name, value: r.id }))
const groupOptions = computed(() => toOptions(groups.data || []))
const mailingListOptions = computed(() => toOptions(mailingLists.data || []))

const { localeOptions, timeZoneOptions } = useAccountOptions()

watch(
	() => accountRequest.send_invite,
	() => addMember.reset(),
)
watch(show, () => {
	if (show.value) {
		// Shown and typed in the user's zone (converted to UTC on submit), and seeded here rather
		// than in the default shape so a dialog opened later gets a fresh expiry.
		Object.assign(accountRequest, defaultAccountRequest, {
			expires_at: toLocalInput(utcFromNow(1, 'day')),
		})
		emails.value = [{ username: '', domain: '' }]
		groupIds.value = []
		mailingListIds.value = []
		groups.fetch()
		mailingLists.fetch()
		addMember.reset()
	}
})

const addMember = createResource({
	url: 'suite.mail.api.admin.add_member',
	makeParams: () => {
		const [primary, ...rest] = emails.value
		const aliases = rest
			.filter((e) => e.username && e.domain)
			.map((e) => `${e.username}@${e.domain}`)

		return {
			...accountRequest,
			username: primary?.username || '',
			domain: primary?.domain || '',
			aliases,
			groups: groupIds.value,
			mailing_lists: mailingListIds.value,
			expires_at: fromLocalInput(accountRequest.expires_at),
			quota_gb: accountRequest.quota_gb === '' ? null : Number(accountRequest.quota_gb),
			// Blank means "server default" for both, which the API spells as null.
			locale: accountRequest.locale || null,
			time_zone: accountRequest.time_zone || null,
			is_admin: accountRequest.role === 'admin',
		}
	},
	onSuccess: () => {
		raiseToast(accountRequest.send_invite ? __('Member invited.') : __('Member added.'))
		emit('reload')
		show.value = false
	},
})
</script>
