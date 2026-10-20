<template>
  <!-- Accounts an Admin created directly that did not finish. They are users, not invitations:
       nobody was invited, and only Retry or Remove can settle them. -->
  <section
    v-if="rows.length"
    class="border-outline-gray-2 divide-outline-gray-1 divide-y rounded-4 border"
    :aria-label="__('Accounts that could not be set up')"
  >
    <div v-for="row in rows" :key="row.name" class="flex items-center gap-3 px-3 py-2.5">
      <span class="text-ink-gray-8 min-w-0 flex-1 truncate text-base">{{ row.account }}</span>
      <Badge :label="__('Setup failed')" theme="red" />
      <Button
        :label="__('Retry')"
        :loading="retry.isPending && acting === row.name"
        :disabled="retry.isPending || remove.isPending"
        @click="retrySubmit(row.name)"
      />
      <Button
        variant="ghost"
        theme="red"
        :label="__('Remove')"
        :disabled="retry.isPending || remove.isPending"
        @click="removing = row"
      />
    </div>
  </section>
  <Dialog
    :open="!!removing"
    v-bind="{
      title: __('Remove account'),
      message: __(
        'Remove {0}? Its unused user and anything the failed setup made are deleted, so the address can be added again.',
        [removing?.account ?? ''],
      ),
      actions: [
        {
          label: __('Remove'),
          variant: 'solid' as const,
          theme: 'red' as const,
          loading: remove.isPending,
          onClick: removeSubmit,
        },
      ],
    }"
    @update:open="(open: boolean) => !open && (removing = null)"
  />
  <Dialog
    :open="!!temporaryPassword"
    :title="__('Account added')"
    @update:open="(open: boolean) => !open && (temporaryPassword = '')"
  >
    <template #default>
      <div class="space-y-4">
        <p class="text-base text-ink-gray-7">
          {{
            __(
              'Share this temporary password privately with the new user. It is shown once, expires after seven days, and cannot be used by Mail clients. The user must change it before normal access.',
            )
          }}
        </p>
        <FormControl :value="temporaryPassword" readonly :label="__('Temporary password')" />
        <Button :label="__('I have saved it securely')" @click="temporaryPassword = ''" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Badge, Button, Dialog, FormControl } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, useMutation, useQuery, type OutputOf } from '@/api'
import { raiseToast } from '@/apps/mail/utils'

type FailedRow = OutputOf<typeof api.mail.admin.invites.list>['items'][number]

const emit = defineEmits<{ settled: [] }>()

const failed = useQuery(api.mail.admin.invites.list, () => ({
  status: 'Setup failed' as const,
  start: 0,
  page_length: 100,
}))
const rows = computed(() => failed.data?.items ?? [])
const reload = () => failed.refetch().catch(() => {})
defineExpose({ reload })

const acting = ref('')
const temporaryPassword = ref('')
const retry = useMutation(api.mail.admin.members.retryCreation)
async function retrySubmit(name: string) {
  acting.value = name
  const result = await retry.run({ name })
  void reload()
  if (!result.success) return raiseToast(result.error || __('Account setup failed again.'), 'error')
  emit('settled')
  temporaryPassword.value = result.temporary_password || ''
  if (!temporaryPassword.value) raiseToast(__('Account added.'))
}

const removing = ref<FailedRow | null>(null)
const remove = useMutation(api.mail.admin.members.removeFailedCreation)
async function removeSubmit() {
  if (!removing.value) return
  await remove.run({ name: removing.value.name })
  removing.value = null
  raiseToast(__('Account removed.'))
  void reload()
}
</script>
