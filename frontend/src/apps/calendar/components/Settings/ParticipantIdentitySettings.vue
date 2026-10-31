<template>
  <AppSettingsHeader :title="__('Participant Identity')">
    <template #actions>
      <Button
        v-if="form"
        :label="__('Save')"
        variant="solid"
        :disabled="!changed"
        :loading="updateIdentity.isPending"
        @click="save()"
      />
      <Button icon-left="lucide-plus" :label="__('New')" variant="outline" @click="showAddDialog" />
    </template>
  </AppSettingsHeader>
  <AppSettingsBody>
    <template v-if="participantIdentities?.data?.length">
      <div class="flex min-h-full flex-col">
        <div class="flex-1 space-y-4">
          <FormControl
            v-model="identityName"
            type="combobox"
            :label="__('Identity')"
            variant="outline"
            :options="
              participantIdentities.data.map((identity) => ({
                label: `${identity.email} (${identity.id})`,
                value: identity.name,
              }))
            "
            :open-on-click="true"
          />

          <template v-if="form">
            <FormControl v-model="form.name" :label="__('Display Name')" variant="outline" />

            <FormControl
              v-model="form.email"
              :label="__('Email Address')"
              type="email"
              variant="outline"
            />

            <FormControl
              v-model="form.default"
              type="checkbox"
              :label="__('Set as default Participant Identity')"
            />

            <Button
              :label="__('Delete')"
              class="min-h-7 w-full"
              variant="outline"
              theme="red"
              @click="showDeleteDialog = true"
            />
          </template>
        </div>
      </div>
    </template>
    <div
      v-else-if="!participantIdentities.isFetching"
      class="text-ink-gray-6 flex flex-col space-y-2 text-sm"
    >
      <p class="text-base font-medium">{{ __('No participant identities.') }}</p>
      <p>
        {{
          __(
            'Participant identities are the addresses you organize and attend calendar events as. Create one to get started.',
          )
        }}
      </p>
    </div>

    <Dialog
      v-model:open="showAddDialogState"
      v-bind="{
        title: __('New Participant Identity'),
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
          :label="__('Email')"
          placeholder="johndoe@example.com"
          type="email"
          class="mb-4 w-full"
          :required="true"
        />
        <FormControl
          v-model="newName"
          :label="__('Display Name')"
          placeholder="John Doe"
          class="mb-4 w-full"
        />
        <FormControl
          v-model="newDefault"
          type="checkbox"
          :label="__('Set as default Participant Identity')"
        />
      </template>
    </Dialog>

    <Dialog
      v-model:open="showDeleteDialog"
      v-bind="{
        title: __('Delete Participant Identity'),
        message: __('Are you sure you want to delete this participant identity?'),
        actions: [
          {
            label: __('Confirm'),
            variant: 'solid',
            theme: 'red',
            loading: deleteIdentity.isPending,
            onClick: () => removeIdentity(),
          },
        ],
      }"
    />
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { Button, Dialog, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import { userStore } from '@/apps/calendar/stores/user'
import { raiseToast } from '@/apps/calendar/utils'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'

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
const updateIdentity = useMutation(api.mail.participantIdentities.update)
async function save() {
  if (!form.value) return
  await updateIdentity.run({ ...form.value })
  raiseToast(__('Participant Identity updated.'))
}
const addIdentity = useMutation(api.mail.participantIdentities.create)
const deleteIdentity = useMutation(api.mail.participantIdentities.delete)
const showAddDialogState = ref(false)
const showDeleteDialog = ref(false)
const newName = ref('')
const newEmail = ref('')
const newDefault = ref(false)
function showAddDialog() {
  newName.value = ''
  newEmail.value = ''
  newDefault.value = false
  showAddDialogState.value = true
}
async function createIdentity() {
  const account = store.accountId
  const id = await addIdentity.run({
    account,
    name: newName.value,
    email: newEmail.value,
    default: newDefault.value,
  })
  raiseToast(__('Participant Identity created.'))
  showAddDialogState.value = false
  identityName.value = `${account}|${id}`
}
async function removeIdentity() {
  if (!identityName.value) return
  await deleteIdentity.run({ names: [identityName.value] })
  raiseToast(__('Participant Identity deleted.'))
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
