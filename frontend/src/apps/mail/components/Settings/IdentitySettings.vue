<template>
  <!-- One address, edited in place of the list: the arrow goes back to it -->
  <div v-if="draft" class="flex flex-col gap-4">
    <SettingsDialogBack :title="draft.email" :label="__('Back to addresses')" @back="showList" />
    <FormControl v-model="draft._name" :label="__('Display name')" variant="outline" />

    <div class="space-y-1.5">
      <label class="text-ink-gray-5 block text-xs"> {{ __('Reply-to') }} </label>
      <IdentitySettingsListView
        :data="draft.reply_to"
        :empty-state-description="__('No reply-to addresses yet')"
        @delete="(index: number) => draft?.reply_to?.splice(index, 1)"
      />
    </div>
    <Button
      :label="__('Add reply-to')"
      class="min-h-7 self-start"
      variant="outline"
      @click="() => showAddEmailAddress(true)"
    />

    <div class="space-y-1.5">
      <label class="text-ink-gray-5 block text-xs"> {{ __('Bcc') }} </label>
      <IdentitySettingsListView
        :data="draft.bcc"
        :empty-state-description="__('No Bcc addresses yet')"
        @delete="(index: number) => draft?.bcc?.splice(index, 1)"
      />
    </div>
    <Button
      :label="__('Add Bcc')"
      class="min-h-7 self-start"
      variant="outline"
      @click="() => showAddEmailAddress(false)"
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
        :model-value="draft.html_signature"
        :placeholder="__('Write your signature here')"
        @update:model-value="setSignature"
      />
    </div>

    <Button
      v-if="draft.may_delete"
      :label="__('Delete')"
      class="min-h-7 self-start"
      variant="outline"
      theme="red"
      @click="askToDelete"
    />
    <Dialog v-model:open="showDialog" v-bind="addEmailDialog">
      <template #default>
        <FormControl
          v-model="email"
          :label="__('Email address')"
          placeholder="johndoe@example.com"
          type="email"
          class="mb-4 w-full"
          :required="true"
        />
        <FormControl
          v-model="displayName"
          :label="__('Display name')"
          placeholder="John Doe"
          class="w-full"
        />
      </template>
    </Dialog>
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
        </button>
      </div>
    </div>
    <div v-else-if="isListRead" class="text-ink-gray-6 flex flex-col space-y-2 text-sm">
      <p class="text-base font-medium">{{ __('No send-as addresses yet') }}</p>
      <p>
        {{ __('Send-as addresses are the addresses you send mail as. Create one to get started.') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button, Dialog, FormControl } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import MailRichTextField from '@/apps/mail/components/Controls/MailRichTextField.vue'
import IdentitySettingsListView from '@/apps/mail/components/IdentitySettingsListView.vue'
import { userStore } from '@/apps/mail/stores/user'
import type { Identity } from '@/apps/mail/types'
import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'
import SettingsDialogBack from '@/platform/settings/SettingsDialogBack.vue'
import { translate as __ } from '@/platform/translation'

const store = userStore()
const { identities } = store
const { isMobile } = useScreenSize()
const buttonSize = computed(() => (isMobile.value ? 'md' : 'sm'))
const signatures = useQuery(api.mail.signatures.list)

// The address being edited: a copy, so the list keeps what is saved. Unset, the list shows
const draft = ref<Identity>()
const original = ref('')
function editAddress(identity: Identity) {
  draft.value = {
    ...identity,
    reply_to: identity.reply_to?.map((address) => ({ ...address })) ?? [],
    bcc: identity.bcc?.map((address) => ({ ...address })) ?? [],
  }
  original.value = JSON.stringify(draft.value)
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

// Nothing to save until the form differs from the address as it was read
const isSaveBlocked = computed(
  () => identities.isFetching || JSON.stringify(draft.value) === original.value,
)
const saveIdentity = useMutation(api.mail.identities.save)
async function save() {
  const identity = draft.value
  if (!identity) return
  await saveIdentity.run({
    account: identity.account,
    id: identity.id,
    name: identity._name,
    reply_to: identity.reply_to ?? [],
    bcc: identity.bcc ?? [],
    html_signature: identity.html_signature,
  })
  raiseToast(__('Address updated'))
  showList()
}
function setSignature(value: string) {
  if (draft.value) draft.value.html_signature = value
}
const savedSignature = ref('')
const showDialog = ref(false)
const isAddReplyTo = ref(true)
const email = ref('')
const displayName = ref('')
const showAddEmailAddress = (isReplyTo: boolean) => {
  email.value = ''
  displayName.value = ''
  isAddReplyTo.value = isReplyTo
  showDialog.value = true
}
const addEmailAddress = () => {
  if (isAddReplyTo.value)
    draft.value!.reply_to!.push({
      email: email.value,
      display_name: displayName.value,
    })
  else
    draft.value!.bcc!.push({
      email: email.value,
      display_name: displayName.value,
    })
  showDialog.value = false
}

const addEmailTitle = computed(() => {
  if (isAddReplyTo.value) {
    return __('New reply-to')
  }

  return __('New Bcc')
})
const addEmailDialog = computed(() => ({
  title: addEmailTitle.value,
  actions: [
    {
      label: __('Save'),
      variant: 'solid' as const,
      disabled: !email.value,
      onClick: addEmailAddress,
    },
  ],
}))
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

const showDeleteDialog = ref(false)
function askToDelete() {
  showDeleteDialog.value = true
}

const deleteIdentity = useMutation(api.mail.identities.delete)
async function deleteIdentitySubmit() {
  if (!draft.value) {
    return
  }

  await deleteIdentity.run({ names: [draft.value.name] })
  raiseToast(__('Address deleted'))
  showDeleteDialog.value = false
  showList()
}
</script>
