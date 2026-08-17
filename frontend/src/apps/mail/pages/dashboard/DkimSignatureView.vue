<template>
	<DashboardLayout :breadcrumbs="breadcrumbs" :loading="!signature.data">
		<template #default>
			<DashboardDetailHeader
				:title="signature.data.domain || signatureId"
				:meta="[signature.data.algorithm, signature.data.selector]"
			>
				<template #icon><FileKey2 class="h-5 w-5" /></template>
				<template #actions>
					<Dropdown :options="dropdownOptions" :button="{ icon: 'lucide-more-horizontal' }" />
				</template>
			</DashboardDetailHeader>
			<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
				<!-- Signature -->
				<DashboardCard :title="__('Signature')">
					<div>
						<InformationField :label="__('Signature Type')" :value="signature.data.algorithm" />
						<InformationField :label="__('Selector')" :value="signature.data.selector" />
					</div>
				</DashboardCard>

				<!-- Rotation -->
				<DashboardCard :title="__('Rotation')">
					<div>
						<InformationField :label="__('Stage')" :value="stageLabel" />
						<InformationField :label="__('Created At')" :value="createdAt" />
						<InformationField :label="__('Next Transition')" :value="nextTransition" />
					</div>
				</DashboardCard>

				<!-- Options -->
				<DashboardCard :title="__('Options')">
					<div>
						<InformationField :label="__('Signed Headers')" :value="signedHeaders" />
						<InformationField :label="__('Canonicalization')" :value="signature.data.canonicalization" />
						<InformationField :label="__('Expiration')" :value="signature.data.expiration" />
						<InformationField :label="__('Request Reports')" :value="requestReports" />
						<InformationField :label="__('Agent User ID')" :value="signature.data.auid" />
					</div>
				</DashboardCard>

				<!-- Public Key -->
				<DashboardCard :title="__('Public Key')">
					<div class="p-4">
						<Tooltip :text="__('Click to copy')" :disabled="!publicKey">
							<div
								class="group/copy flex items-start gap-1.5"
								:class="{ 'cursor-copy': publicKey }"
								@click="publicKey && copyToClipBoard(publicKey)"
							>
								<code class="text-ink-gray-7 block break-all font-mono text-xs">
									{{ publicKey || '—' }}
								</code>
								<FeatherIcon
									v-if="publicKey"
									name="copy"
									class="text-ink-gray-5 invisible h-3.5 w-3.5 shrink-0 group-hover/copy:visible"
								/>
							</div>
						</Tooltip>
					</div>
				</DashboardCard>
			</div>
		</template>
	</DashboardLayout>
	<Dialog v-model:open="showDelete" v-bind="deleteDialogOptions" />
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Dialog, Dropdown, Tooltip, createResource, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import FileKey2 from '~icons/lucide/file-key-2'

import { copyToClipBoard, raiseToast } from '@/apps/mail/utils'
import { formatDateTime } from '@/apps/mail/utils/datetime'
import DashboardCard from '@/apps/mail/components/DashboardCard.vue'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import InformationField from '@/apps/mail/components/InformationField.vue'

type DkimData = {
	id: string
	algorithm?: string
	selector?: string
	domain?: string
	signed_headers: string[]
	canonicalization?: string
	expiration?: string | null
	request_reports: boolean
	auid?: string | null
	public_key?: string
	stage?: string
	created_at?: string
	next_transition?: string | null
}

const { signatureId } = defineProps<{ signatureId: string }>()
const router = useRouter()

const showDelete = ref(false)

usePageMeta(() => ({ title: (signature.data as DkimData | undefined)?.selector || signatureId }))

const signature = createResource({
	url: 'suite.mail.api.admin.get_dkim_signature',
	auto: true,
	makeParams: () => ({ signature_id: signatureId }),
	cache: ['mailDkimSignature', signatureId],
	onError: (error: { messages?: string[] }) => {
		raiseToast(error.messages?.[0] || __('DKIM signature not found.'), 'error')
		router.replace({ name: 'mail-dkim-signatures' })
	},
})

const data = computed(() => signature.data as DkimData | undefined)

const formatDate = (value?: string | null) => formatDateTime(value)

const stageLabel = computed(() => {
	const stage = data.value?.stage
	return stage ? stage.charAt(0).toUpperCase() + stage.slice(1) : ''
})
const createdAt = computed(() => formatDate(data.value?.created_at))
const nextTransition = computed(() => formatDate(data.value?.next_transition))
const signedHeaders = computed(() => (data.value?.signed_headers || []).join(', '))
const publicKey = computed(() => data.value?.public_key || '')
const requestReports = computed(() => (data.value?.request_reports ? __('Yes') : __('No')))

const breadcrumbs = computed(() => [
	{ label: __('DKIM Signatures'), route: '/mail/dashboard/dkim-signatures' },
	{ label: data.value?.selector || signatureId },
])

const deleteSignature = createResource({
	url: 'suite.mail.api.admin.delete_dkim_signatures',
	makeParams: () => ({ ids: [signatureId] }),
	onSuccess: () => {
		showDelete.value = false
		raiseToast(__('DKIM signature deleted.'))
		router.push({ name: 'mail-dkim-signatures' })
	},
	onError: (error: { messages?: string[] }) =>
		raiseToast(error.messages?.[0] || __('Failed to delete DKIM signature.'), 'error'),
})

const deleteDialogOptions = computed(() => ({
	title: __('Delete DKIM Signature'),
	message: __('Are you sure you want to delete this DKIM signature? This action cannot be undone.'),
	size: 'xl',
	icon: { name: 'lucide-alert-triangle', theme: 'amber' },
	actions: [{ label: __('Confirm'), variant: 'solid', theme: 'red', onClick: deleteSignature.submit }],
}))

const dropdownOptions = computed(() => [
	{
		group: '',
		options: [{ label: __('Delete'), icon: 'lucide-trash-2', onClick: () => (showDelete.value = true) }],
	},
])
</script>
