<template>
  <DashboardLayout area="mail" :breadcrumbs="[{ label: __('TLS Reports') }]">
    <!-- Filters in one row; the domain and period scope both the summary and the list. -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <FormControl v-model="search" :placeholder="__('Search reporter or domain')" class="w-80">
        <template #prefix>
          <FeatherIcon name="search" class="text-ink-gray-5 w-4" />
        </template>
      </FormControl>
      <div class="flex items-center gap-3">
        <FormControl v-model="domain" class="w-56" type="select" :options="domainOptions" />
        <FormControl v-model="period" class="w-40" type="select" :options="PERIOD_OPTIONS" />
      </div>
    </div>

    <TlsStatTiles v-if="summary.data" :totals="summary.data.totals" />
    <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div v-for="n in 3" :key="n" class="bg-surface-gray-1 h-24 animate-pulse rounded-4 border" />
    </div>

    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <!-- What went wrong, biggest first: the failure type says whether a certificate, the
			     MTA-STS policy or STARTTLS itself is to blame. -->
      <DashboardCard :title="__('Failure Types')">
        <div v-if="failures.length" class="flex max-h-72 flex-col overflow-y-auto">
          <div
            v-for="row in failures"
            :key="row.result_type ?? 'other'"
            class="flex h-12 shrink-0 items-center gap-3 border-b px-5 text-sm last:border-b-0"
          >
            <span class="min-w-0 flex-1 truncate font-medium" :title="row.result_type ?? undefined">
              {{ resultTypeLabel(row.result_type) }}
            </span>
            <span class="text-ink-gray-5 w-24 shrink-0 text-right tabular-nums">
              {{ __('{0} reports', [row.reports.toLocaleString()]) }}
            </span>
            <span class="text-ink-gray-5 w-28 shrink-0 text-right tabular-nums">
              {{ __('{0} failed', [row.failed.toLocaleString()]) }}
            </span>
          </div>
        </div>
        <div v-else class="text-ink-gray-5 px-5 py-4 text-sm">
          {{
            summary.data?.totals.sessions
              ? __('Every reported session negotiated TLS.')
              : __('No sessions were reported for this period.')
          }}
        </div>
      </DashboardCard>
      <DashboardCard :title="__('Reporters')">
        <TlsBreakdownRows
          :rows="summary.data?.reporters || []"
          label-key="reporter"
          :empty="__('No sending server has reported for this period yet.')"
        />
      </DashboardCard>
    </div>

    <div class="flex min-h-0 flex-1 flex-col">
      <ListView
        v-if="list.status === 'success'"
        class="min-h-0 flex-1 !overflow-y-auto [&>div:first-child]:sticky [&>div:first-child]:top-0 [&>div:first-child]:z-10"
        :columns="LIST_COLUMNS"
        :rows="list.rows"
        :options="listOptions"
        row-key="id"
      >
        <ListHeader />
        <ListRows>
          <template v-if="list.rows.length">
            <ListRow
              v-for="row in list.rows"
              :key="row.id"
              v-slot="{ column, item }"
              :row="row"
              class="hover:!bg-surface-gray-1"
            >
              <!-- Plain cells rather than the list's own cell component, which wraps each cell
							     in a Tooltip: a page of 500 rows would mount thousands and stall the page. -->
              <template v-if="column.key === 'success_rate'">
                <Badge
                  v-if="row.sessions && item != null"
                  :theme="rateTheme(item)"
                  :label="formatRate(item)"
                />
              </template>
              <span
                v-else-if="column.key === 'date_range_end'"
                class="text-ink-gray-5 truncate text-sm"
              >
                {{ formatPeriod(row) }}
              </span>
              <span
                v-else-if="column.key === 'received_at'"
                class="text-ink-gray-5 truncate text-sm"
              >
                {{ fromNow(item) || '—' }}
              </span>
              <span
                v-else-if="column.key === 'sessions' || column.key === 'failed'"
                class="text-base tabular-nums"
              >
                {{ item ? Number(item).toLocaleString() : '' }}
              </span>
              <span v-else class="truncate text-base">{{ item }}</span>
            </ListRow>
          </template>
          <ListEmptyState v-else />
        </ListRows>
      </ListView>
      <DashboardListSkeleton v-else />
      <DashboardPager
        v-if="list.status === 'success' && list.total"
        :count="list.rows.length"
        :total="list.total ?? 0"
        :page-length="pageLength"
        :has-more="list.hasNext"
        :loading="list.isFetching"
        @update:page-length="(value) => (pageLength = value)"
        @load-more="list.fetchNext().catch(() => {})"
      />
    </div>
  </DashboardLayout>
</template>

<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { Badge, FormControl, usePageMeta } from 'frappe-ui'
import {
  Icon as FeatherIcon,
  ListEmptyState,
  ListHeader,
  ListRow,
  ListRows,
  ListView,
} from 'frappe-ui/experimental'
import { computed, ref } from 'vue'

import { api, useInfiniteQuery, useQuery } from '@/api'
import DashboardPager from '@/apps/mail/components/DashboardPager.vue'
import TlsBreakdownRows from '@/apps/mail/components/TlsBreakdownRows.vue'
import TlsStatTiles from '@/apps/mail/components/TlsStatTiles.vue'
import { formatDateTime, fromNow } from '@/apps/mail/utils/datetime'
import { DEFAULT_PAGE_LENGTH, type PageLength } from '@/apps/mail/utils/paging'
import { DEFAULT_PERIOD, formatRate, PERIOD_OPTIONS, rateTheme } from '@/apps/mail/utils/reports'
import { resultTypeLabel, type TlsFailureType, type TlsReportRow } from '@/apps/mail/utils/tls'
import DashboardCard from '@/components/dashboard/DashboardCard.vue'
import DashboardLayout from '@/components/dashboard/DashboardLayout.vue'
import DashboardListSkeleton from '@/components/dashboard/DashboardListSkeleton.vue'
import { appPageMeta } from '@/utils/documentTitle'

usePageMeta(() => appPageMeta(__('TLS Reports'), 'Mail'))
const search = ref('')
const domain = ref('')
const period = ref(DEFAULT_PERIOD)

// Every domain the site holds, live or not: a domain taken offline still has a history.
const domains = useQuery(api.mail.admin.domains.list, () => ({
  page_length: 500,
}))
const domainOptions = computed(() => [
  {
    label: __('All domains'),
    value: '',
  },
  ...(domains.data?.items || []).map((d: { name: string }) => ({
    label: d.name,
    value: d.name,
  })),
])
const summary = useQuery(api.mail.admin.tls.summary, () => ({
  domain_id: domain.value || undefined,
  days: Number(period.value),
}))
const failures = computed<TlsFailureType[]>(() => summary.data?.failures || [])

// The list and the summary take the same domain and period, so the page never shows a
// period's totals beside reports from outside it.
const debouncedSearch = refDebounced(search, 300)
const pageLength = ref<PageLength>(DEFAULT_PAGE_LENGTH)
const list = useInfiniteQuery(api.mail.admin.tls.list, () => ({
  txt: debouncedSearch.value,
  domain_id: domain.value || undefined,
  days: Number(period.value),
  start: 0,
  page_length: pageLength.value,
}))
const LIST_COLUMNS = [
  {
    label: __('Domain'),
    key: 'domain',
  },
  {
    label: __('Reporter'),
    key: 'reporter',
  },
  {
    label: __('Period'),
    key: 'date_range_end',
  },
  {
    label: __('Sessions'),
    key: 'sessions',
  },
  {
    label: __('Failed'),
    key: 'failed',
  },
  {
    label: __('Success Rate'),
    key: 'success_rate',
  },
  {
    label: __('Received'),
    key: 'received_at',
  },
]
const hasActiveFilters = computed(
  () => !!search.value || !!domain.value || period.value !== DEFAULT_PERIOD,
)
const listOptions = computed(() => ({
  selectable: false,
  showTooltip: false,
  emptyState: hasActiveFilters.value
    ? {
        title: __('No matching reports'),
        description: __('Try another search, domain or period.'),
      }
    : {
        title: __('No TLS reports yet'),
        description: __(
          'Servers that deliver mail to your domains send a daily report on their TLS connections to postmaster@your-domain once the domain publishes its TLS-RPT record. Reports appear here within an hour of arriving.',
        ),
      },
  getRowRoute: (row: TlsReportRow) => ({
    name: 'mail-tls-report',
    params: {
      reportId: row.id,
    },
  }),
}))
const formatPeriod = (row: TlsReportRow) => {
  const begin = formatDateTime(row.date_range_begin, 'MMM D')
  const end = formatDateTime(row.date_range_end, 'MMM D, YYYY')
  return begin && end ? `${begin} – ${end}` : end || begin || '—'
}
</script>
