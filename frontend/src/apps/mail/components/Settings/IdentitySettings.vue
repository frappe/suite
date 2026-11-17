<template>
  <div class="flex flex-col gap-5">
    <SettingsDialogActions>
      <Button
        icon-left="lucide-plus"
        :label="__('New')"
        :size="buttonSize"
        @click="showAddIdentity"
      />
    </SettingsDialogActions>
    <template v-if="identities?.data?.length">
      <div class="flex min-h-full flex-col">
        <div class="flex-1 space-y-4">
          <FormControl
            v-model="identityName"
            type="combobox"
            :label="__('Address')"
            variant="outline"
            :options="
              (identities.data ?? []).map((identity: Identity) => ({
                label: identity._name ? `${identity._name} <${identity.email}>` : identity.email,
                value: identity.name,
              }))
            "
            :open-on-click="true"
          />

          <template v-if="draft">
            <FormControl v-model="draft._name" :label="__('Display name')" variant="outline" />

            <div class="space-y-1.5">
              <label class="text-ink-gray-5 block text-xs"> {{ __('Reply-to') }} </label>
              <IdentitySettingsListView
                :data="draft.reply_to || []"
                :empty-state-description="__('No reply-to addresses yet')"
                @delete="(index: number) => draft?.reply_to?.splice(index, 1)"
              />
            </div>
            <Button
              :label="__('Add reply-to')"
              class="min-h-7 w-full"
              variant="outline"
              @click="() => showAddEmailAddress(true)"
            />

            <div class="space-y-1.5">
              <label class="text-ink-gray-5 block text-xs"> {{ __('Bcc') }} </label>
              <IdentitySettingsListView
                :data="draft.bcc || []"
                :empty-state-description="__('No Bcc addresses yet')"
                @delete="(index: number) => draft?.bcc?.splice(index, 1)"
              />
            </div>
            <Button
              :label="__('Add Bcc')"
              class="min-h-7 w-full"
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
              class="min-h-7 w-full"
              variant="outline"
              theme="red"
              @click="showDeleteDialog = true"
            />
          </template>
        </div>

        <Dialog
          v-model:open="showDialog"
          v-bind="{
            title: isAddReplyTo ? __('New reply-to') : __('New Bcc'),
            actions: [
              {
                label: __('Save'),
                variant: 'solid' as const,
                disabled: !email,
                onClick: () => addEmailAddress(),
              },
            ],
          }"
        >
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
      </div>
    </template>
    <div v-else-if="!identities.isFetching" class="text-ink-gray-6 flex flex-col space-y-2 text-sm">
      <p class="text-base font-medium">{{ __('No send-as addresses yet') }}</p>
      <p>
        {{ __('Send-as addresses are the addresses you send mail as. Create one to get started.') }}
      </p>
    </div>
    <Button
      v-if="draft"
      class="self-end"
      :label="__('Save')"
      variant="solid"
      :size="buttonSize"
      :disabled="isSaveBlocked"
      :loading="saveIdentity.isPending"
      @click="save()"
    />

    <Dialog
      v-model:open="showAddIdentityDialog"
      v-bind="{
        title: __('New address'),
        actions: [
          {
            label: __('Save'),
            variant: 'solid' as const,
            disabled: !newEmail,
            loading: addIdentity.isPending,
            onClick: () => addIdentitySubmit(),
          },
        ],
      }"
    >
      <template #default>
        <FormControl
          v-model="newEmail"
          :label="__('Email address')"
          placeholder="johndoe@example.com"
          type="email"
          class="mb-4 w-full"
          :required="true"
        />
        <FormControl
          v-model="newDisplayName"
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
  </div>
</template>

<script setup lang="ts">
import { Button, Dialog, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import MailRichTextField from '@/apps/mail/components/Controls/MailRichTextField.vue'
import IdentitySettingsListView from '@/apps/mail/components/IdentitySettingsListView.vue'
import { userStore } from '@/apps/mail/stores/user'
import type { Identity } from '@/apps/mail/types'
import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'
import { translate as __ } from '@/platform/translation'

const emit = defineEmits<{ saved: [] }>()

const store = userStore()
const { identities } = store
const { isMobile } = useScreenSize()
const buttonSize = computed(() => (isMobile.value ? 'md' : 'sm'))
const signatures = useQuery(api.mail.signatures.list)
const identityName = ref(identities.data?.[0]?.name ?? '')
const selected = computed(() =>
  identities.data?.find((identity) => identity.name === identityName.value),
)
const draft = ref<Identity>()
watch(
  selected,
  (identity) => {
    draft.value = identity
      ? {
          ...identity,
          reply_to:
            identity.reply_to?.map((address) => ({
              ...address,
            })) ?? [],
          bcc:
            identity.bcc?.map((address) => ({
              ...address,
            })) ?? [],
        }
      : undefined
  },
  {
    immediate: true,
  },
)
// Nothing to save until the form differs from the address as it was read
const isSaveBlocked = computed(
  () => identities.isFetching || JSON.stringify(draft.value) === JSON.stringify(selected.value),
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
  emit('saved')
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
const showAddIdentityDialog = ref(false)
const newEmail = ref('')
const newDisplayName = ref('')
const showAddIdentity = () => {
  newEmail.value = ''
  newDisplayName.value = ''
  showAddIdentityDialog.value = true
}
const addIdentity = useMutation(api.mail.identities.create)
async function addIdentitySubmit() {
  const input: InputOf<typeof api.mail.identities.create> = {
    account: store.accountId,
    email: newEmail.value,
    name: newDisplayName.value,
  }
  const result = await addIdentity.run(input)
  const id = result
  raiseToast(__('Address created'))
  showAddIdentityDialog.value = false
  identityName.value = `${store.accountId}|${id}`
}
const showDeleteDialog = ref(false)
const deleteIdentity = useMutation(api.mail.identities.delete)
async function deleteIdentitySubmit() {
  const input: InputOf<typeof api.mail.identities.delete> = {
    names: [identityName.value],
  }
  await deleteIdentity.run(input)
  raiseToast(__('Address deleted'))
  showDeleteDialog.value = false
  identityName.value = ''
}

// Keep the selection valid as the list loads or changes (e.g. after create/delete
// or an account switch): fall back to the first identity when the current one is gone.
watch(
  () => identities.data,
  (data) => {
    if (!data?.length) {
      identityName.value = ''
    } else if (!data.some((i: Identity) => i.name === identityName.value)) {
      identityName.value = data[0].name
    }
  },
)
</script>
