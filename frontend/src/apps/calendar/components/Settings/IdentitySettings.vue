<!--
  Calendar > Identity: the names and addresses the user organizes and attends
  events as (participant identities). The default one is the organizer of a
  new event. A row opens its edit dialog; New opens the same dialog empty.
-->
<template>
  <SettingsPage
    :title="__('Identity')"
    :description="__('The name and email shown to people you invite')"
    :loading="!participantIdentities.data"
  >
    <SettingsSection v-if="participantIdentities.data">
      <template #actions>
        <Button icon-left="lucide-plus" :label="__('New')" @click="openNew" />
      </template>
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
        icon="lucide-contact"
        :title="__('No identities yet')"
        :description="
          __('Add the name and email you want people to see when you invite them to events.')
        "
      />
    </SettingsSection>

    <Dialog v-model:open="showForm" v-bind="formDialog">
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <FormControl
          v-model="draft.name"
          :label="__('Name')"
          :placeholder="__('Jane Doe')"
          autocomplete="name"
        />
        <FormControl
          v-model="draft.email"
          type="email"
          :label="__('Email')"
          :placeholder="__('jane@example.com')"
          autocomplete="email"
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
import { computed, reactive, ref } from 'vue'

import { api, useMutation, type OutputOf } from '@/api'
import { userStore } from '@/apps/calendar/stores/user'
import { confirm, toast } from '@/platform/feedback'
import {
  SettingsEmpty,
  SettingsListRow,
  SettingsPage,
  SettingsSection,
} from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

type Identity = OutputOf<typeof api.mail.participantIdentities.list>[number]

const store = userStore()
const { participantIdentities } = store

const create = useMutation(api.mail.participantIdentities.create)
const update = useMutation(api.mail.participantIdentities.update)
const remove = useMutation(api.mail.participantIdentities.delete)

// The identity the dialog edits; undefined while it makes a new one.
const editing = ref<Identity>()
const showForm = ref(false)
const draft = reactive({ name: '', email: '', default: false })

const formDialog = computed(() => ({
  title: editing.value ? __('Edit identity') : __('New identity'),
  actions: [
    {
      label: __('Save'),
      variant: 'solid' as const,
      disabled: !draft.email.trim(),
      loading: create.isPending || update.isPending,
      onClick: submit,
    },
  ],
}))

function openNew() {
  editing.value = undefined
  Object.assign(draft, { name: '', email: '', default: false })
  showForm.value = true
}

function openEdit(identity: Identity) {
  editing.value = identity
  Object.assign(draft, {
    name: identity._name,
    email: identity.email,
    default: Boolean(identity.default),
  })
  showForm.value = true
}

async function submit() {
  const fields = { name: draft.name.trim(), email: draft.email.trim(), default: draft.default }
  if (!fields.email || create.isPending || update.isPending) return
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
