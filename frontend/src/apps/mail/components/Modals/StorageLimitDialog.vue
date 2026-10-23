<!-- One review/save workflow for individual and bulk combined storage limits. Failed targets retain the original request for retry. -->
<script setup lang="ts">
import { Alert, Button, Dialog, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf, type OutputOf } from '@/api'
import { translate as __ } from '@/platform/translation'

const open = defineModel<boolean>('open', { default: false })
const props = withDefaults(defineProps<{ users: string[]; closeOnSuccess?: boolean }>(), {
  closeOnSuccess: true,
})
const emit = defineEmits<{ saved: [] }>()
const storage = useQuery(api.suite.storage.get, () => (open.value ? {} : false))
const save = useMutation(api.suite.storage.setLimits)
const limitGB = ref('')
const initialized = ref(false)
const validationError = ref('')
const results = ref<OutputOf<typeof api.suite.storage.setLimits>>([])
const request = ref<InputOf<typeof api.suite.storage.setLimits>>()
const selectedUsers = computed(
  () => storage.data?.users.filter((user) => props.users.includes(user.name)) ?? [],
)
const failed = computed(() =>
  results.value.filter((result) => !result.success).map((result) => result.user),
)
const validCap = computed(() => {
  if (!limitGB.value.trim()) return null
  const amount = Number(limitGB.value) * 1_000_000_000
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined
})
const previews = computed(() =>
  selectedUsers.value.map((user) => {
    const cap = validCap.value
    // Every cap carries the same automatic 10% headroom as the site allowance (§6.2).
    const threshold = cap == null ? cap : cap + Math.floor(cap / 10)
    const charge = user.combined_bytes === null ? null : user.combined_bytes + user.reserved_bytes
    return { user, threshold, blocked: threshold != null && charge != null && charge > threshold }
  }),
)

watch(
  () => [open.value, props.users.join('\0')],
  () => {
    initialized.value = false
    results.value = []
    request.value = undefined
    validationError.value = ''
    save.reset()
  },
  { immediate: true },
)
watch(
  () => [open.value, selectedUsers.value],
  () => {
    if (!open.value || initialized.value || !storage.data) return
    const user = selectedUsers.value.length === 1 ? selectedUsers.value[0] : undefined
    limitGB.value = user?.cap_bytes == null ? '' : String(user.cap_bytes / 1_000_000_000)
    initialized.value = true
  },
  { immediate: true },
)

function bytes(value: number | null) {
  return value === null
    ? __('Unavailable')
    : __('{0} GB', [
        (value / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }),
      ])
}
async function submit(retry = false) {
  validationError.value = ''
  if (!retry) {
    if (validCap.value === undefined) {
      validationError.value = __('Enter a storage limit greater than zero.')
      return
    }
    request.value = { users: [...props.users], cap_bytes: validCap.value }
  }
  if (!request.value) return
  const next = await save.run({
    ...request.value,
    users: retry ? failed.value : request.value.users,
  })
  results.value = retry
    ? results.value.map((result) => next.find((item) => item.user === result.user) ?? result)
    : next
  if (results.value.length && results.value.every((result) => result.success)) {
    emit('saved')
    if (props.closeOnSuccess) open.value = false
  }
}
function edit() {
  results.value = []
  request.value = undefined
  save.reset()
}
</script>

<template>
  <Dialog v-model:open="open" :title="__('Set storage limits')" :dismissible="!save.isPending">
    <template #default>
      <div class="space-y-4">
        <FormControl
          v-model="limitGB"
          type="number"
          :label="__('Storage limit (GB)')"
          :description="__('Leave blank to remove the limit.')"
          :disabled="!initialized || save.isPending || !!results.length"
        />
        <ul class="space-y-2">
          <li v-for="preview in previews" :key="preview.user.name" class="space-y-1">
            <p class="text-p-sm text-ink-gray-7">
              {{
                __('{0}: {1} used · limit {2}', [
                  preview.user.full_name,
                  bytes(preview.user.combined_bytes),
                  preview.threshold == null ? __('No limit') : bytes(preview.threshold),
                ])
              }}
            </p>
            <Alert
              v-if="preview.blocked"
              theme="amber"
              :title="
                __('{0} will need to free up space before uploading more files.', [
                  preview.user.full_name,
                ])
              "
              :description="__('Existing files won’t be deleted. Mail will keep working.')"
            />
          </li>
        </ul>
        <p v-if="storage.data?.allowance_bytes" class="text-p-sm text-ink-gray-5">
          {{
            __('Workspace storage: {0} used · limit {1}', [
              bytes(storage.data.combined_bytes),
              bytes(storage.data.effective_allowance_bytes),
            ])
          }}
        </p>
        <ErrorMessage :message="validationError || save.error?.message || storage.error?.message" />
        <ul class="space-y-1" aria-live="polite">
          <li
            v-for="result in results"
            :key="result.user"
            class="text-p-sm"
            :class="result.success ? 'text-ink-green-6' : 'text-ink-red-6'"
          >
            {{ result.user }}: {{ result.success ? __('Saved') : result.error }}
          </li>
        </ul>
      </div>
    </template>
    <template #actions>
      <div class="flex justify-end gap-2">
        <Button
          :label="results.length ? __('Done') : __('Cancel')"
          :disabled="save.isPending"
          @click="open = false"
        />
        <Button
          v-if="results.length"
          :label="__('Edit limits')"
          :disabled="save.isPending"
          @click="edit"
        />
        <Button
          v-if="failed.length"
          variant="solid"
          :label="__('Retry failed')"
          :loading="save.isPending"
          @click="submit(true)"
        />
        <Button
          v-else-if="!results.length"
          variant="solid"
          :label="__('Save')"
          :loading="save.isPending"
          :disabled="!initialized || !users.length"
          @click="submit()"
        />
      </div>
    </template>
  </Dialog>
</template>
