<!--
  Mail > Identities & signatures. Identities are the addresses this account sends mail as; one
  opens to edit its name, signature, Reply to and Bcc. The signature on an identity is the one new
  mail from it starts with, so that is the one place a default signature is set. Saved signatures
  are reusable text an identity's signature can be filled from.
-->
<template>
  <SettingsPage
    :title="__('Identities & signatures')"
    :description="__('The addresses you send mail as, and the signatures you sign it with')"
    :loading="!identities.data"
  >
    <SettingsSection
      :title="__('Identities')"
      :description="__('Each one has its own name, signature, and Reply to and Bcc addresses')"
    >
      <template #actions>
        <Button icon-left="lucide-plus" :label="__('New')" @click="newIdentity" />
      </template>
      <template v-if="identities.data?.length">
        <SettingsListRow
          v-for="identity in identities.data"
          :key="identity.name"
          :title="identity._name || identity.email"
          :subtitle="identity._name ? identity.email : undefined"
          :menu="identityMenu(identity)"
          @open="editIdentity(identity)"
        />
      </template>
      <SettingsEmpty
        v-else
        :title="__('No identities yet')"
        :description="__('Add an address to send mail as.')"
      />
    </SettingsSection>

    <SettingsSection
      :title="__('Signatures')"
      :description="__('Saved signatures you can put on any identity')"
    >
      <template #actions>
        <Button icon-left="lucide-plus" :label="__('New')" @click="showAddSignature = true" />
      </template>
      <SettingsLoading v-if="!signatures.data" />
      <template v-else-if="signatures.data.length">
        <SettingsListRow
          v-for="signature in signatures.data"
          :key="signature.name"
          :title="signature.signature_name"
          :menu="signatureMenu(signature)"
          @open="editSignature(signature.name)"
        />
      </template>
      <SettingsEmpty
        v-else
        :title="__('No saved signatures yet')"
        :description="__('Save a signature once, then use it on any identity.')"
      />
    </SettingsSection>

    <IdentityDialog v-model:open="showIdentity" :identity="selectedIdentity" />
    <AddSignatureModal v-model="showAddSignature" />
    <EditSignatureModal v-model="showEditSignature" :signature-i-d="selectedSignature" />
  </SettingsPage>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, useMutation, useQuery, type OutputOf } from '@/api'
import AddSignatureModal from '@/apps/mail/components/Modals/AddSignatureModal.vue'
import EditSignatureModal from '@/apps/mail/components/Modals/EditSignatureModal.vue'
import IdentityDialog from '@/apps/mail/components/Settings/IdentityDialog.vue'
import { userStore } from '@/apps/mail/stores/user'
import type { Identity } from '@/apps/mail/types'
import { confirm, prompt, toast } from '@/platform/feedback'
import {
  SettingsEmpty,
  SettingsListRow,
  SettingsLoading,
  SettingsPage,
  SettingsSection,
} from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const store = userStore()
const { identities } = store

// Identities

const showIdentity = ref(false)
const selectedIdentityName = ref('')
// Read from the list, so a reload after a save shows in the open dialog.
const selectedIdentity = computed(() =>
  identities.data?.find((identity) => identity.name === selectedIdentityName.value),
)
function editIdentity(identity: Identity) {
  selectedIdentityName.value = identity.name
  showIdentity.value = true
}

const createIdentity = useMutation(api.mail.identities.create)
async function newIdentity() {
  const values = await prompt({
    title: __('New identity'),
    confirmLabel: __('Create'),
    fields: [
      { name: 'email', label: __('Email'), placeholder: 'name@example.com', required: true },
      { name: 'name', label: __('Display name') },
    ],
  })
  if (!values || typeof values.email !== 'string') return
  await createIdentity.run({
    account: store.accountId,
    email: values.email.trim(),
    name: typeof values.name === 'string' ? values.name.trim() : undefined,
  })
  toast.success(__('Identity created'))
}

const deleteIdentities = useMutation(api.mail.identities.delete)
async function deleteIdentity(identity: Identity) {
  const confirmed = await confirm({
    title: __('Delete {0}?', [identity._name || identity.email]),
    message: __('You can no longer send mail as this identity.'),
    confirmLabel: __('Delete'),
    destructive: true,
  })
  if (!confirmed) return
  await deleteIdentities.run({ names: [identity.name] })
  toast.success(__('Identity deleted'))
}

const identityMenu = (identity: Identity) => [
  { label: __('Edit'), icon: 'lucide-pencil', onClick: () => editIdentity(identity) },
  // The server says which identities may go; the account's own address may not.
  ...(identity.may_delete
    ? [
        {
          label: __('Delete'),
          icon: 'lucide-trash-2',
          theme: 'red' as const,
          onClick: () => void deleteIdentity(identity).catch(() => {}),
        },
      ]
    : []),
]

// Signatures

type Signature = OutputOf<typeof api.mail.signatures.list>[number]
const signatures = useQuery(api.mail.signatures.list)
const showAddSignature = ref(false)
const showEditSignature = ref(false)
const selectedSignature = ref('')
function editSignature(name: string) {
  selectedSignature.value = name
  showEditSignature.value = true
}

const removeSignature = useMutation(api.mail.signatures.delete)
async function deleteSignature(signature: Signature) {
  const confirmed = await confirm({
    title: __('Delete {0}?', [signature.signature_name]),
    message: __('Identities that use this signature keep their copy of it.'),
    confirmLabel: __('Delete'),
    destructive: true,
  })
  if (!confirmed) return
  await removeSignature.run({ name: signature.name })
  toast.success(__('Signature deleted'))
}

const signatureMenu = (signature: Signature) => [
  { label: __('Edit'), icon: 'lucide-pencil', onClick: () => editSignature(signature.name) },
  {
    label: __('Delete'),
    icon: 'lucide-trash-2',
    theme: 'red' as const,
    onClick: () => void deleteSignature(signature).catch(() => {}),
  },
]
</script>
