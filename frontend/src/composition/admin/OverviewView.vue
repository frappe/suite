<template>
  <DashboardLayout
    area="admin"
    :breadcrumbs="[{ label: __('Overview') }]"
    :loading="storage.status === 'pending'"
  >
    <template #actions>
      <Button
        variant="solid"
        :label="__('Invite user')"
        :route="storage.data?.cloud ? '/admin/mail/invitations' : '/admin/users'"
      />
    </template>

    <ErrorMessage :message="storage.error?.message" />

    <div v-if="storage.data" class="mx-auto w-full max-w-4xl space-y-8 pb-10">
      <!-- 1. Needs attention: concrete exceptions with one action each; hidden when
           there is nothing to fix. Never a silent "all healthy": a failed source
           becomes its own row instead. -->
      <section v-if="attention.length" class="space-y-1">
        <h2 class="text-lg font-medium text-ink-gray-9">{{ __('Needs attention') }}</h2>
        <ul class="divide-y divide-outline-gray-1">
          <li v-for="item in attention" :key="item.label">
            <RouterLink
              v-if="item.route"
              :to="item.route"
              class="flex items-center gap-3 rounded-4 py-2.5 hover:bg-surface-gray-1"
            >
              <span
                :class="[
                  item.severity === 'error' ? 'lucide-octagon-alert' : 'lucide-triangle-alert',
                  'size-4 shrink-0',
                  item.severity === 'error' ? 'text-ink-red-6' : 'text-ink-amber-6',
                ]"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-base text-ink-gray-8">{{ item.label }}</span>
                <span v-if="item.description" class="block truncate text-p-sm text-ink-gray-5">{{
                  item.description
                }}</span>
              </span>
              <span
                class="lucide-chevron-right size-4 shrink-0 text-ink-gray-4"
                aria-hidden="true"
              />
            </RouterLink>
            <div v-else class="flex items-center gap-3 py-2.5">
              <span
                :class="[
                  item.severity === 'error' ? 'lucide-octagon-alert' : 'lucide-triangle-alert',
                  'size-4 shrink-0',
                  item.severity === 'error' ? 'text-ink-red-6' : 'text-ink-amber-6',
                ]"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-base text-ink-gray-8">{{ item.label }}</span>
                <span v-if="item.description" class="block truncate text-p-sm text-ink-gray-5">{{
                  item.description
                }}</span>
              </span>
            </div>
          </li>
        </ul>
      </section>

      <!-- 2. Site storage: one honest figure against the allowance, its freshness,
           and the rule that Mail itself is never limited. Management stays on Storage. -->
      <section class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-medium text-ink-gray-9">{{ __('Site storage') }}</h2>
          <Button variant="ghost" :label="__('Manage storage')" route="/admin/storage" />
        </div>
        <template v-if="storage.data.cloud">
          <div v-if="storage.data.effective_allowance_bytes" class="space-y-1.5">
            <Progress :value="usagePercent" size="md">
              <template #hint>
                <span class="text-base-medium tabular-nums text-ink-gray-5">
                  {{ bytes(storage.data.combined_bytes) }} /
                  {{ bytes(storage.data.effective_allowance_bytes) }}
                </span>
              </template>
            </Progress>
            <p class="text-p-sm text-ink-gray-5">
              {{
                __('Drive: {0} · Mail: {1} · Reserved: {2}', [
                  bytes(storage.data.drive_bytes),
                  bytes(storage.data.mail_bytes),
                  bytes(storage.data.reserved_bytes),
                ])
              }}
            </p>
            <p class="text-p-sm text-ink-gray-5">{{ freshness }}</p>
          </div>
          <div v-else class="space-y-1">
            <p class="text-2xl font-semibold tabular-nums text-ink-gray-9">
              {{ bytes(storage.data.combined_bytes) }}
            </p>
            <p class="text-p-sm text-ink-gray-5">
              {{
                storage.data.allowance_bytes === null
                  ? __('Site allowance unavailable. Retry from Storage.')
                  : __('Uncapped site')
              }}
            </p>
          </div>
          <p class="text-p-sm text-ink-gray-6">
            {{
              __(
                'Mail remains unlimited. Combined usage is checked when new files are added to Drive.',
              )
            }}
          </p>
        </template>
        <template v-else>
          <p class="text-2xl font-semibold tabular-nums text-ink-gray-9">
            {{ bytes(storage.data.drive_bytes) }}
          </p>
          <p class="text-p-sm text-ink-gray-5">
            {{
              __('Personal: {0} · Shared: {1} · Reserved: {2}', [
                bytes(storage.data.personal_drive_bytes),
                bytes(storage.data.shared_drive_bytes),
                bytes(storage.data.reserved_bytes),
              ])
            }}
          </p>
        </template>
      </section>

      <!-- 3. People: counts as account states, not activity telemetry. -->
      <section class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-medium text-ink-gray-9">{{ __('People') }}</h2>
          <Button variant="ghost" :label="__('Manage users')" route="/admin/users" />
        </div>
        <div
          class="grid grid-cols-2 gap-3"
          :class="storage.data.cloud ? 'lg:grid-cols-4' : 'lg:grid-cols-3'"
        >
          <StatCard icon="lucide-user-round" :value="enabledCount" :label="__('Enabled users')" />
          <StatCard
            icon="lucide-user-round-x"
            :value="disabledCount"
            :label="__('Disabled users')"
          />
          <StatCard icon="lucide-shield" :value="adminCount" :label="__('Admins')" />
          <StatCard
            v-if="storage.data.cloud"
            icon="lucide-mail-plus"
            :value="storage.data.pending_invitations"
            :label="__('Pending invitations')"
          />
        </div>
      </section>

      <!-- 4. Mail readiness: verified/enabled domains are DNS readiness, not a
           delivery monitor. Only domains needing work are listed. -->
      <section v-if="storage.data.cloud" class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-medium text-ink-gray-9">{{ __('Mail readiness') }}</h2>
          <Button variant="ghost" :label="__('Manage domains')" route="/admin/mail/domains" />
        </div>
        <p v-if="domains.status === 'pending'" class="text-p-sm text-ink-gray-5">
          {{ __('Checking domains…') }}
        </p>
        <template v-else-if="domains.data">
          <p class="text-p-sm text-ink-gray-5">
            {{
              __('{0} of {1} domains verified and enabled', [
                readyDomains.length,
                domains.data.items.length,
              ])
            }}
          </p>
          <ul v-if="pendingDomains.length" class="divide-y divide-outline-gray-1">
            <li v-for="domain in pendingDomains" :key="domain.id">
              <RouterLink
                :to="`/admin/mail/domains/${domain.name}`"
                class="flex items-center gap-3 rounded-4 py-2.5 hover:bg-surface-gray-1"
              >
                <span
                  class="lucide-triangle-alert size-4 shrink-0 text-ink-amber-6"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-base text-ink-gray-8">{{ domain.name }}</span>
                  <span class="block truncate text-p-sm text-ink-gray-5">{{
                    domainNote(domain)
                  }}</span>
                </span>
                <span
                  class="lucide-chevron-right size-4 shrink-0 text-ink-gray-4"
                  aria-hidden="true"
                />
              </RouterLink>
            </li>
          </ul>
        </template>
        <p v-else-if="domains.error" class="text-p-sm text-ink-amber-6">
          {{ __('Domain status is unavailable. Retry from Mail → Domains.') }}
        </p>
      </section>
    </div>
  </DashboardLayout>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, Progress } from 'frappe-ui'
import { computed } from 'vue'

import { api, useQuery, type OutputOf } from '@/api'
import { DashboardLayout, StatCard } from '@/platform/dashboard'
import { translate as __ } from '@/platform/translation'

type DomainRow = OutputOf<typeof api.mail.admin.domains.list>['items'][number]

const storage = useQuery(api.suite.storage.get)
const users = useQuery(api.suite.users.list)
const health = useQuery(api.suite.admin.health)
// The directory only exists where Suite Cloud provides Mail; elsewhere the query
// never runs, so a local site makes no provider calls from the Overview.
const domains = useQuery(api.mail.admin.domains.list, () =>
  storage.data?.cloud ? { page_length: 500 } : false,
)

const adminCount = computed(() => (users.data ?? []).filter((user) => user.is_admin).length)
const enabledCount = computed(() => (users.data ?? []).filter((user) => user.enabled).length)
const disabledCount = computed(() => (users.data ?? []).filter((user) => !user.enabled).length)

function bytes(value: number | null) {
  if (value === null) return __('Unavailable')
  return __('{0} GB', [
    (value / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }),
  ])
}

const usagePercent = computed(() => {
  const data = storage.data
  if (!data?.effective_allowance_bytes || data.combined_bytes == null) return 0
  return Math.min(100, Math.round((data.combined_bytes / data.effective_allowance_bytes) * 100))
})

const freshness = computed(() => {
  const data = storage.data
  if (!data) return ''
  if (data.combined_bytes == null) return __('Usage unavailable')
  if (!data.fetched_at) return __('Not measured yet')
  const measured = __('Measured {0}', [new Date(data.fetched_at).toLocaleString()])
  return data.stale ? __('{0} · stale', [measured]) : measured
})

const readyDomains = computed(() => (domains.data?.items ?? []).filter(isReady))
const pendingDomains = computed(() => (domains.data?.items ?? []).filter((row) => !isReady(row)))

function isReady(domain: DomainRow) {
  return domain.status === 'Active' && domain.is_enabled && domain.is_verified
}

function domainNote(domain: DomainRow) {
  if (domain.status === 'Pending Verification' || !domain.is_verified)
    return __('DNS verification pending')
  if (!domain.is_enabled) return __('Domain is disabled')
  return domain.status
}

type Attention = {
  label: string
  description?: string
  route?: string
  severity: 'warn' | 'error'
}

const attention = computed(() => {
  const data = storage.data
  if (!data) return []
  const rows: Attention[] = []

  if (users.error || health.error || (data.cloud && domains.error)) {
    rows.push({
      label: __('Some checks could not run'),
      description: __('Refresh this page to retry them.'),
      severity: 'error',
    })
  }
  if (health.data?.suspended) {
    rows.push({
      label: __('This site is suspended by Suite Cloud'),
      description: __('Contact your provider; administration stays available.'),
      route: '/admin/settings',
      severity: 'error',
    })
  }
  if (health.data?.stale) {
    rows.push({
      label: __('Suite Cloud could not be reached'),
      description: __('Try again later.'),
      severity: 'warn',
    })
  }
  if (data.cloud && data.combined_bytes == null) {
    rows.push({
      label: __('Combined usage is unavailable'),
      description: __('Refresh Mail usage from Storage.'),
      route: '/admin/storage',
      severity: 'warn',
    })
  } else if (data.stale) {
    rows.push({
      label: __('Storage usage is out of date'),
      description: __('Refresh usage from Storage.'),
      route: '/admin/storage',
      severity: 'warn',
    })
  }
  if (
    data.cloud &&
    data.allowance_bytes &&
    data.combined_bytes != null &&
    data.combined_bytes >= data.allowance_bytes * 0.9
  ) {
    rows.push({
      label:
        data.combined_bytes > (data.effective_allowance_bytes ?? 0)
          ? __('Site storage is over its threshold')
          : __('Site storage is near its allowance'),
      description: __('Review storage usage and free up space if needed.'),
      route: '/admin/storage',
      severity: 'warn',
    })
  }
  for (const domain of pendingDomains.value) {
    rows.push({
      label: domain.name,
      description: domainNote(domain),
      route: `/admin/mail/domains/${domain.name}`,
      severity: 'warn',
    })
  }
  for (const user of users.data ?? []) {
    if (user.setup_status === 'Setup failed' || user.setup_status === 'Deletion failed') {
      rows.push({
        label:
          user.setup_status === 'Setup failed'
            ? __('{0}: Mail account setup failed', [user.full_name])
            : __('{0}: Mail deletion needs a retry', [user.full_name]),
        description: user.account || user.email,
        route: '/admin/users',
        severity: 'warn',
      })
    }
  }
  if (enabledCount.value === 1 && adminCount.value === 1) {
    rows.push({
      label: __('Only one active Admin'),
      description: __('Promote another user to keep administration available.'),
      route: '/admin/users',
      severity: 'warn',
    })
  }
  return rows
})
</script>
