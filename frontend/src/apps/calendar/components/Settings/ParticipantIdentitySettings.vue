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
      v-model="draft.email"
      :label="__('Email address')"
      type="email"
      variant="outline"
    />
    <ErrorMessage :message="saveError" />
    <SettingsDialogActions>
      <!-- At the dialog's other end from Save, so neither is pressed for the other -->
      <Button
        :label="__('Delete')"
        theme="red"
        class="me-auto"
        @click="askToDelete(draft.identity)"
      />
      <Button
        :label="__('Save')"
        variant="solid"
        :disabled="isSaveBlocked"
        :loading="updateIdentity.isPending"
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
        @click="addAddress"
      />
    </SettingsDialogActions>
    <div v-if="participantIdentities.data?.length">
      <div
        v-for="identity in participantIdentities.data"
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
          <Badge v-if="identity.default" :label="__('Default')" size="sm" class="self-center" />
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
      :title="__('No invite addresses yet')"
      :description="
        __(
          'Invite addresses are the addresses you organize and attend calendar events as. Create one to get started.',
        )
      "
    />
  </div>
  <!-- Outside the pages above: the list and an open address both ask it -->
  <Dialog
    v-model:open="showDeleteDialog"
    v-bind="{
      title: __('Delete this invite address?'),
      message: __('This cannot be undone.'),
      actions: [
        {
          label: __('Delete invite address'),
          variant: 'solid' as const,
          theme: 'red' as const,
          loading: deleteIdentity.isPending,
          onClick: () => removeIdentity(),
        },
      ],
    }"
  />
</template>

<script setup lang="ts">
import { Badge, Button, Dialog, ErrorMessage, FormControl } from 'frappe-ui'
import { Edit2, Ellipsis, Pin, Trash2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import { api, useMutation, type OutputOf } from '@/api'
import { userStore } from '@/apps/calendar/stores/user'
import { isEmail, raiseToast } from '@/apps/calendar/utils'
import { failureLine } from '@/platform/feedback'
import AdaptiveDropdown from '@/platform/feedback/AdaptiveDropdown.vue'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'
import SettingsDialogBack from '@/platform/settings/SettingsDialogBack.vue'
import SettingsEmptyList from '@/platform/settings/SettingsEmptyList.vue'
import { translate as __ } from '@/platform/translation'

const store = userStore()
const { participantIdentities } = store

type InviteAddress = OutputOf<typeof api.mail.participantIdentities.list>[number]

/** The address that is open, and what its form holds. */
interface Draft {
  identity: InviteAddress
  name: string
  email: string
}

// Unset, the list shows
const draft = ref<Draft>()
function editAddress(identity: InviteAddress) {
  draft.value = { identity, name: identity._name, email: identity.email }
  updateIdentity.reset()
}

const newAddress = ref<{ email: string; name: string }>()
function addAddress() {
  newAddress.value = { email: '', name: '' }
  triedEmail.value = undefined
}

function titleOf(identity: InviteAddress) {
  return identity._name || identity.email
}

const isListRead = computed(() => !participantIdentities.isFetching)
function showList() {
  draft.value = undefined
  newAddress.value = undefined
}

// Nothing to save until the form differs from the address as it was read
const isSaveBlocked = computed(() => {
  const form = draft.value
  if (!form) {
    return true
  }

  return form.name === form.identity._name && form.email === form.identity.email
})

// A refused save is said on the page that was saved, where the eyes are, so no toast says it too
const updateIdentity = useMutation(api.mail.participantIdentities.update, { silent: true })
const saveError = computed(() => failureLine(updateIdentity.error))
async function save() {
  const form = draft.value
  if (!form) {
    return
  }

  const { account, id } = form.identity
  await updateIdentity.run({ account, id, name: form.name, email: form.email })
  raiseToast(__('Invite address updated'))
  // A slow save can end after another page was opened, and that page stays
  if (draft.value === form) {
    showList()
  }
}

const addIdentity = useMutation(api.mail.participantIdentities.create, { silent: true })
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
  raiseToast(__('Invite address created'))
  if (newAddress.value === form) {
    showList()
  }
}

// Asked from the list, which has no line of its own for a refusal, so a toast says it
const makeDefault = useMutation(api.mail.participantIdentities.update)
function setAsDefault(identity: InviteAddress) {
  const { account, id, _name: name, email } = identity

  return makeDefault.run({ account, id, name, email, default: true })
}

// The address the question "Delete this invite address?" is about
const deleting = ref<InviteAddress>()
const showDeleteDialog = ref(false)
function askToDelete(identity: InviteAddress) {
  deleting.value = identity
  showDeleteDialog.value = true
}

const deleteIdentity = useMutation(api.mail.participantIdentities.delete)
async function removeIdentity() {
  if (!deleting.value) {
    return
  }

  await deleteIdentity.run({ names: [deleting.value.name] })
  raiseToast(__('Invite address deleted'))
  showDeleteDialog.value = false
  // Deleted from its own page, the address has no page left to show
  showList()
}

function addressOptions(identity: InviteAddress) {
  return [
    {
      label: __('Set as default'),
      icon: Pin,
      condition: () => !identity.default,
      onClick: () => setAsDefault(identity),
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
      onClick: () => askToDelete(identity),
    },
  ]
}
</script>
