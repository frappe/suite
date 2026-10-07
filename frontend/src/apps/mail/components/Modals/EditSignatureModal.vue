<template>
  <Dialog v-if="selected" v-model:open="show" v-bind="addSignatureOptions">
    <template #default>
      <div class="space-y-4">
        <FormControl
          v-model="draft.signature_name"
          :label="__('Signature Name')"
          :placeholder="__('Work signature')"
          variant="outline"
        />
        <div class="space-y-1.5">
          <label class="text-ink-gray-5 block text-xs">{{ __('Signature Body') }}</label>
          <TextEditor
            editor-class="prose-sm min-h-[8rem] border rounded-b-6 border-t-0 p-2 max-w-none border-outline-gray-2"
            :extensions="[CustomParagraphExtension]"
            :fixed-menu="buttons"
            :placeholder="__('Write your signature here')"
            :content="draft.html_body"
            @change="(val: string) => (draft.html_body = val)"
          />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, FormControl } from 'frappe-ui'
import { TextEditor } from 'frappe-ui/experimental'
import { computed, reactive, watch } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import { raiseToast } from '@/apps/mail/utils'
import { useTextEditorButtons } from '@/apps/mail/utils/composables'
import { CustomParagraphExtension } from '@/apps/mail/utils/text-editor'

const show = defineModel<boolean>()

const { signatureID } = defineProps<{ signatureID: string }>()

const emit = defineEmits(['reloadSignatures'])

const { buttons } = useTextEditorButtons()

const signatures = useQuery(api.mail.signatures.list, () => (show.value ? {} : false))
const selected = computed(() =>
  signatures.data?.find((signature) => signature.name === signatureID),
)
const draft = reactive({ signature_name: '', html_body: '' })
watch(
  selected,
  (signature) => {
    if (signature)
      Object.assign(draft, {
        signature_name: signature.signature_name,
        html_body: signature.html_body ?? '',
      })
  },
  { immediate: true },
)
const updateSignature = useMutation(api.mail.signatures.update)
async function save() {
  await updateSignature.run({ name: signatureID, ...draft })
  show.value = false
  raiseToast(__('Signature updated.'))
  emit('reloadSignatures')
}

const addSignatureOptions = computed(() => ({
  title: __('Edit Signature'),
  actions: [
    {
      label: __('Save'),
      variant: 'solid' as const,
      disabled: !draft.signature_name || !draft.html_body,
      onClick: () => save(),
    },
  ],
}))
</script>
