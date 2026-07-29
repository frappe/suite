<template>
	<div
		class="group/capsule hover:border-outline-gray-3 flex cursor-pointer items-center space-x-2 rounded-full border px-2 py-1.5"
	>
		<div class="text-ink-gray-4">
			<Loader v-if="isDownloading" class="h-4 w-4 shrink-0 animate-spin" />
			<template v-else>
				<component
					:is="getFileIcon(type)"
					class="h-4 w-4 shrink-0"
					:class="{ 'sm:group-hover/capsule:hidden': blobID }"
				/>
				<button
					class="hidden"
					:class="{ 'sm:group-hover/capsule:block': blobID }"
					@click.stop.prevent="downloadAttachment"
				>
					<Download class="hover:text-ink-gray-8 h-4 w-4 shrink-0" />
				</button>
			</template>
		</div>
		<span class="truncate text-sm">{{ displayName }}</span>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Download, Loader } from 'lucide-vue-next'

import { getAttachmentUrl } from '@/apps/mail/resources'
import { downloadUrlAsFile, getFileIcon } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'

const { fileName, blobID, type } = defineProps<{
	fileName: string
	blobID?: string
	type?: string
}>()

const { isMobile } = useScreenSize()

// On mobile long names truncate in the middle so the extension survives
// ("quarterly-report…-final.pdf", not "quarterly-repo…"). Desktop keeps CSS
// end-truncation, whose tooltip shows the full name on hover anyway.
const MOBILE_NAME_MAX = 24
const displayName = computed(() => {
	if (!isMobile.value || fileName.length <= MOBILE_NAME_MAX) return fileName
	const tail = fileName.slice(-10)
	return `${fileName.slice(0, MOBILE_NAME_MAX - 11)}…${tail}`
})

const isDownloading = ref(false)

const downloadAttachment = async () => {
	if (!blobID) return

	isDownloading.value = true
	try {
		const url = await getAttachmentUrl(blobID, type)
		downloadUrlAsFile(url, fileName || 'attachment')
	} catch {
		// the resource's onError already raised a toast; just stop spinning
	} finally {
		isDownloading.value = false
	}
}
</script>
