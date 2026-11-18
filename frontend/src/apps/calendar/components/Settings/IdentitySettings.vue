<!--
  Calendar > Identity: the names and addresses the user organizes and attends
  events as (participant identities). The default one is the organizer of a
  new event. A row opens its edit dialog; New opens the same dialog empty.
  The server takes only the account's own addresses, with one identity each,
  so New offers only an address that has none, and hides when none is left.
-->
<template>
  <SettingsPage
    :description="
      freeAddresses.length
        ? __('The name and email shown to people you invite')
        : __('The name shown to people you invite. Each of your addresses has one identity.')
    "
    :loading="!participantIdentities.data || !mailIdentities.data"
    :reads="[participantIdentities, mailIdentities]"
  >
    <template v-if="freeAddresses.length" #actions>
      <Button icon-left="lucide-plus" :label="__('New')" @click="openNew" />
    </template>
    <SettingsSection v-if="participantIdentities.data">
      <SettingsListRow
        v-for="identity in participantIdentities.data"
        :key="identity.name"
        :title="identity._name || identity.email"
        :subtitle="identity._name ? identity.email : undefined"
        :menu="menu(identity)"
        @open="openEdit(identity)"
      >
        <template v-if="identity.default" #trailing>
          <Badge :label="__('Default')" />
        </template>
      </SettingsListRow>
      <SettingsEmpty
        v-if="!participantIdentities.data.length"
        :title="__('No identities yet')"
        :description="
          __('Add the name and email you want people to see when you invite them to events.')
        "
      />
    </SettingsSection>

    <Dialog v-model:open="showForm" v-bind="formDialog">
      <form v-if="draft" class="flex flex-col gap-4" @submit.prevent="submit">
        <FormControl
          v-model="draft.name"
          :label="__('Name')"
          :placeholder="__('Jane Doe')"
          autocomplete="name"
        />
        <FormControl
          v-model="draft.email"
          type="select"
          :label="__('Email')"
          :options="emailOptions"
          required
        />
        <FormControl v-model="draft.default" type="checkbox" :label="__('Use for new events')" />
        <!-- Enter in a field submits the dialog. -->
        <button type="submit" class="hidden" />
      </form>
    </Dialog>
  </SettingsPage>
</template>

<script setup lang="ts">
import { Badge, Button, Dialog, FormControl } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, useMutation, type OutputOf } from '@/api'
import { userStore } from '@/apps/calendar/stores/user'
import { confirm, toast } from '@/platform/feedback'
import {
  SettingsEmpty,
  SettingsListRow,
  SettingsPage,
  SettingsSection,
  useSettingsDraft,
} from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

type Identity = OutputOf<typeof api.mail.participantIdentities.list>[number]

const store = userStore()
const { participantIdentities, identities: mailIdentities } = store

const create = useMutation(api.mail.participantIdentities.create)
const update = useMutation(api.mail.participantIdentities.update)
const remove = useMutation(api.mail.participantIdentities.delete)

// The identity the dialog edits; undefined while it makes a new one.
const editing = ref<Identity>()
const showForm = ref(false)

// The account's addresses are the ones its mail identities send as.
const freeAddresses = computed(() => {
  const taken = new Set(participantIdentities.data?.map((identity) => identity.email.toLowerCase()))
  const own = new Set(mailIdentities.data?.map((identity) => identity.email.toLowerCase()))
  return [...own].filter((email) => !taken.has(email))
})

const emailOptions = computed(() =>
  [...(editing.value ? [editing.value.email] : []), ...freeAddresses.value].map((email) => ({
    label: email,
    value: email,
  })),
)

// While the dialog is open: the identity's fields, or a blank one on the first free address. An
// edit saves only once a field differs from them.
const { draft, dirty } = useSettingsDraft(() => {
  if (!showForm.value) return null
  const identity = editing.value
  return identity
    ? { name: identity._name, email: identity.email, default: Boolean(identity.default) }
    : { name: '', email: freeAddresses.value[0] ?? '', default: false }
})
const canSave = computed(() => !!draft.value?.email.trim() && (!editing.value || dirty.value))

const formDialog = computed(() => ({
  title: editing.value ? __('Edit identity') : __('New identity'),
  actions: [
    {
      label: __('Save'),
      variant: 'solid' as const,
      disabled: !canSave.value,
      loading: create.isPending || update.isPending,
      onClick: submit,
    },
  ],
}))

function openNew() {
  editing.value = undefined
  showForm.value = true
}

function openEdit(identity: Identity) {
  editing.value = identity
  showForm.value = true
}

async function submit() {
  const values = draft.value
  if (!values || !canSave.value || create.isPending || update.isPending) return
  const fields = { name: values.name.trim(), email: values.email.trim(), default: values.default }
  const identity = editing.value
  if (identity) {
    await update.run({ account: identity.account, id: identity.id, ...fields })
    toast.success(__('Identity saved'))
  } else {
    await create.run({ account: store.accountId, ...fields })
    toast.success(__('Identity added'))
  }
  showForm.value = false
}

function menu(identity: Identity) {
  return [
    { label: __('Edit'), icon: 'lucide-pencil', onClick: () => openEdit(identity) },
    {
      label: __('Use for new events'),
      icon: 'lucide-pin',
      condition: () => !identity.default,
      onClick: () => makeDefault(identity),
    },
    {
      label: __('Delete'),
      icon: 'lucide-trash-2',
      theme: 'red' as const,
      onClick: () => deleteIdentity(identity),
    },
  ].filter((option) => !option.condition || option.condition())
}

async function makeDefault(identity: Identity) {
  await update.run({
    account: identity.account,
    id: identity.id,
    name: identity._name,
    email: identity.email,
    default: true,
  })
  toast.success(__('New events now use {0}', [identity.email]))
}

async function deleteIdentity(identity: Identity) {
  const confirmed = await confirm({
    title: __('Delete {0}?', [identity._name || identity.email]),
    message: __('People you invite later no longer see this name and email.'),
    confirmLabel: __('Delete'),
    destructive: true,
  })
  if (!confirmed) return
  await remove.run({ names: [identity.name] })
  toast.success(__('Identity deleted'))
}
</script>
