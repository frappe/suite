<template>
	<Button variant="ghost" :tooltip="statusText" @click="showDialog = true">
		<template #icon>
			<component
				:is="icon"
				class="size-4 stroke-[1.5]"
				:class="[iconClass, progress.running && 'animate-pulse']"
			/>
		</template>
	</Button>
	<Dialog
		v-model:open="showDialog"
		size="md"
		:title="dialog.title"
		:icon="dialog.icon"
		:message="dialog.message"
		:actions="dialog.actions"
	/>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Dialog, Button, toast } from 'frappe-ui'
import { CloudAlert, CloudCheck, CloudDownload } from 'lucide-vue-next'

import {
	offlineCopyProgress as progress,
	offlineCopyStatus as status,
	saveOfflineCopy,
	cancelOfflineCopy,
	removeOfflineCopy,
	refreshOfflineStatus,
} from '@/apps/slides/stores/offlineCopy'
import { presentationId } from '@/apps/slides/stores/presentation'

const showDialog = ref(false)

const icon = computed(() => {
	if (progress.value.running) return CloudDownload
	if (status.value === 'available') return CloudCheck
	if (status.value === 'outdated') return CloudAlert
	return CloudDownload
})

const iconClass = computed(() =>
	status.value === 'outdated' ? 'text-ink-amber-6' : 'text-ink-gray-6',
)

const statusText = computed(() => {
	if (progress.value.running) return 'Saving offline copy'
	if (status.value === 'available') return 'Available offline'
	if (status.value === 'outdated') return 'Offline copy out of date'
	return 'Save offline copy'
})

const reportSave = (result) => {
	if (result.uncontrolled && !result.registered) {
		toast.error('Offline copies are turned off on this site')
	} else if (result.uncontrolled) {
		toast.error('Could not start saving', {
			description: 'Reload the page and try again.',
		})
	} else if (result.failed.some((failure) => failure.status === 'quota')) {
		toast.error('Browser storage is full', {
			description: 'Remove other offline copies to make room.',
		})
	} else if (result.failed.length) {
		toast.warning(`${result.failed.length} of ${result.count} images not saved`, {
			description: 'Check your connection and try again.',
		})
	} else {
		toast.success('Available offline', {
			description: 'Opens and presents without internet.',
		})
	}
}

const save = async ({ close }) => {
	close()
	try {
		const result = await saveOfflineCopy(presentationId.value)
		if (result) reportSave(result)
	} catch {
		toast.error('Could not save the offline copy')
	}
	refreshOfflineStatus(presentationId.value)
}

const remove = async ({ close }) => {
	close()
	try {
		await removeOfflineCopy(presentationId.value)
		toast('Offline copy removed', {
			description: 'Needs internet to open.',
		})
	} catch {
		toast.error('Could not remove the offline copy')
	}
	refreshOfflineStatus(presentationId.value)
}

const cancel = ({ close }) => {
	cancelOfflineCopy()
	close()
	toast('Saving stopped', {
		description: 'Saved images are kept.',
	})
}

const cancelAction = { label: 'Cancel', variant: 'outline' }
const removeAction = { label: 'Remove copy', variant: 'subtle', onClick: remove }

const dialog = computed(() => {
	if (progress.value.running) {
		return {
			title: 'Saving offline copy',
			icon: 'lucide-cloud-download',
			message: `${progress.value.done} of ${progress.value.total} files saved`,
			actions: [cancelAction, { label: 'Stop saving', variant: 'solid', onClick: cancel }],
		}
	}
	if (status.value === 'available') {
		return {
			title: 'Available offline',
			icon: { name: 'lucide-cloud-check', theme: 'blue' },
			message: 'Saved in this browser. Opens and presents without internet.',
			actions: [cancelAction, { ...removeAction, variant: 'solid' }],
		}
	}
	if (status.value === 'outdated') {
		return {
			title: 'Update offline copy',
			icon: { name: 'lucide-cloud-alert', theme: 'amber' },
			message: 'New images are not saved offline yet.',
			actions: [removeAction, { label: 'Update copy', variant: 'solid', onClick: save }],
		}
	}
	return {
		title: 'Save offline copy',
		icon: 'lucide-cloud-download',
		message: 'Opens and presents without internet. Videos still need a connection.',
		actions: [cancelAction, { label: 'Save copy', variant: 'solid', onClick: save }],
	}
})
</script>
