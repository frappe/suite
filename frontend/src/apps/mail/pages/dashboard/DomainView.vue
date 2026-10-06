<template>
  <DashboardLayout area="mail" :breadcrumbs="BREADCRUMBS" :loading="!domain.data">
    <template v-if="domain.data" #default>
      <DashboardDetailHeader
        :title="domain.data.name"
        :badge-label="badge.label"
        :badge-theme="badge.theme"
      >
        <template #icon><Globe class="h-5 w-5" /></template>
        <template #meta>
          <template v-for="(entry, index) in metaEntries" :key="entry.text">
            <span v-if="index" class="text-ink-gray-4">·</span>
            <Tooltip :text="entry.tooltip" :disabled="!entry.tooltip">
              <span class="truncate" :class="{ 'cursor-help': entry.tooltip }">{{
                entry.text
              }}</span>
            </Tooltip>
          </template>
        </template>
        <template #actions>
          <Button :label="__('Edit')" @click="showEdit = true" />
          <Button
            :label="__('Verify DNS')"
            :loading="verifyDomain.isPending"
            @click="verifyDomainSubmit()"
          />
          <Dropdown
            :options="exportOptions"
            :button="{ label: __('Export DNS'), iconLeft: 'lucide-download' }"
          />
          <Dropdown :options="dropdownOptions" :button="{ icon: 'lucide-more-horizontal' }" />
        </template>
      </DashboardDetailHeader>
      <div
        v-if="domain.data.status !== 'Active'"
        class="bg-surface-blue-1 flex items-start gap-3 rounded-4 border p-4"
      >
        <Info class="text-ink-blue-5 mt-0.5 h-4 w-4 shrink-0" />
        <div class="space-y-1">
          <h3 class="text-base font-medium">{{ BANNER.title }}</h3>
          <p class="text-ink-gray-5 text-sm">{{ BANNER.message }}</p>
          <p class="text-ink-gray-5 text-sm">{{ BANNER.subtitle }}</p>
        </div>
      </div>
      <div class="rounded-4 border">
        <h2 class="h-13 flex shrink-0 items-center px-4">{{ __('DNS Records') }}</h2>
        <DNSRecords
          v-for="group in recordGroups"
          :key="group.key"
          :title="group.label"
          :description="group.description"
          :records="recordsOf(group.key)"
          :badge-label="group.is_mandatory ? __('Required') : undefined"
          :badge-theme="group.is_mandatory ? 'red' : undefined"
        />
      </div>
    </template>
  </DashboardLayout>
  <Dialog v-model:open="showConfirmDialog" v-bind="confirmDialogOptions" />
  <EditDomainModal
    v-if="domain.data"
    v-model="showEdit"
    :domain="domain.data"
    @reload="domain.refetch().catch(() => {})"
  />
</template>
<script setup lang="ts">
import Globe from '~icons/lucide/globe'
import Info from '~icons/lucide/info'
import { Button, Dialog, Dropdown, Tooltip, usePageMeta } from 'frappe-ui'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { api, client, useMutation, useQuery, type InputOf } from '@/api'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import DNSRecords from '@/apps/mail/components/DNSRecords.vue'
import EditDomainModal from '@/apps/mail/components/Modals/EditDomainModal.vue'
import { downloadUrlAsFile, raiseError, raiseToast } from '@/apps/mail/utils'
import { formatDateTime, fromNow } from '@/apps/mail/utils/datetime'
import { domainStatusBadge, type DomainStatus } from '@/apps/mail/utils/domainStatus'
import DashboardLayout from '@/components/dashboard/DashboardLayout.vue'
import { appPageMeta } from '@/utils/documentTitle'

type DNSRecord = Record<string, string | number | boolean | null | undefined>
type RecordGroup = {
  key: string
  label: string
  description: string
  is_mandatory: boolean
}
type DomainData = {
  id: string
  name: string
  description: string
  status: DomainStatus
  is_enabled: boolean
  catch_all_address?: string
  sub_addressing: boolean
  allow_relaying: boolean
  last_verified_at?: string
  created_at: string
  dns_record_groups: RecordGroup[]
  dns_records: DNSRecord[]
}
const { domainId } = defineProps<{
  domainId: string
}>()
usePageMeta(() => appPageMeta(domain.data?.name || domainId, 'Mail'))
const router = useRouter()
const showConfirmDialog = ref(false)
const showEdit = ref(false)
const domain = useQuery(api.mail.admin.domains.get, () => ({
  domain_id: domainId,
}))
watch(
  () => domain.error,
  (error) => {
    if (!error) return
    raiseError(error)
    router.replace({
      name: 'mail-domains',
    })
  },
)
const domainRecords = computed<DNSRecord[]>(
  () => (domain.data as DomainData | undefined)?.dns_records || [],
)

// Suite Cloud groups the records (authentication, routing, transport security, ...) and says
// which groups a domain needs before it goes live; the page renders whatever it sends.
const recordGroups = computed<RecordGroup[]>(
  () => (domain.data as DomainData | undefined)?.dns_record_groups || [],
)
const recordsOf = (group: string) => domainRecords.value.filter((record) => record.group === group)
const verifyDomain = useMutation(api.mail.admin.domains.verify)
async function verifyDomainSubmit() {
  const input: InputOf<typeof api.mail.admin.domains.verify> = {
    domain_id: domainId,
  }
  await verifyDomain.run(input)
  domain.refetch().catch(() => {})
  raiseToast(__('DNS records checked.'))
}
const deleteDomain = useMutation(api.mail.admin.domains.delete)
async function deleteDomainSubmit() {
  const input: InputOf<typeof api.mail.admin.domains.delete> = {
    domain_id: domainId,
  }
  await deleteDomain.run(input)
  router.push({
    name: 'mail-domains',
  })
  showConfirmDialog.value = false
  raiseToast('Domain deleted.')
}
const setEnabled = useMutation(api.mail.admin.domains.setEnabled)
async function setEnabledSubmit(values: { enabled: boolean }) {
  const input: InputOf<typeof api.mail.admin.domains.setEnabled> = {
    domain_id: domainId,
    enabled: values.enabled,
  }
  const result = await setEnabled.run(input)
  const data = result
  domain.refetch().catch(() => {})
  showConfirmDialog.value = false
  raiseToast(
    data.is_enabled
      ? __('Domain enabled. Verify its DNS records to bring it live.')
      : __('Domain disabled.'),
  )
}
const downloadFile = (content: string, extension: string, mimeType: string) => {
  const domainName = (domain.data as DomainData | undefined)?.name || domainId
  const fileName = `${domainName.replace(/[^a-zA-Z0-9.-]+/g, '_')}.${extension}`
  const blob = new Blob([content], {
    type: mimeType,
  })
  downloadUrlAsFile(URL.createObjectURL(blob), fileName)
}
async function downloadDNSZoneSubmit() {
  const content = await client.query(api.mail.admin.domains.dnsZone, {
    domain_id: domainId,
  })
  downloadFile(content, 'zone', 'text/plain;charset=utf-8')
}
async function downloadDNSCsvSubmit() {
  const content = await client.query(api.mail.admin.domains.dnsCsv, {
    domain_id: domainId,
  })
  downloadFile(content, 'csv', 'text/csv;charset=utf-8')
}
async function downloadDNSJsonSubmit() {
  const content = await client.query(api.mail.admin.domains.dnsJson, {
    domain_id: domainId,
  })
  downloadFile(content, 'json', 'application/json;charset=utf-8')
}
const BREADCRUMBS = computed(() => [
  {
    label: __('Domains'),
    route: '/mail/dashboard/domains',
  },
  {
    label: domain.data?.name || domainId,
  },
])
const confirmDialogAction = ref<'deleteDomain' | 'disableDomain'>('deleteDomain')
const badge = computed(() => domainStatusBadge((domain.data as DomainData | undefined)?.status))
const confirmDialogOptions = computed(() => {
  const config = {
    disableDomain: {
      title: __('Disable Domain'),
      message: __(
        'Mail for this domain stops flowing and its verification is dropped. After enabling it again, its DNS records must be verified before mail flows. Continue?',
      ),
      action: () =>
        setEnabledSubmit({
          enabled: false,
        }),
    },
    deleteDomain: {
      title: __('Delete Domain'),
      message: __('Are you sure you want to delete this domain? This action cannot be undone.'),
      action: deleteDomainSubmit,
    },
  }[confirmDialogAction.value]
  return {
    title: config.title,
    message: config.message,
    size: 'xl' as const,
    icon: 'lucide-alert-triangle',
    theme: 'amber' as const,
    actions: [
      {
        label: __('Confirm'),
        variant: 'solid' as const,
        theme: 'red' as const,
        onClick: config.action,
      },
    ],
  }
})
const isEnabled = computed(() => !!(domain.data as DomainData | undefined)?.is_enabled)

// Facts under the domain name: the description, when it was added (exact time on hover), and
// the delivery settings, each explained on hover since a bare "Sub-addressing on" says little.
const metaEntries = computed(() => {
  const data = domain.data as DomainData | undefined
  const entries: {
    text: string
    tooltip?: string
  }[] = []
  if (data?.description)
    entries.push({
      text: data.description,
    })
  if (data?.created_at) {
    entries.push({
      text: __('Added {0}', [fromNow(data.created_at)]),
      tooltip: formatDateTime(data.created_at),
    })
  }
  entries.push(
    data?.catch_all_address
      ? {
          text: __('Catch-all: {0}', [data.catch_all_address]),
          tooltip: __('Mail to an address that does not exist on this domain is delivered here.'),
        }
      : {
          text: __('No catch-all'),
          tooltip: __('Mail to an address that does not exist on this domain is rejected.'),
        },
  )
  entries.push(
    data?.sub_addressing
      ? {
          text: __('Sub-addressing on'),
          tooltip: __('Mail to user+tag@{0} reaches user@{0}.', [data?.name || '']),
        }
      : {
          text: __('Sub-addressing off'),
          tooltip: __('Mail to user+tag@{0} is rejected.', [data?.name || '']),
        },
  )
  entries.push(
    data?.allow_relaying
      ? {
          text: __('Relaying on'),
          tooltip: __(
            "Mail for addresses of {0} without an account here is forwarded to the domain's MX.",
            [data?.name || ''],
          ),
        }
      : {
          text: __('Relaying off'),
          tooltip: __(
            'Mail for addresses of {0} without an account here is rejected, or goes to the catch-all.',
            [data?.name || ''],
          ),
        },
  )
  return entries
})
const exportOptions = [
  {
    group: '',
    options: [
      {
        label: __('Zone File'),
        icon: 'lucide-file-text',
        onClick: downloadDNSZoneSubmit,
      },
      {
        label: __('CSV'),
        icon: 'lucide-file-text',
        onClick: downloadDNSCsvSubmit,
      },
      {
        label: __('JSON'),
        icon: 'lucide-file-text',
        onClick: downloadDNSJsonSubmit,
      },
    ],
  },
]
const dropdownOptions = computed(() => [
  {
    group: '',
    options: [
      isEnabled.value
        ? {
            label: __('Disable Domain'),
            icon: 'lucide-pause',
            onClick: () => {
              confirmDialogAction.value = 'disableDomain'
              showConfirmDialog.value = true
            },
          }
        : {
            label: __('Enable Domain'),
            icon: 'lucide-play',
            onClick: () =>
              setEnabledSubmit({
                enabled: true,
              }),
          },
      {
        label: __('Delete Domain'),
        icon: 'lucide-trash-2',
        onClick: () => {
          confirmDialogAction.value = 'deleteDomain'
          showConfirmDialog.value = true
        },
      },
    ],
  },
])

// Shown while the records are still to be published; an active domain needs no setup pitch.
const BANNER = {
  title: __('Set Up Your Domain'),
  message: __("Add the following records to your domain's DNS settings."),
  subtitle: __('DNS changes may take up to 48 hours to propagate globally.'),
}
</script>
