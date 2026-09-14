<template>
	<Button variant="ghost" tooltip="Share" @click="openShareDialog">
		<template #icon>
			<LucideShare2 class="size-4 stroke-[1.5]" />
		</template>
	</Button>
	<ShareDialog v-if="showShareDialog && file" v-model="showShareDialog" :file allowed-access="reader" />
</template>

<script setup>
import { ref } from 'vue'
import { Button } from 'frappe-ui'
import { ShareDialog, getFileForDoc } from '@/apps/drive/legacy/sdk'
import { presentationId } from '@/apps/slides/stores/presentation'
import { resetFocus } from '@/apps/slides/stores/element'

const showShareDialog = ref(false)
const file = ref(null)

const openShareDialog = async () => {
	await resetFocus()
	file.value = await getFileForDoc('Presentation', presentationId.value)
	showShareDialog.value = true
}
</script>
