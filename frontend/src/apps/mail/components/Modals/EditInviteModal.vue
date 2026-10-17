<template>
  <Dialog
    v-if="draft"
    v-model:open="show"
    v-bind="{
      title: __('Edit Invite'),
      actions: [
        ...(canSendInvite
          ? [
              {
                label: __('Send Invitation Email'),
                loading: send.isPending,
                onClick: sendInvitationEmail,
              },
            ]
          : []),
        {
          label: __('Save'),
          variant: 'solid' as const,
          disabled: !isEditableInvite || !isDirty,
          loading: save.isPending,
          onClick: saveInvite,
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-4">
        <FormControl
          v-model="draft.account"
          type="email"
          :label="__('Assigned business email')"
          :disabled="!isEditableInvite"
          :description="
            __(
              'Changing the address or role invalidates the previous acceptance link. Send a new invitation afterwards.',
            )
          "
        />
        <FormControl
          v-model="inviteAdmin"
          type="checkbox"
          :label="__('Business Admin')"
          :disabled="!isEditableInvite"
        />
        <FormControl
          v-if="draft.aliases"
          type="textarea"
          :label="__('Aliases')"
          :value="draft.aliases"
          disabled
        />
        <FormControl
          v-model="inviteQuota"
          type="number"
          :min="0"
          :label="__('Combined personal cap (GB)')"
          :description="__('Leave blank for uncapped. This limits Drive growth, never Mail.')"
          :disabled="!isEditableInvite"
        />
        <!-- Fixed when the request was created (set_only_once on the doctype), so the roles the
				account is created with cannot be changed on an existing invite. -->
        <FormControl :label="__('Role')" :value="roleLabel" disabled />
        <FormControl :label="__('Backup Email')" :value="draft.backup_email" disabled />
        <FormControl :label="__('Invited By')" :value="draft.invited_by" disabled />
        <FormControl
          v-model="inviteExpiresAt"
          type="datetime-local"
          :label="__('Expires At')"
          :description="__('The request can no longer create an account after this time.')"
          :disabled="!isEditableInvite"
        />
        <hr />

        <!-- Disable Receiving, Send Invite, the aliases and the memberships are fixed when the
				request is created (set_only_once on the doctype), so they are all shown read-only. -->
        <Switch
          :model-value="Boolean(draft.disable_receiving)"
          :label="__('Disable Receiving')"
          :description="__('The account can send emails but cannot receive them.')"
          disabled
          class="hover:!bg-surface-base !cursor-default !p-0"
        />
        <Switch
          :model-value="Boolean(draft.send_invite)"
          :label="__('Send Invite')"
          disabled
          class="hover:!bg-surface-base !cursor-default !p-0"
        />
        <template v-if="groupIds.length || mailingListIds.length">
          <hr />
          <p class="text-ink-gray-5 text-xs font-medium">{{ __('Account Details') }}</p>
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
import { Dialog, FormControl, Switch } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, useQuery, type OutputOf } from '@/api'
import { raiseToast } from '@/apps/mail/utils'
import { fromLocalInput, toLocalInput } from '@/apps/mail/utils/datetime'

const show = defineModel<boolean>()
const { inviteID } = defineProps<{ inviteID: string }>()
const emit = defineEmits(['reloadInvites'])
const invitation = useQuery(api.mail.admin.invites.get, () =>
  show.value ? { name: inviteID } : false,
)
const draft = ref<OutputOf<typeof api.mail.admin.invites.get>>()
const inviteAdmin = computed({
  get: () => !!draft.value?.is_admin,
  set: (value) => {
    if (draft.value) draft.value.is_admin = value ? 1 : 0
  },
})
watch(
  () => invitation.data,
  (data) => {
    draft.value = data ? { ...data } : undefined
  },
  { immediate: true },
)
const save = useMutation(api.mail.admin.invites.update)
const send = useMutation(api.mail.admin.invites.send)
const isDirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(invitation.data))
const roleLabel = computed(() => (draft.value?.is_admin ? __('Admin') : __('User')))
const isEditableInvite = computed(() => draft.value && !draft.value.is_verified)
const inviteQuota = computed<number | string>({
  get: () =>
    draft.value?.combined_cap_bytes == null ? '' : draft.value.combined_cap_bytes / 1_000_000_000,
  set: (value) => {
    if (draft.value)
      draft.value.combined_cap_bytes = value === '' ? null : Number(value) * 1_000_000_000
  },
})
const inviteExpiresAt = computed({
  get: () => toLocalInput(draft.value?.expires_at),
  set: (value: string) => {
    if (draft.value) draft.value.expires_at = fromLocalInput(value)
  },
})
const canSendInvite = computed(
  () => isEditableInvite.value && !isDirty.value && Boolean(draft.value?.invited_by),
)
const groups = useQuery(api.mail.admin.groups.list, () =>
  show.value ? { page_length: 500 } : false,
)
const mailingLists = useQuery(api.mail.admin.mailingLists.list, () =>
  show.value ? { page_length: 500 } : false,
)
const lines = (value?: string | null) =>
  (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
const labelsFor = (rows: readonly { id: string; name: string; email: string }[], ids: string[]) => {
  const labels = new Map(rows.map((row) => [row.id, row.email || row.name]))
  return ids.map((id) => labels.get(id) ?? id)
}
const groupIds = computed(() => lines(draft.value?.groups))
const mailingListIds = computed(() => lines(draft.value?.mailing_lists))
const groupLabels = computed(() => labelsFor(groups.data?.items ?? [], groupIds.value))
const mailingListLabels = computed(() =>
  labelsFor(mailingLists.data?.items ?? [], mailingListIds.value),
)
async function saveInvite() {
  if (!isEditableInvite.value || !draft.value) return
  await save.run({
    name: inviteID,
    expires_at: draft.value.expires_at,
    combined_cap_bytes: draft.value.combined_cap_bytes,
    account: draft.value.account,
    is_admin: !!draft.value.is_admin,
  })
  show.value = false
  raiseToast(__('Invite updated.'))
  emit('reloadInvites')
}
async function sendInvitationEmail() {
  if (!canSendInvite.value) return
  await send.run({ name: inviteID })
  raiseToast(__('Invitation email sent.'))
}
</script>
