<template>
	<Navbar
		:primaryButton="primaryButtonProps"
		:showNavbarDropdown="showNavbarDropdown"
		@performDropdownAction="(action) => emit('performDropdownAction', action)"
	>
		<template #default>
			<div class="flex w-full justify-center">
				<PresentationHeader :title="presentationDoc?.title" />
			</div>
		</template>
		<template v-if="!inReadonlyMode" #actions>
			<Badge v-if="!isOnline" variant="subtle" theme="orange" size="md">
				<LucideWifiOff class="mr-1 size-3.5 stroke-[1.5]" />
				<span>Offline</span>
			</Badge>
			<Badge v-if="saveFailed && isOnline" variant="subtle" theme="orange" size="md">
				<LucideCloudOff class="mr-1 size-3.5 stroke-[1.5]" />
				<span>Save failed. Keep this tab open.</span>
			</Badge>
			<SharePopover v-if="presentationDoc" />
		</template>
	</Navbar>
</template>

<script setup>
import { ref, computed, inject } from 'vue'
import { Presentation } from 'lucide-vue-next'

import { Badge } from 'frappe-ui'

import Navbar from '@/apps/slides/components/Navbar.vue'
import PresentationHeader from '@/apps/slides/components/PresentationHeader.vue'
import SharePopover from '@/apps/slides/components/SharePopover.vue'

import { presentationDoc } from '@/apps/slides/stores/presentation'
import { saveFailed } from '@/apps/slides/stores/saving'
import { useRoute } from 'vue-router'

const isOnline = inject('isOnline', ref(false))
const inReadonlyMode = inject('inReadonlyMode', ref(false))

const emit = defineEmits(['startSlideShow', 'performDropdownAction'])

const route = useRoute()

const primaryButtonProps = computed(() => ({
	label: 'Present',
	icon: Presentation,
	onClick: () => emit('startSlideShow'),
	hide: route.name === 'slides-editor-new',
}))

const showNavbarDropdown = computed(() => {
	if (route.name === 'slides-editor-new') return false
	return !inReadonlyMode.value
})
</script>
