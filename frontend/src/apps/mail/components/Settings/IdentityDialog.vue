<!--
  Edits one identity: the name people see, the signature added to new mail sent from it, and the
  addresses replies go to and copies are sent to. The fields save together.
-->
<template>
  <Dialog v-model:open="open" size="xl" v-bind="dialogOptions">
    <template #default>
      <div v-if="draft" class="flex flex-col gap-5">
        <FormControl v-model="draft._name" :label="__('Display name')" />

        <div class="flex flex-col gap-1.5">
          <div class="flex items-end justify-between gap-2">
            <span class="text-sm leading-tighter text-ink-gray-6">{{ __('Signature') }}</span>
            <Dropdown v-if="signatureOptions.length" :options="signatureOptions" align="end">
              <Button
                variant="ghost"
                size="sm"
                :label="__('Use a saved signature')"
                icon-right="lucide-chevron-down"
              />
            </Dropdown>
          </div>
          <MailRichTextField
            :key="signatureKey"
            v-model="draft.html_signature"
            :placeholder="__('Added to new mail sent from this identity')"
          />
        </div>

        <AddressList
          v-model="draft.reply_to"
          :label="__('Reply to')"
          :description="__('Replies to mail from this identity go to these addresses.')"
        />
        <AddressList
          v-model="draft.bcc"
          :label="__('Bcc')"
          :description="__('A hidden copy of mail from this identity goes to these addresses.')"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import MailRichTextField from '@/apps/mail/components/Controls/MailRichTextField.vue'
import AddressList from '@/apps/mail/components/Settings/IdentityAddressList.vue'
import type { Identity } from '@/apps/mail/types'
import { Dropdown, toast } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

const open = defineModel<boolean>('open', { required: true })
const { identity } = defineProps<{ identity: Identity | undefined }>()

const draft = ref<Identity>()
const original = ref('')
watch(
  () => [open.value, identity] as const,
  ([isOpen, value]) => {
    if (!isOpen || !value) return
    draft.value = {
      ...value,
      reply_to: value.reply_to.map((address) => ({ ...address })),
      bcc: value.bcc.map((address) => ({ ...address })),
    }
    original.value = JSON.stringify(draft.value)
  },
  { immediate: true },
)
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== original.value)

// The editor reads its content once; a new key makes it show a saved signature put in its place.
const signatureKey = ref(0)
const signatures = useQuery(api.mail.signatures.list, () => (open.value ? {} : false))
const signatureOptions = computed(() =>
  (signatures.data ?? [])
    .filter((signature) => signature.html_body)
    .map((signature) => ({
      label: signature.signature_name,
      onClick: () => {
        if (!draft.value) return
        draft.value.html_signature = signature.html_body ?? ''
        signatureKey.value++
      },
    })),
)

const saveIdentity = useMutation(api.mail.identities.save)
async function save() {
  const value = draft.value
  if (!value) return
  await saveIdentity.run({
    account: value.account,
    id: value.id,
    name: value._name,
    reply_to: value.reply_to,
    bcc: value.bcc,
    html_signature: value.html_signature,
  })
  toast.success(__('Identity saved'))
  open.value = false
}

const dialogOptions = computed(() => ({
  title: identity?.email ?? '',
  actions: [
    {
      label: __('Save'),
      variant: 'solid' as const,
      disabled: !dirty.value,
      loading: saveIdentity.isPending,
      onClick: () => void save().catch(() => {}),
    },
  ],
}))
</script>
