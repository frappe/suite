<!-- A KPI strip and focused area summaries; exceptions stay beside the area that owns their remediation. -->
<script setup lang="ts">
import { Alert, Button, ErrorMessage, Skeleton } from 'frappe-ui'
import { computed, watchEffect } from 'vue'
import { RouterLink } from 'vue-router'

import { api, useInfiniteQuery, useQuery, type OutputOf } from '@/api'
import { DashboardLayout, DashboardSkeletonText } from '@/platform/dashboard'
import { translate as __ } from '@/platform/translation'

import SiteStorageSummary from './SiteStorageSummary.vue'
import SiteStorageSummarySkeleton from './SiteStorageSummarySkeleton.vue'

type DomainRow = OutputOf<typeof api.mail.admin.domains.list>['items'][number]
const storage = useQuery(api.suite.storage.get)
const users = useQuery(api.suite.users.list)
const health = useQuery(api.suite.admin.health)
const domains = useInfiniteQuery(api.mail.admin.domains.list, () =>
  storage.data?.cloud ? { page_length: 500 } : false,
)
const enabledCount = computed(() =>
  users.error ? undefined : users.data?.filter((user) => user.enabled).length,
)
const readyDomains = computed(() => domains.rows.filter(isReady))
const pendingDomains = computed(() => domains.rows.filter((domain) => !isReady(domain)))
const domainsComplete = computed(
  () => domains.status === 'success' && !domains.hasNext && !domains.error,
)
const domainCount = computed(() => domains.total ?? domains.rows.length)
watchEffect(() => {
  if (domains.hasNext && !domains.isFetching && !domains.isFetchingNext && !domains.error)
    void domains.fetchNext().catch(() => {
      // The observer exposes the failure in the domain card, without calling
      // the partially loaded directory a complete readiness count.
    })
})

function isReady(domain: DomainRow) {
  return domain.status === 'Active' && domain.is_enabled && domain.is_verified
}
function domainNote(domain: DomainRow) {
  if (domain.status === 'Pending Verification' || !domain.is_verified)
    return __('Verify DNS records')
  if (!domain.is_enabled) return __('Domain is disabled')
  return domain.status
}
const kpis = computed(() => {
  const report = storage.data
  if (!report) return []
  return [
    {
      label: __('Active users'),
      value: enabledCount.value ?? '—',
      route: '/admin/users',
    },
    ...(report.cloud
      ? [
          {
            label: __('Pending invitations'),
            value: report.pending_invitations,
            route: '/admin/users/invitations',
          },
          {
            label: __('Domains'),
            value: domainsComplete.value
              ? domainCount.value
                ? `${readyDomains.value.length}/${domainCount.value}`
                : __('Not set')
              : '—',
            route: '/admin/mail/domains',
          },
        ]
      : []),
  ]
})
</script>

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
        :route="storage.data?.cloud ? '/admin/users?add=1' : '/admin/users'"
      />
    </template>
    <template #loading>
      <div class="mx-auto w-full max-w-5xl space-y-6 pb-10" aria-hidden="true">
        <div class="grid overflow-hidden rounded-5 border border-outline-gray-2 sm:grid-cols-3">
          <div
            v-for="n in 3"
            :key="n"
            class="space-y-1.5 border-b border-outline-gray-2 px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
          >
            <DashboardSkeletonText class="text-sm" width="7rem" />
            <DashboardSkeletonText class="text-3xl" width="3rem" />
          </div>
        </div>
        <SiteStorageSummarySkeleton action />
        <section class="space-y-4 rounded-5 border border-outline-gray-2 p-4 sm:p-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-lg-medium text-ink-gray-9">{{ __('Domains') }}</h2>
            <Skeleton class="h-7 w-28 rounded-4" />
          </div>
          <DashboardSkeletonText class="text-p-sm" width="8rem" />
        </section>
      </div>
    </template>
    <ErrorMessage :message="storage.error?.message" />
    <div v-if="storage.data" class="mx-auto w-full max-w-5xl space-y-6 pb-10">
      <div
        class="grid overflow-hidden rounded-5 border border-outline-gray-2"
        :class="storage.data.cloud ? 'sm:grid-cols-3' : 'grid-cols-1'"
        :aria-label="__('Workspace summary')"
      >
        <RouterLink
          v-for="kpi in kpis"
          :key="kpi.label"
          :to="kpi.route"
          class="space-y-1.5 border-b border-outline-gray-2 px-5 py-4 last:border-b-0 hover:bg-surface-gray-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-outline-gray-3 sm:border-b-0 sm:border-r sm:last:border-r-0"
        >
          <p class="text-sm text-ink-gray-5">{{ kpi.label }}</p>
          <p class="text-3xl font-semibold tabular-nums text-ink-gray-9">
            {{ kpi.value }}
          </p>
        </RouterLink>
      </div>

      <Alert
        v-if="health.data?.suspended"
        theme="red"
        :title="__('This site is suspended by Suite Cloud')"
        :description="__('Contact your provider to restore access.')"
      />
      <Alert
        v-else-if="health.data?.stale"
        theme="amber"
        :title="__('Suite Cloud could not be reached')"
        :description="__('Try again later. Your files and mail are still available.')"
      />
      <Alert
        v-if="health.error"
        theme="amber"
        :title="__('Could not check service status')"
        :description="__('Refresh the page to try again.')"
      />

      <SiteStorageSummary :report="storage.data">
        <template #actions>
          <Button variant="ghost" :label="__('Manage storage')" route="/admin/storage" />
        </template>
      </SiteStorageSummary>

      <section
        v-if="storage.data.cloud"
        class="space-y-4 rounded-5 border border-outline-gray-2 p-4 sm:p-5"
        :aria-label="__('Domains')"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="space-y-1">
            <h2 class="text-lg-medium text-ink-gray-9">{{ __('Domains') }}</h2>
          </div>
          <Button variant="ghost" :label="__('Manage domains')" route="/admin/mail/domains" />
        </div>
        <p
          v-if="domains.status === 'pending' || (domains.hasNext && !domains.error)"
          class="text-p-sm text-ink-gray-5"
        >
          {{ __('Checking domains…') }}
        </p>
        <Alert
          v-else-if="domains.error"
          theme="amber"
          :title="__('Domain status is unavailable')"
          :description="__('Open Domains to try again.')"
        />
        <template v-else-if="domainsComplete">
          <Alert
            v-for="domain in pendingDomains"
            :key="domain.id"
            class="domain-alert"
            theme="amber"
            :title="__('{0}: {1}', [domain.name, domainNote(domain)])"
          >
            <template #actions>
              <Button
                variant="ghost"
                :label="__('Open domain')"
                :route="`/admin/mail/domains/${encodeURIComponent(domain.name)}`"
              />
            </template>
          </Alert>
          <Alert
            v-if="!domainCount"
            class="domain-alert"
            theme="amber"
            :title="__('No domain set')"
          >
            <template #actions>
              <Button variant="ghost" :label="__('Add domain')" route="/admin/mail/domains?add=1" />
            </template>
          </Alert>
          <ul v-else-if="!pendingDomains.length" class="flex flex-wrap gap-2">
            <li v-for="domain in readyDomains" :key="domain.id">
              <RouterLink
                :to="`/admin/mail/domains/${encodeURIComponent(domain.name)}`"
                class="flex items-center gap-1.5 rounded-4 bg-surface-gray-1 px-2.5 py-1.5 text-sm text-ink-gray-7 hover:bg-surface-gray-2"
              >
                <span class="lucide-check size-3.5 text-ink-green-6" aria-hidden="true" />
                {{ domain.name }}
              </RouterLink>
            </li>
          </ul>
        </template>
      </section>

      <Alert
        v-if="users.error"
        theme="amber"
        :title="__('Could not load users')"
        :description="__('Open Users to try again.')"
      />
    </div>
  </DashboardLayout>
</template>

<style scoped>
.domain-alert[data-color='amber'] {
  background-color: var(--surface-amber-2);
  height: auto;
  min-height: 2.5rem;
}
.domain-alert :deep([data-slot='title']) {
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
