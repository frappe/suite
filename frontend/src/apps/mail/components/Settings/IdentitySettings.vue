<template>
  <!-- One address, edited in place of the list: the arrow goes back to it -->
  <div v-if="draft" class="flex flex-col gap-4">
    <SettingsDialogBack
      :title="draft.identity.email"
      :label="__('Back to addresses')"
      @back="showList"
    />
    <FormControl v-model="draft.name" :label="__('Display name')" variant="outline" />

    <FormControl
      type="select"
      :model-value="signatureChoice"
      :label="__('Signature')"
      :options="signatureChoices"
      variant="outline"
      @update:model-value="chooseSignature"
    />
    <MailRichTextField
      v-if="isWritingSignature"
      v-model="draft.signature"
      :placeholder="__('Write your signature here')"
    />
    <!-- Last of the fields, as the two fewest addresses use -->
    <template v-if="showsReplyAndBcc">
      <NamedAddressList
        v-model="draft.replyTo"
        :label="__('Reply-to')"
        :description="__('Replies to your mail go to these addresses.')"
        :is-checked="isChecked"
      />
      <NamedAddressList
        v-model="draft.bcc"
        :label="__('Bcc')"
        :description="__('These addresses get a hidden copy of each message you send.')"
        :is-checked="isChecked"
      />
    </template>
    <Button
      v-else
      icon-left="lucide-plus"
      :label="__('Add reply-to or Bcc')"
      :size="buttonSize"
      class="self-start"
      @click="showReplyAndBcc"
    />
    <ErrorMessage :message="saveError" />
    <SettingsDialogActions>
      <!-- At the dialog's other end from Save, so neither is pressed for the other -->
      <Button
        v-if="draft.identity.may_delete"
        :label="__('Delete')"
        theme="red"
        :size="buttonSize"
        class="me-auto"
        @click="askToDelete(draft.identity)"
      />
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
      :error="emailError"
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
    <SettingsEmptyList
      v-else-if="isListRead"
      :title="__('No send-as addresses yet')"
      :description="
        __('Send-as addresses are the addresses you send mail as. Create one to get started.')
      "
    />
  </div>
  <!-- Outside the pages above: the list and an open address both ask it -->
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
</template>

<script setup lang="ts">
import { Badge, Button, Dialog, ErrorMessage, FormControl } from 'frappe-ui'
import { Edit2, Ellipsis, Pin, Trash2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import MailRichTextField from '@/apps/mail/components/Controls/MailRichTextField.vue'
import NamedAddressList from '@/apps/mail/components/Controls/NamedAddressList.vue'
import { useAccountPreferences } from '@/apps/mail/composables/useAccountPreferences'
import { userStore } from '@/apps/mail/stores/user'
import type { Identity } from '@/apps/mail/types'
import { isEmail, raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { failureLine } from '@/platform/feedback'
import AdaptiveDropdown from '@/platform/feedback/AdaptiveDropdown.vue'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'
import SettingsDialogBack from '@/platform/settings/SettingsDialogBack.vue'
import SettingsEmptyList from '@/platform/settings/SettingsEmptyList.vue'
import { translate as __ } from '@/platform/translation'

const store = userStore()
const { identities } = store
const { isMobile } = useScreenSize()
const buttonSize = computed(() => (isMobile.value ? 'md' : 'sm'))
const signatures = useQuery(api.mail.signatures.list)

/** A reply-to or Bcc address as its row holds it: one saved without a name has an empty one. */
interface Address {
  email: string
  display_name: string
}

function rowsOf(addresses?: Identity['reply_to']) {
  return (addresses ?? []).map(({ email, display_name }) => ({
    email,
    display_name: display_name ?? '',
  }))
}

/** The address that is open, and what its form holds. */
interface Draft {
  identity: Identity
  name: string
  replyTo: Address[]
  bcc: Address[]
  signature: string
  // The signature choice made in the form, if one was: unset, it is read off the words
  picked?: string
}

function draftOf(identity: Identity): Draft {
  return {
    identity,
    name: identity._name ?? '',
    replyTo: rowsOf(identity.reply_to),
    bcc: rowsOf(identity.bcc),
    signature: identity.html_signature ?? '',
  }
}

// Unset, the list shows
const draft = ref<Draft>()
// Few addresses have a reply-to or a Bcc, so the two lists wait behind a button until one is used
const showsReplyAndBcc = ref(false)
function showReplyAndBcc() {
  const form = draft.value
  if (!form) {
    return
  }

  // Each opens on a row to type in
  form.replyTo.push({ email: '', display_name: '' })
  form.bcc.push({ email: '', display_name: '' })
  showsReplyAndBcc.value = true
}

// The rows of a list that hold something: one left empty is no address
function filled(addresses: Address[]) {
  return addresses.flatMap((address) => {
    const row = { email: address.email.trim(), display_name: address.display_name.trim() }
    if (!row.email && !row.display_name) {
      return []
    }

    return [row]
  })
}

/** What a save of the form sends. */
function changesOf(form: Draft) {
  return {
    name: form.name,
    reply_to: filled(form.replyTo),
    bcc: filled(form.bcc),
    html_signature: form.signature,
    // Linked, the address follows the saved signature's edits
    signature: savedSignatureOf(form)?.name ?? null,
  }
}

// Whether Save was pressed on the open address: from then on a row that is no address says so
const isChecked = ref(false)
function editAddress(identity: Identity) {
  draft.value = draftOf(identity)
  isChecked.value = false
  showsReplyAndBcc.value = draft.value.replyTo.length + draft.value.bcc.length > 0
  saveIdentity.reset()
}

const newAddress = ref<{ email: string; name: string }>()
function addAddress() {
  newAddress.value = { email: '', name: '' }
  triedEmail.value = undefined
}

function titleOf(identity: Identity) {
  return identity._name || identity.email
}

const isListRead = computed(() => !identities.isFetching)
function showList() {
  draft.value = undefined
  newAddress.value = undefined
}

// Nothing to save until the form differs from the address as it was read. Read again as the saved
// signatures arrive, which tell which one the address uses
const isSaveBlocked = computed(() => {
  const form = draft.value
  if (!form || identities.isFetching) {
    return true
  }

  return JSON.stringify(changesOf(form)) === JSON.stringify(changesOf(draftOf(form.identity)))
})

// A refused save is said on the page that was saved, where the eyes are, so no toast says it too
const saveIdentity = useMutation(api.mail.identities.save, { silent: true })
const saveError = computed(() => failureLine(saveIdentity.error))
async function save() {
  const form = draft.value
  if (!form) {
    return
  }

  const changes = changesOf(form)
  isChecked.value = true
  // A row that is no address says so, and nothing is sent
  if (![...changes.reply_to, ...changes.bcc].every((address) => isEmail(address.email))) {
    return
  }

  await saveIdentity.run({ account: form.identity.account, id: form.identity.id, ...changes })
  raiseToast(__('Address updated'))
  // A slow save can end after another page was opened, and that page stays
  if (draft.value === form) {
    showList()
  }
}

// The picker's choices: none, one of the saved signatures, or words written for this address alone;
// a saved one goes by its name after SAVED, so no name can read as one of the other two
const NONE = 'none'
const CUSTOM = 'custom'
const SAVED = 'saved:'
const savedSignatures = computed(() =>
  (signatures.data ?? []).filter((signature) => signature.html_body),
)
const signatureChoices = computed(() => [
  { label: __('None'), value: NONE },
  ...savedSignatures.value.map((signature) => ({
    label: signature.signature_name,
    value: SAVED + signature.name,
  })),
  { label: __('Custom'), value: CUSTOM },
])
// The saved signature the address's words are. Two can hold the same words, so the one picked here
// comes first, then the one the address is linked to. Custom is picked, not read off the words: they
// may be none yet, or still match a saved signature
function savedSignatureOf(form: Draft) {
  if (form.picked === CUSTOM || !form.signature) {
    return undefined
  }

  const matching = savedSignatures.value.filter(({ html_body }) => html_body === form.signature)
  return (
    matching.find(({ name }) => SAVED + name === form.picked) ??
    matching.find((signature) => signature.identities.includes(form.identity.name)) ??
    matching[0]
  )
}
const signatureChoice = computed(() => {
  const form = draft.value
  const saved = form && savedSignatureOf(form)
  if (saved) {
    return SAVED + saved.name
  }

  return form?.picked === CUSTOM || form?.signature ? CUSTOM : NONE
})
const isWritingSignature = computed(() => signatureChoice.value === CUSTOM)
// A saved signature is copied into the address and linked to it: an edit of the saved one reaches
// the address while it still holds those words
function chooseSignature(choice: unknown) {
  if (!draft.value) {
    return
  }

  draft.value.picked = String(choice)
  if (choice === CUSTOM) {
    return
  }

  const saved = savedSignatures.value.find((signature) => SAVED + signature.name === choice)
  draft.value.signature = saved?.html_body ?? ''
}

const addIdentity = useMutation(api.mail.identities.create, { silent: true })
const isCreateBlocked = computed(() => !newAddress.value?.email)
// The email Save was last pressed on. What is wrong with it is said under its field until it is
// changed: that it is no email address, or the reason the server refused it
const triedEmail = ref<string>()
const emailError = computed(() => {
  const email = newAddress.value?.email
  if (email === undefined || email !== triedEmail.value) {
    return undefined
  }

  if (!isEmail(email)) {
    return __('Enter a valid email address')
  }

  return failureLine(addIdentity.error)
})
async function createAddress() {
  const form = newAddress.value
  if (!form) {
    return
  }

  triedEmail.value = form.email
  if (!isEmail(form.email)) {
    return
  }

  await addIdentity.run({ account: store.accountId, ...form })
  raiseToast(__('Address created'))
  if (newAddress.value === form) {
    showList()
  }
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
  // Deleted from its own page, the address has no page left to show
  showList()
}

function addressOptions(identity: Identity) {
  return [
    {
      label: __('Set as default'),
      icon: Pin,
      // Not offered until the default is read: there is none to move, and nothing would be saved
      condition: () => !!defaultEmail.value && !isDefault(identity),
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
