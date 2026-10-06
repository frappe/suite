<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Add Domain'),
      actions: [
        {
          label: __('Add Domain'),
          variant: 'solid' as const,
          disabled: !domainName,
          loading: addDomain.isPending,
          onClick: () => addDomainSubmit().catch(() => {}),
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-4">
        <p class="text-p-base">
          {{
            __(
              `To add a domain, you must already own it. Publish the ownership record below at your DNS provider first; the domain is added once it resolves.`,
            )
          }}
        </p>
        <FormControl
          v-model="domainName"
          :label="__('Domain Name')"
          placeholder="example.com"
          autocomplete="off"
          :description="__('After adding, copy the generated DNS records to your DNS provider.')"
          @blur="checkDomainSubmit().catch(() => {})"
        />
        <div v-if="ownership" class="bg-surface-gray-1 space-y-1 rounded-4 border p-3 text-sm">
          <p class="text-ink-gray-5 text-xs">{{ __('Ownership record (TXT)') }}</p>
          <p class="font-mono text-xs break-all">{{ ownership.fqdn }}</p>
          <p class="font-mono text-xs break-all">{{ ownership.value }}</p>
          <Button
            size="sm"
            variant="subtle"
            :label="__('Copy value')"
            @click="copyToClipBoard(ownership.value)"
          />
        </div>
        <FormControl
          v-model="domainDescription"
          :label="__('Description')"
          :placeholder="__('Primary domain for company email')"
          type="textarea"
        />
        <ErrorMessage :message="errorMessage" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { copyToClipBoard, raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()
const router = useRouter()
const domainName = ref('')
const domainDescription = ref('')
const emit = defineEmits(['reloadDomains'])
watch(show, () => {
  if (show.value) {
    domainName.value = ''
    domainDescription.value = ''
    addDomain.reset()
    checkedName.value = ''
  }
})

// The record is the same for every domain the site adds, so it can be shown before the add.
const checkedName = ref('')
const checkDomain = useQuery(api.mail.admin.domains.ownershipRecord, () =>
  checkedName.value
    ? {
        name: checkedName.value,
      }
    : false,
)
async function checkDomainSubmit() {
  checkedName.value = domainName.value.trim()
  await checkDomain.refetch()
}
const ownership = computed(() => checkDomain.data?.ownership_record)
const addDomain = useMutation(api.mail.admin.domains.create)
async function addDomainSubmit() {
  const input: InputOf<typeof api.mail.admin.domains.create> = {
    name: domainName.value.trim(),
    description: domainDescription.value?.trim() || undefined,
  }
  const result = await addDomain.run(input)
  const data = result
  if (!data) return
  show.value = false
  emit('reloadDomains')
  raiseToast(__('Domain added.'))
  router.push({
    name: 'mail-domain',
    params: {
      domainId: data,
    },
  })
}
const errorMessage = computed(() => addDomain.error?.message || checkDomain.error?.message || '')
</script>
