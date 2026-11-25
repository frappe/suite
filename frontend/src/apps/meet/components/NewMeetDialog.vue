<script setup lang="ts">
import { Button, Dialog, Switch, TextInput, toast } from 'frappe-ui'
import { computed, ref, useId, watch } from 'vue'
import { useRouter } from 'vue-router'

import { api, client, useMutation } from '@/api'
import { translate as __ } from '@/platform/translation'

import { useConnectionState } from '../composables/useConnectionState'

const open = defineModel<boolean>('open', { required: true })
const router = useRouter()
const connection = useConnectionState()
const create = useMutation(api.meet.rooms.create)
const title = ref('')
const restricted = ref(false)
const custom = ref(false)
const editedLink = ref<string>()
const saving = ref(false)
const status = ref<'available' | 'invalid' | 'reserved' | 'taken' | 'error'>()
const statusId = useId()
const linkPrefix = `${window.location.host}/meet/`
const slug = computed({
  get: () =>
    editedLink.value ??
    title.value
      .normalize('NFKD')
      .replace(/\p{Mark}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
  set: (value: string) => {
    editedLink.value = value
  },
})

watch(
  open,
  (shown) => {
    if (!shown) return
    title.value = ''
    restricted.value = false
    custom.value = false
    editedLink.value = undefined
  },
  { immediate: true },
)

const checkedLink = computed(() => (open.value && custom.value ? slug.value : undefined))
watch(
  checkedLink,
  (link, _, onCleanup) => {
    status.value = undefined
    if (link === undefined) return
    if (link.length < 3 || link.length > 40 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(link)) {
      status.value = 'invalid'
      return
    }

    const request = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const result = await client.query(
          api.meet.rooms.linkAvailability,
          { link },
          { signal: request.signal },
        )
        if (!request.signal.aborted) status.value = result.status
      } catch {
        if (!request.signal.aborted) status.value = 'error'
      }
    }, 300)
    onCleanup(() => {
      clearTimeout(timer)
      request.abort()
    })
  },
  { flush: 'sync', immediate: true },
)

const statusLabel = computed(() => {
  switch (status.value) {
    case 'available':
      return __('Available')
    case 'invalid':
      return __('Use 3–40 lowercase letters, numbers or hyphens')
    case 'reserved':
      return __('This link is reserved')
    case 'taken':
      return __('Already taken')
    case 'error':
      return __('Could not check the link')
    default:
      return __('Checking availability…')
  }
})
const disabled = computed(() => saving.value || (custom.value && status.value !== 'available'))

const submit = async (action: 'copy' | 'start') => {
  if (disabled.value) return
  saving.value = true
  const link = slug.value
  const hasCustomLink = custom.value
  try {
    let meet
    try {
      meet = await create.run({
        type: restricted.value ? 'restricted' : 'open',
        title: title.value.trim() || undefined,
        link: hasCustomLink ? link : undefined,
      })
    } catch {
      // The client reports server refusals, including links claimed after the availability check.
      return
    }

    open.value = false
    if (action === 'copy') {
      try {
        await navigator.clipboard.writeText(meet.url)
        toast.success(__('Link copied'))
      } catch {
        toast.error(__('Could not copy the link'))
      }
    } else {
      connection.justCreated = true
      await router.push({
        name: 'meet-meeting',
        params: { meetingId: hasCustomLink ? link : meet.code },
      })
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="__('New meet')"
    :dismissible="!saving"
    :show-close-button="!saving"
  >
    <form class="flex flex-col" @submit.prevent="submit('start')">
      <TextInput
        v-model="title"
        size="md"
        :placeholder="__('Untitled meet')"
        :aria-label="__('Meet title')"
        :disabled="saving"
        autofocus
      />

      <div v-if="custom" class="mt-3">
        <div
          class="flex h-8 min-w-0 items-center rounded-4 border border-outline-gray-3 bg-surface-base px-2.5 text-base shadow-sm focus-within:border-outline-gray-5"
        >
          <span class="max-w-[65%] shrink-0 truncate text-ink-gray-5" dir="ltr">{{
            linkPrefix
          }}</span>
          <input
            v-model="slug"
            :aria-label="__('Custom link')"
            :aria-describedby="statusId"
            :aria-invalid="status === 'invalid' || status === 'taken' || status === 'reserved'"
            :disabled="saving"
            autocomplete="off"
            autocapitalize="none"
            :spellcheck="false"
            class="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-base text-ink-gray-9 outline-none focus:ring-0"
          />
        </div>
        <div
          :id="statusId"
          role="status"
          class="mt-1.5 flex items-center gap-1 px-0.5 text-sm"
          :class="{
            'text-ink-green-6': status === 'available',
            'text-ink-red-4': status && status !== 'available',
            'text-ink-gray-5': !status,
          }"
        >
          <span v-if="status === 'available'" class="lucide-check size-3.5" aria-hidden="true" />
          {{ statusLabel }}
        </div>
      </div>

      <div class="-mb-2 mt-4 divide-y divide-outline-gray-1">
        <Switch
          v-model="restricted"
          class="py-2.5"
          icon="lucide-lock"
          :label="__('Restricted')"
          :description="__('Only people you invite can join')"
          :disabled="saving"
        />
        <Switch
          v-model="custom"
          class="py-2.5"
          icon="lucide-pencil-line"
          :label="__('Custom link')"
          :description="__('Choose a link that is easy to share')"
          :disabled="saving"
        />
      </div>
      <button type="submit" class="hidden" :disabled="disabled" />
    </form>
    <template #actions>
      <div class="flex justify-end gap-2">
        <Button
          :label="__('Copy link')"
          icon-left="lucide-copy"
          :disabled="disabled"
          @click="submit('copy')"
        />
        <Button
          variant="solid"
          :label="__('Start')"
          :disabled="disabled"
          @click="submit('start')"
        />
      </div>
    </template>
  </Dialog>
</template>
