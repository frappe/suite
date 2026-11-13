<!--
  Connect a domain the business already owns (Suite Cloud only, optional).
  Each DNS record to add has a copy button and its own live status. While
  records are missing the step checks again every 15 seconds, so a record
  added in another tab shows up here without a click.
-->
<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { Badge, Button, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, client, useMutation, useQuery } from '@/api'
import { toast } from '@/platform/feedback'

import { isDomain, type DomainState } from './onboarding'

const { suppliedDomain } = defineProps<{ suppliedDomain: string }>()
const name = defineModel<string>('domain', { required: true })
const domainId = defineModel<string>('domainId', { required: true })
const state = defineModel<DomainState>('state', { required: true })

const addDomain = useMutation(api.mail.admin.domains.create, { silent: true })
const verifyDomain = useMutation(api.mail.admin.domains.verify, { silent: true })
const domain = useQuery(api.mail.admin.domains.get, () =>
  domainId.value ? { domain_id: domainId.value } : false,
)
const failure = ref('')

const records = computed(() => (domain.data?.dns_records ?? []).filter((r) => r.is_mandatory))
const groups = computed(
  () => new Map((domain.data?.dns_record_groups ?? []).map((group) => [group.key, group.label])),
)
const checking = computed(() => addDomain.isPending || verifyDomain.isPending)

watch(
  () => domain.data?.is_verified,
  (verified) => {
    if (verified) state.value = 'verified'
  },
)

async function connect(): Promise<void> {
  failure.value = ''
  const typed = name.value.trim().toLowerCase()
  if (!domainId.value || domain.data?.name !== typed) {
    try {
      domainId.value = await addDomain.run({ name: typed })
    } catch (error) {
      // Added before, in an earlier visit to this step: pick it up again.
      const existing = await client
        .query(api.mail.admin.domains.list, { txt: typed })
        .then((page) => page.items.find((row) => row.name === typed))
      if (!existing) {
        failure.value = error instanceof Error ? error.message : String(error)
        return
      }
      domainId.value = existing.id
    }
  }
  await check()
}

async function check(): Promise<void> {
  if (!domainId.value) return
  try {
    const { is_verified } = await verifyDomain.run({ domain_id: domainId.value })
    state.value = is_verified ? 'verified' : 'pending'
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
    state.value = 'pending'
  }
}

const poll = useIntervalFn(() => void check(), 15_000, { immediate: false })
watch(
  state,
  (current) => {
    if (current === 'pending') poll.resume()
    else poll.pause()
  },
  { immediate: true },
)

function host(record: { fqdn: string | null; host: string }): string {
  return record.fqdn || record.host
}

function value(record: { priority: number | null; value: string }): string {
  return record.priority === null ? record.value : `${record.priority} ${record.value}`
}

async function copy(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
  toast.success(__('Copied'), { id: 'dns-record-copied' })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <form class="flex items-end gap-2" @submit.prevent="isDomain(name) && connect()">
      <div class="min-w-0 flex-1">
        <FormControl
          v-model="name"
          type="text"
          variant="outline"
          :label="__('Your domain')"
          :placeholder="'acme.com'"
          autocomplete="off"
          :disabled="state === 'verified' || checking"
        />
      </div>
      <Button
        v-if="state !== 'verified'"
        type="submit"
        :label="state === 'pending' ? __('Check again') : __('Connect')"
        :loading="checking"
        :disabled="!isDomain(name)"
      />
    </form>

    <template v-if="state !== 'idle' && records.length">
      <p class="text-p-sm text-ink-gray-6">
        <template v-if="state === 'verified'">
          {{
            __(
              '{0} is connected. Everyone keeps their {1} address, and you can give people addresses on {0} when you invite them.',
              [name, suppliedDomain],
            )
          }}
        </template>
        <template v-else>
          {{
            __(
              'Add these records where you bought {0}. Suite checks for them every few seconds; changes can take a few minutes to show up.',
              [name],
            )
          }}
        </template>
      </p>
      <ul class="divide-y divide-outline-gray-1 rounded-5 border border-outline-gray-2">
        <li
          v-for="record in records"
          :key="`${record.type}-${host(record)}-${record.value}`"
          class="flex items-start gap-3 px-3 py-2.5"
        >
          <span
            class="mt-0.5 size-4 shrink-0"
            :class="
              record.is_verified
                ? 'lucide-circle-check text-ink-green-5'
                : 'lucide-circle-dashed text-ink-gray-4'
            "
            :aria-label="record.is_verified ? __('Found') : __('Not found yet')"
            role="img"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-base text-ink-gray-8">
                {{ groups.get(record.group ?? '') ?? record.category ?? record.type }}
              </span>
              <Badge v-if="record.type" :label="record.type" size="sm" variant="outline" />
            </div>
            <p
              class="mt-0.5 truncate font-mono text-xs text-ink-gray-5"
              :title="`${host(record)}  ${value(record)}`"
            >
              {{ `${host(record)} → ${value(record)}` }}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon="lucide-copy"
            :aria-label="__('Copy value for {0}', [host(record)])"
            @click="copy(value(record))"
          />
        </li>
      </ul>
    </template>
    <p v-else class="text-p-sm text-ink-gray-5">
      {{
        __(
          'Your team already has working addresses on {0}. Connect a domain you own to use addresses on it instead.',
          [suppliedDomain],
        )
      }}
    </p>
    <ErrorMessage :message="failure" />
  </div>
</template>
