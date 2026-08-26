<template>
	<Navbar
		:primaryButton="primaryButtonProps"
		:dropdown="showNavbarDropdown ? 'context' : null"
		@performDropdownAction="(action) => emit('performDropdownAction', action)"
	>
		<template #default>
			<div class="flex w-full justify-center">
				<PresentationHeader :title="presentationDoc?.title" />
			</div>
		</template>
		<template #right-actions>
			<Badge v-if="!inReadonlyMode && !isOnline" variant="subtle" theme="amber" size="md">
				<LucideWifiOff class="mr-1 size-3.5 stroke-[1.5]" />
				<span>Offline</span>
			</Badge>
			<Badge v-if="!inReadonlyMode && saveFailed && isOnline" variant="subtle" theme="amber" size="md">
				<LucideCloudOff class="mr-1 size-3.5 stroke-[1.5]" />
				<span>Save failed. Keep this tab open.</span>
			</Badge>
			<OfflineCopyButton v-if="canPin" />
			<Button
				v-if="!inReadonlyMode && presentationDoc"
				variant="ghost"
				tooltip="Export"
				@click="emit('performDropdownAction', 'export')"
			>
				<template #icon>
					<LucideDownload class="size-4 stroke-[1.5]" />
				</template>
			</Button>
			<SharePopover v-if="!inReadonlyMode && presentationDoc" />
		</template>
	</Navbar>
</template>

<script setup>
import { ref, computed, inject } from 'vue'
import { Play } from 'lucide-vue-next'

import { Badge, Button } from 'frappe-ui'

import Navbar from '@/apps/slides/components/Navbar.vue'
import PresentationHeader from '@/apps/slides/components/PresentationHeader.vue'
import SharePopover from '@/apps/slides/components/SharePopover.vue'
import OfflineCopyButton from '@/apps/slides/components/OfflineCopyButton.vue'

import { presentationDoc } from '@/apps/slides/stores/presentation'
import { saveFailed } from '@/apps/slides/stores/saving'
import { isMediaOwner } from '@/apps/slides/utils/mediaUploads'
import { useSessionStore } from '@/boot/session'
import { useRoute } from 'vue-router'

const isOnline = inject('isOnline', ref(false))
const inReadonlyMode = inject('inReadonlyMode', ref(false))

const emit = defineEmits(['startSlideShow', 'performDropdownAction'])

const route = useRoute()
const sessionStore = useSessionStore()

// same users getAttachmentUrl serves directly, so pinning never goes through the proxy
const canPin = computed(() => {
	if (!('serviceWorker' in navigator) || !('caches' in window)) return false
	return isMediaOwner(presentationDoc.value?.owner, sessionStore.user)
})

const primaryButtonProps = computed(() => ({
	label: 'Present',
	icon: Play,
	onClick: () => emit('startSlideShow'),
	hide: route.name === 'slides-editor-new',
}))

const showNavbarDropdown = computed(() => route.name !== 'slides-editor-new')
</script>
