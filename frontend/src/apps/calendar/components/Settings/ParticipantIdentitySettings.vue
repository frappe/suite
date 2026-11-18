<template>
  <div class="flex flex-col gap-5">
    <SettingsDialogActions>
      <Button icon-left="lucide-plus" :label="__('New')" @click="showAddDialog" />
      <Button
        v-if="form"
        :label="__('Save')"
        variant="solid"
        :disabled="isSaveBlocked"
        :loading="updateIdentity.isPending"
        @click="save()"
      />
    </SettingsDialogActions>
    <template v-if="participantIdentities?.data?.length">
      <div class="flex min-h-full flex-col">
        <div class="flex-1 space-y-4">
          <FormControl
            v-model="identityName"
            type="combobox"
            :label="__('Invite address')"
            variant="outline"
            :options="
              participantIdentities.data.map((identity) => ({
                label: identity._name ? `${identity._name} <${identity.email}>` : identity.email,
                value: identity.name,
              }))
            "
            :open-on-click="true"
          />

          <template v-if="form">
            <FormControl v-model="form.name" :label="__('Display name')" variant="outline" />

            <FormControl
              v-model="form.email"
              :label="__('Email address')"
              type="email"
              variant="outline"
            />

            <FormControl
              v-model="form.default"
              type="checkbox"
              :label="__('Set as default invite address')"
            />

            <ErrorMessage :message="saveError" />

            <div>
              <Button
                :label="__('Delete')"
                class="min-h-7"
                variant="outline"
                theme="red"
                @click="openDeleteDialog"
              />
            </div>
          </template>
        </div>
      </div>
    </template>
    <div
      v-else-if="!participantIdentities.isFetching"
      class="text-ink-gray-6 flex flex-col space-y-2 text-sm"
    >
      <p class="text-base font-medium">{{ __('No invite addresses yet') }}</p>
      <p>
        {{
          __(
            'Invite addresses are the addresses you organize and attend calendar events as. Create one to get started.',
          )
        }}
      </p>
    </div>

    <Dialog
      v-model:open="showAddDialogState"
      v-bind="{
        title: __('New invite address'),
        actions: [
          {
            label: __('Save'),
            variant: 'solid',
            disabled: !newEmail,
            loading: addIdentity.isPending,
            onClick: () => createIdentity(),
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
          :error="newEmailError"
        />
        <FormControl
          v-model="newName"
          :label="__('Display name')"
          placeholder="John Doe"
          class="mb-4 w-full"
        />
        <FormControl
          v-model="newDefault"
          type="checkbox"
          :label="__('Set as default invite address')"
        />
      </template>
    </Dialog>

    <Dialog
      v-model:open="showDeleteDialog"
      v-bind="{
        title: __('Delete this invite address?'),
        message: __('This cannot be undone.'),
        actions: [
          {
            label: __('Delete invite address'),
            variant: 'solid',
            theme: 'red',
            loading: deleteIdentity.isPending,
            onClick: () => removeIdentity(),
          },
        ],
      }"
    />
  </div>
</template>

<script setup lang="ts">
import { Button, Dialog, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import { userStore } from '@/apps/calendar/stores/user'
import { isEmail, raiseToast } from '@/apps/calendar/utils'
import { failureLine } from '@/platform/feedback'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'
import { translate as __ } from '@/platform/translation'

const emit = defineEmits<{ saved: [] }>()

const store = userStore()
const { participantIdentities } = store
const identityName = ref('')
const selectedIdentity = computed(() =>
  participantIdentities.data?.find((row) => row.name === identityName.value),
)
const form = ref<InputOf<typeof api.mail.participantIdentities.update>>()
watch(
  selectedIdentity,
  (identity) => {
    form.value = identity
      ? {
          account: identity.account,
          id: identity.id,
          name: identity._name,
          email: identity.email,
          default: Boolean(identity.default),
        }
      : undefined
  },
  { immediate: true },
)
const changed = computed(() => {
  const original = selectedIdentity.value
  const draft = form.value
  return Boolean(
    original &&
    draft &&
    (original._name !== draft.name ||
      original.email !== draft.email ||
      Boolean(original.default) !== draft.default),
  )
})
const isSaveBlocked = computed(() => !changed.value)
// A refused save is said on the form that was saved, where the eyes are, so no toast says it too
const updateIdentity = useMutation(api.mail.participantIdentities.update, { silent: true })
const saveError = computed(() => failureLine(updateIdentity.error))
// What one address was refused is not said on the next one picked
watch(identityName, () => updateIdentity.reset())
async function save() {
  if (!form.value) return
  await updateIdentity.run({ ...form.value })
  raiseToast(__('Invite address updated'))
  emit('saved')
}

const addIdentity = useMutation(api.mail.participantIdentities.create, { silent: true })
const deleteIdentity = useMutation(api.mail.participantIdentities.delete)
const showAddDialogState = ref(false)
const showDeleteDialog = ref(false)
const newName = ref('')
const newEmail = ref('')
const newDefault = ref(false)
// The email Save was last pressed on. What is wrong with it is said under its field until it is
// changed: that it is no email address, or the reason the server refused it
const triedEmail = ref<string>()
const newEmailError = computed(() => {
  if (newEmail.value !== triedEmail.value) {
    return undefined
  }

  if (!isEmail(newEmail.value)) {
    return __('Enter a valid email address')
  }

  return failureLine(addIdentity.error)
})
function openDeleteDialog() {
  showDeleteDialog.value = true
}
function showAddDialog() {
  newName.value = ''
  newEmail.value = ''
  newDefault.value = false
  triedEmail.value = undefined
  showAddDialogState.value = true
}
async function createIdentity() {
  triedEmail.value = newEmail.value
  if (!isEmail(newEmail.value)) {
    return
  }

  const account = store.accountId
  const id = await addIdentity.run({
    account,
    name: newName.value,
    email: newEmail.value,
    default: newDefault.value,
  })
  raiseToast(__('Invite address created'))
  showAddDialogState.value = false
  identityName.value = `${account}|${id}`
}
async function removeIdentity() {
  if (!identityName.value) return
  await deleteIdentity.run({ names: [identityName.value] })
  raiseToast(__('Invite address deleted'))
  showDeleteDialog.value = false
  identityName.value = ''
}
watch(
  () => participantIdentities.data,
  (data) => {
    if (!data?.length) identityName.value = ''
    else if (!data.some((row) => row.name === identityName.value)) identityName.value = data[0].name
  },
  { immediate: true },
)
</script>
