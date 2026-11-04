<template>
  <Dialog v-model:open="show" v-bind="addSignatureOptions">
    <template #default>
      <FormControl
        v-model="identity"
        type="combobox"
        :label="__('Identity')"
        variant="outline"
        :options="
          (identities.data ?? []).map((identity: Identity) => ({
            label: `${identity.email} (${identity.id})`,
            value: identity.name,
          }))
        "
        :open-on-click="true"
      />

      <div class="mt-4 space-y-1.5">
        <label class="text-ink-gray-5 block text-xs"> {{ __('Signature') }} </label>
        <TextEditor
          editor-class="prose-sm min-h-[8rem] border rounded-4 p-2 max-w-none border-outline-gray-2"
          :extensions="[CustomParagraphExtension]"
          :placeholder="__('Write your signature here')"
          :content="signature"
          :editable="false"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, FormControl } from 'frappe-ui'
import { TextEditor } from 'frappe-ui/experimental'
import { computed, ref } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import type { Identity } from '@/apps/mail/types'
import { raiseToast } from '@/apps/mail/utils'
import { CustomParagraphExtension } from '@/apps/mail/utils/text-editor'

const { identities } = userStore()
const show = defineModel<boolean>()
const { signature } = defineProps<{
  signature: string
}>()
const identity = ref(identities.data?.[0]?.name || '')
const addSignatureOptions = computed(() => ({
  title: __('Set Default Signature'),
  actions: [
    {
      label: __('Save'),
      variant: 'solid' as const,
      disabled: !identity.value,
      onClick: () => {
        setSignatureSubmit()
        show.value = false
      },
    },
  ],
}))
const setSignature = useMutation(api.mail.identities.setSignature)
async function setSignatureSubmit() {
  const input: InputOf<typeof api.mail.identities.setSignature> = {
    identity: identity.value,
    signature,
  }
  await setSignature.run(input)
  raiseToast(__('Identity updated.'))
}
</script>
