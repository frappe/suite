<template>
	<Dialog
		v-if="accountRequest?.doc"
		v-model:open="show"
	 v-bind="{
			title: __('Edit Invite'),
			actions: [
				...(canSendInvite
					? [
							{
								label: __('Send Invitation Email'),
								loading: accountRequest.sendVerificationEmail?.loading,
								onClick: sendInvitationEmail,
							},
						]
					: []),
				{
					label: __('Save'),
					variant: 'solid',
					disabled: !isEditableInvite || !accountRequest.isDirty,
					loading: accountRequest.save?.loading,
					onClick: saveInvite,
				},
			],
		}"
	>
		<template #default>
			<div class="space-y-4">
				<FormControl
					:label="__('Assigned Email')"
					:value="accountRequest.doc.account"
					disabled
				/>
				<FormControl
					v-if="accountRequest.doc.aliases"
					type="textarea"
					:label="__('Aliases')"
					:value="accountRequest.doc.aliases"
					disabled
				/>
				<FormControl
					v-model="inviteQuota"
					type="number"
					:min="0"
					:label="__('Quota (GB, 0 = unlimited)')"
					:description="__('Leave blank to use the configured default disk quota.')"
					:disabled="!isEditableInvite"
				/>
				<!-- Fixed when the request was created (set_only_once on the doctype), so the roles the
				account is created with cannot be changed on an existing invite. -->
				<FormControl :label="__('Role')" :value="roleLabel" disabled />
				<FormControl
					:label="__('Backup Email')"
					:value="accountRequest.doc.backup_email"
					disabled
				/>
				<FormControl
					:label="__('Invited By')"
					:value="accountRequest.doc.invited_by"
					disabled
				/>
				<FormControl
					v-model="inviteExpiresAt"
					type="datetime-local"
					:label="__('Expires At')"
					:description="__('The request can no longer create an account after this time.')"
					:disabled="!isEditableInvite"
				/>
				<hr />

				<!-- Send Invite, the aliases and the memberships are fixed when the request is created
				(set_only_once on the doctype), so they are all shown read-only. -->
				<Switch
					:model-value="Boolean(accountRequest.doc.send_invite)"
					:label="__('Send Invite')"
					disabled
					class="hover:!bg-surface-base !cursor-default !p-0"
				/>
				<template v-if="groupIds.length || mailingListIds.length">
					<hr />
					<p class="text-ink-gray-5 text-xs font-medium">{{ __('Membership Details') }}</p>
					<FormControl
						v-if="groupIds.length"
						:label="__('Groups')"
						:value="groupLabels.join(', ')"
						disabled
					/>
					<FormControl
						v-if="mailingListIds.length"
						:label="__('Mailing Lists')"
						:value="mailingListLabels.join(', ')"
						disabled
					/>
				</template>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Dialog, FormControl, Switch, createDocumentResource, createResource } from 'frappe-ui'

import dayjs from '@/apps/mail/utils/dayjs'
import { raiseToast } from '@/apps/mail/utils'
import { formatSystemDateTime, systemTimeZone, toSystemDateTime } from '@/apps/mail/utils/datetime'

const show = defineModel<boolean>()

const { inviteID } = defineProps<{ inviteID: string }>()

const emit = defineEmits(['reloadInvites'])

type InviteDoc = {
	account: string
	aliases?: string
	is_admin: boolean | 0 | 1
	backup_email: string
	invited_by: string
	expires_at?: string
	quota_gb?: number | null
	send_invite: boolean | 0 | 1
	is_verified: boolean | 0 | 1
	groups?: string
	mailing_lists?: string
}

type MethodResource = { submit?: () => void; loading?: boolean }

type AccountRequestResource = {
	doc?: InviteDoc
	isDirty: boolean
	save?: { submit?: () => void; loading?: boolean }
	reload?: () => void
	sendVerificationEmail?: MethodResource
}

type Directory = { id: string; name: string; email?: string }

const accountRequest = ref<AccountRequestResource>()

const roleLabel = computed(() => (accountRequest.value?.doc?.is_admin ? __('Admin') : __('User')))

// Cleared back to null rather than 0, so a blank field keeps deferring to the configured default
// instead of silently meaning unlimited.
const inviteQuota = computed<number | string>({
	get: () => accountRequest.value?.doc?.quota_gb ?? '',
	set: (value) => {
		if (!accountRequest.value?.doc) return
		accountRequest.value.doc.quota_gb = value === '' ? null : Number(value)
	},
})

const isEditableInvite = computed(() => {
	const doc = accountRequest.value?.doc
	if (!doc) return false
	return !doc.is_verified
})

// `expires_at` is a naive system-zone DB field saved straight through the doc resource; the
// input edits it as a wall clock in the user's zone, converting on both sides. This also feeds
// the `datetime-local` input the `YYYY-MM-DDTHH:mm` shape it demands — the raw DB string
// (space-separated) would render an empty box.
const inviteExpiresAt = computed<string>({
	get: () => formatSystemDateTime(accountRequest.value?.doc?.expires_at, 'YYYY-MM-DDTHH:mm'),
	set: (value) => {
		if (!accountRequest.value?.doc) return
		accountRequest.value.doc.expires_at = toSystemDateTime(value)
	},
})

// Expiry is read off the local doc so extending it lights the send action up only once saved.
// The stored value is system-zone; compare instants, not the browser's reading of the string.
const isExpired = computed(() => {
	const expiresAt = accountRequest.value?.doc?.expires_at
	return Boolean(expiresAt) && dayjs.tz(expiresAt as string, systemTimeZone()).isBefore(dayjs())
})

// The server sends the link with whatever is stored, so pending edits have to be saved first.
// Self-signup requests (empty invited_by) verify by OTP instead - the server would not send
// an invitation email for them.
const canSendInvite = computed(
	() =>
		isEditableInvite.value &&
		!isExpired.value &&
		!accountRequest.value?.isDirty &&
		Boolean(accountRequest.value?.doc?.invited_by),
)

// The account request stores the ids it was created with; the labels come from the live directory.
const groups = createResource({ url: 'suite.mail.api.admin.get_groups' })
const mailingLists = createResource({ url: 'suite.mail.api.admin.get_mailing_lists' })

const lines = (value?: string) =>
	(value || '')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)

const labelsFor = (rows: Directory[], ids: string[]) => {
	const map = new Map(rows.map((r) => [String(r.id), r.email || r.name]))
	return ids.map((id) => map.get(id) || id)
}

const groupIds = computed(() => lines(accountRequest.value?.doc?.groups))
const mailingListIds = computed(() => lines(accountRequest.value?.doc?.mailing_lists))
const groupLabels = computed(() => labelsFor(groups.data || [], groupIds.value))
const mailingListLabels = computed(() => labelsFor(mailingLists.data || [], mailingListIds.value))

const saveInvite = () => {
	if (!isEditableInvite.value) return
	accountRequest.value?.save?.submit?.()
}

const sendInvitationEmail = () => {
	if (!canSendInvite.value) return
	accountRequest.value?.sendVerificationEmail?.submit?.()
}

const getMailAccountRequest = () =>
	createDocumentResource({
		doctype: 'Mail Account Request',
		name: inviteID,
		setValue: {
			onSuccess: () => {
				show.value = false
				raiseToast(__('Invite updated.'))
				emit('reloadInvites')
			},
			onError: (error: { messages?: string[]; message?: string }) => {
				raiseToast(error?.messages?.[0] || error?.message || __('Request failed.'), 'error')
				accountRequest.value?.reload?.()
			},
		},
		whitelistedMethods: {
			sendVerificationEmail: {
				method: 'send_verification_email',
				onSuccess: () => raiseToast(__('Invitation email sent.')),
				onError: (error: { messages?: string[]; message?: string }) =>
					raiseToast(error?.messages?.[0] || error?.message || __('Request failed.'), 'error'),
			},
		},
	})

watch(
	show,
	(val) => {
		if (val) accountRequest.value = getMailAccountRequest()
	},
	{ immediate: true },
)

// Both are live Stalwart reads, so they are only fetched for invites that carry memberships.
watch(groupIds, (ids) => {
	if (ids.length && !groups.fetched && !groups.loading) groups.fetch()
})
watch(mailingListIds, (ids) => {
	if (ids.length && !mailingLists.fetched && !mailingLists.loading) mailingLists.fetch()
})
</script>
