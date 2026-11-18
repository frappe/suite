<template>
  <!-- One address, edited in place of the list: the arrow goes back to it -->
  <div v-if="draft" class="flex flex-col gap-4">
    <SettingsDialogBack
      :title="draft.identity.email"
      :label="__('Back to addresses')"
      @back="showList"
    />
    <FormControl v-model="draft.name" :label="__('Display name')" variant="outline" />

    <template v-if="showsReplyAndBcc">
      <EmailListInput
        v-model="draft.replyTo"
        v-model:draft="typed.replyTo"
        :label="__('Reply-to')"
        :description="__('Replies to your mail go to these addresses.')"
        placeholder="name@example.com"
      />
      <EmailListInput
        v-model="draft.bcc"
        v-model:draft="typed.bcc"
        :label="__('Bcc')"
        :description="__('These addresses get a hidden copy of each message you send.')"
        placeholder="name@example.com"
      />
    </template>
    <Button
      v-else
      variant="ghost"
      icon-left="lucide-plus"
      :label="__('Add reply-to or Bcc')"
      class="self-start"
      @click="showReplyAndBcc"
    />

    <FormControl
      v-if="signatures.data?.length"
      v-model="savedSignature"
      type="combobox"
      :label="__('Use saved signature')"
      :options="
        signatures.data?.map((sig) => ({
          label: sig.signature_name,
          value: sig.html_body,
        }))
      "
      variant="outline"
      :open-on-click="true"
      @update:model-value="setSignature"
    />

    <div class="space-y-1.5">
      <label class="text-ink-gray-5 block text-xs">
        {{ __('Default signature') }}
      </label>
      <MailRichTextField
        :model-value="draft.signature"
        :placeholder="__('Write your signature here')"
        @update:model-value="setSignature"
      />
    </div>

    <SettingsDialogActions>
      <Button
        :label="__('Save')"
        variant="solid"
        :size="buttonSize"
        :disabled="isSaveBlocked"
        :loading="saveIdentity.isPending"
        @click="save"
      />
    </SettingsDialogActions>
  </div>
  <div v-else-if="newAddress" class="flex flex-col gap-4">
    <SettingsDialogBack
      :title="__('New address')"
      :label="__('Back to addresses')"
      @back="showList"
    />
    <FormControl
      v-model="newAddress.email"
      :label="__('Email address')"
      placeholder="johndoe@example.com"
      type="email"
      variant="outline"
      :required="true"
    />
    <FormControl
      v-model="newAddress.name"
      :label="__('Display name')"
      placeholder="John Doe"
      variant="outline"
    />
    <SettingsDialogActions>
      <Button
        :label="__('Save')"
        variant="solid"
        :size="buttonSize"
        :disabled="isCreateBlocked"
        :loading="addIdentity.isPending"
        @click="createAddress"
      />
    </SettingsDialogActions>
  </div>
  <div v-else class="flex flex-col gap-3">
    <SettingsDialogActions>
      <Button
        variant="solid"
        icon-left="lucide-plus"
        :label="__('New address')"
        :size="buttonSize"
        @click="addAddress"
      />
    </SettingsDialogActions>
    <div v-if="identities.data?.length">
      <div
        v-for="identity in identities.data"
        :key="identity.name"
        class="hover:bg-surface-gray-1 -mx-2 flex items-center rounded-4 px-3 max-sm:-mx-4 max-sm:px-4"
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 items-baseline gap-2 py-2 text-left text-base"
          @click="editAddress(identity)"
        >
          <span class="text-ink-gray-8 truncate">{{ titleOf(identity) }}</span>
          <span v-if="identity._name" class="text-ink-gray-5 truncate">{{ identity.email }}</span>
          <Badge v-if="isDefault(identity)" :label="__('Default')" size="sm" class="self-center" />
        </button>
        <AdaptiveDropdown :options="addressOptions(identity)" :title="titleOf(identity)">
          <Button variant="ghost" :aria-label="__('More for {0}', [identity.email])">
            <template #icon>
              <Ellipsis class="text-ink-gray-5 h-4 w-4" />
            </template>
          </Button>
        </AdaptiveDropdown>
      </div>
    </div>
    <div v-else-if="isListRead" class="text-ink-gray-6 flex flex-col space-y-2 text-sm">
      <p class="text-base font-medium">{{ __('No send-as addresses yet') }}</p>
      <p>
        {{ __('Send-as addresses are the addresses you send mail as. Create one to get started.') }}
      </p>
    </div>
    <Dialog
      v-model:open="showDeleteDialog"
      v-bind="{
        title: __('Delete this address?'),
        message: __('This cannot be undone.'),
        actions: [
          {
            label: __('Delete address'),
            variant: 'solid' as const,
            theme: 'red' as const,
            loading: deleteIdentity.isPending,
            onClick: () => deleteIdentitySubmit(),
          },
        ],
      }"
    />
  </div>
</template>

<script setup lang="ts">
import { Badge, Button, Dialog, FormControl } from 'frappe-ui'
import { Edit2, Ellipsis, Pin, Trash2 } from 'lucide-vue-next'
import { computed, reactive, ref } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import EmailListInput from '@/apps/mail/components/Controls/EmailListInput.vue'
import MailRichTextField from '@/apps/mail/components/Controls/MailRichTextField.vue'
import { useAccountPreferences } from '@/apps/mail/composables/useAccountPreferences'
import { userStore } from '@/apps/mail/stores/user'
import type { Identity } from '@/apps/mail/types'
import { isEmail, raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import AdaptiveDropdown from '@/components/AdaptiveDropdown.vue'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'
import SettingsDialogBack from '@/platform/settings/SettingsDialogBack.vue'
import { translate as __ } from '@/platform/translation'

const store = userStore()
const { identities } = store
const { isMobile } = useScreenSize()
const buttonSize = computed(() => (isMobile.value ? 'md' : 'sm'))
const signatures = useQuery(api.mail.signatures.list)

type Address = Identity['reply_to'][number]

/** The address that is open, and what its form holds. */
interface Draft {
  identity: Identity
  name: string
  replyTo: string[]
  bcc: string[]
  signature: string
}

// Unset, the list shows
const draft = ref<Draft>()
const original = ref('')
// What is typed in each box and not yet an address of its list
const typed = reactive({ replyTo: '', bcc: '' })
// Few addresses have a reply-to or a Bcc, so the two boxes wait behind a button until one is used
const showsReplyAndBcc = ref(false)
function showReplyAndBcc() {
  showsReplyAndBcc.value = true
}

function emailsOf(addresses?: Address[]) {
  return (addresses ?? []).map((address) => address.email)
}

function editAddress(identity: Identity) {
  draft.value = {
    identity,
    name: identity._name ?? '',
    replyTo: emailsOf(identity.reply_to),
    bcc: emailsOf(identity.bcc),
    signature: identity.html_signature ?? '',
  }
  original.value = JSON.stringify(draft.value)
  Object.assign(typed, { replyTo: '', bcc: '' })
  showsReplyAndBcc.value = draft.value.replyTo.length + draft.value.bcc.length > 0
}

const newAddress = ref<{ email: string; name: string }>()
function addAddress() {
  newAddress.value = { email: '', name: '' }
}

function titleOf(identity: Identity) {
  return identity._name || identity.email
}

const isListRead = computed(() => !identities.isFetching)
function showList() {
  draft.value = undefined
  newAddress.value = undefined
}

// Nothing to save until the form differs from the address as it was read, and nothing that is
// not an address is sent
const isSaveBlocked = computed(() => {
  const form = draft.value
  if (!form || identities.isFetching) {
    return true
  }

  const isUnchanged = JSON.stringify(form) === original.value && !typed.replyTo && !typed.bcc

  return isUnchanged || ![...form.replyTo, ...form.bcc].every(isEmail)
})

// The boxes hold addresses alone, so one that was saved with a display name keeps it
function withNames(emails: string[], saved?: Address[]) {
  return emails.map((email) => {
    const kept = saved?.find((address) => address.email === email)

    return { email, display_name: kept?.display_name ?? '' }
  })
}

const saveIdentity = useMutation(api.mail.identities.save)
async function save() {
  const form = draft.value
  if (!form) {
    return
  }

  await saveIdentity.run({
    account: form.identity.account,
    id: form.identity.id,
    name: form.name,
    reply_to: withNames(form.replyTo, form.identity.reply_to),
    bcc: withNames(form.bcc, form.identity.bcc),
    html_signature: form.signature,
  })
  raiseToast(__('Address updated'))
  showList()
}

function setSignature(value: string) {
  if (draft.value) {
    draft.value.signature = value
  }
}

const savedSignature = ref('')
const addIdentity = useMutation(api.mail.identities.create)
const isCreateBlocked = computed(() => !newAddress.value?.email)
async function createAddress() {
  if (!newAddress.value) {
    return
  }

  await addIdentity.run({ account: store.accountId, ...newAddress.value })
  raiseToast(__('Address created'))
  showList()
}

// The address a new message starts from, found as the composer finds it: the saved one, or the
// first when none is saved
const { preferences, change } = useAccountPreferences()
const defaultEmail = computed(() => {
  if (!preferences.value) {
    return undefined
  }

  const saved = preferences.value.default_outgoing_email?.toLowerCase()
  const emails = (identities.data ?? []).map((identity) => identity.email)

  return emails.find((address) => address.toLowerCase() === saved) ?? emails[0]
})
function isDefault(identity: Identity) {
  return identity.email === defaultEmail.value
}

// The address the question "Delete this address?" is about
const deleting = ref<Identity>()
const showDeleteDialog = ref(false)
function askToDelete(identity: Identity) {
  deleting.value = identity
  showDeleteDialog.value = true
}

const deleteIdentity = useMutation(api.mail.identities.delete)
async function deleteIdentitySubmit() {
  if (!deleting.value) {
    return
  }

  await deleteIdentity.run({ names: [deleting.value.name] })
  raiseToast(__('Address deleted'))
  showDeleteDialog.value = false
}

function addressOptions(identity: Identity) {
  return [
    {
      label: __('Set as default'),
      icon: Pin,
      condition: () => !isDefault(identity),
      onClick: () => change({ default_outgoing_email: identity.email }),
    },
    {
      label: __('Edit'),
      icon: Edit2,
      onClick: () => editAddress(identity),
    },
    {
      label: __('Delete'),
      icon: Trash2,
      theme: 'red' as const,
      condition: () => !!identity.may_delete,
      onClick: () => askToDelete(identity),
    },
  ]
}
</script>
