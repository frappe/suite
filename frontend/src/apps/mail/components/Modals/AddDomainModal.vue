<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Add domain'),
      actions: [
        {
          label: __('Add domain'),
          variant: 'solid' as const,
          disabled: !domainName,
          loading: addDomain.isPending,
          onClick: () => addDomainSubmit(),
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-4">
        <p class="text-p-base">
          {{
            __(
              'Enter your domain to see the ownership record to publish at your DNS provider. The domain is added once the record resolves.',
            )
          }}
        </p>
        <FormControl
          v-model="domainName"
          :label="__('Domain name')"
          placeholder="example.com"
          autocomplete="off"
          @blur="checkDomainSubmit().catch(() => {})"
        />
        <!-- Present from the start, so the dialog keeps its size and place when the record arrives. -->
        <div
          class="bg-surface-gray-1 space-y-2 rounded-4 border p-3"
          data-testid="ownership-record"
        >
          <p class="text-ink-gray-5 text-xs">{{ __('Ownership record (TXT)') }}</p>
          <dl v-if="ownership" class="space-y-1">
            <div
              v-for="field in ownershipFields"
              :key="field.label"
              class="flex min-h-7 items-center gap-3"
            >
              <dt class="text-ink-gray-5 w-10 shrink-0 text-sm">{{ field.label }}</dt>
              <dd class="text-ink-gray-8 min-w-0 flex-1 font-mono text-xs break-all">
                {{ field.value }}
              </dd>
              <Button
                size="sm"
                variant="ghost"
                icon="lucide-copy"
                :tooltip="field.copyLabel"
                :aria-label="field.copyLabel"
                @click="copyToClipBoard(field.value)"
              />
            </div>
          </dl>
          <p v-else class="text-ink-gray-5 flex min-h-[3.75rem] items-center text-sm">
            {{ __('The record shows here once you enter a domain.') }}
          </p>
        </div>
        <FormControl
          v-model="domainDescription"
          :label="__('Description')"
          :placeholder="__('Primary domain for company email')"
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
import { translate as __ } from '@/platform/translation'

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
const ownershipFields = computed(() =>
  ownership.value
    ? [
        { label: __('Host'), value: ownership.value.fqdn, copyLabel: __('Copy host') },
        { label: __('Value'), value: ownership.value.value, copyLabel: __('Copy value') },
      ]
    : [],
)
// The dialog's ErrorMessage reports a refusal; a toast on top would say it twice.
const addDomain = useMutation(api.mail.admin.domains.create, { silent: true })
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
  raiseToast(__('Domain added'))
  router.push({
    name: 'mail-domain',
    params: {
      domainId: data,
    },
  })
}
const errorMessage = computed(() => addDomain.error?.message || checkDomain.error?.message || '')
</script>
