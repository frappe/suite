<template>
	<Navbar
		:primaryButton="primaryButtonProps"
		:dropdown="showNavbarDropdown ? 'context' : null"
		@performDropdownAction="(action) => emit('performDropdownAction', action)"
	>
		<template v-if="!inReadonlyMode" #left-actions>
			<Button
				variant="ghost"
				tooltip="Template Theme"
				@click="emit('performDropdownAction', 'updateTheme')"
			>
				<template #icon>
					<LucideSwatchBook class="size-4 stroke-[1.5] text-ink-gray-7" />
				</template>
			</Button>
		</template>
		<template #default>
			<div class="flex w-full justify-center">
				<PresentationHeader :title="presentationDoc?.title" />
			</div>
		</template>
		<template v-if="!inReadonlyMode" #right-actions>
			<Badge v-if="!isOnline" variant="subtle" theme="orange" size="md">
				<LucideWifiOff class="mr-1 size-3.5 stroke-[1.5]" />
				<span>Offline</span>
			</Badge>
			<Badge v-if="saveFailed && isOnline" variant="subtle" theme="orange" size="md">
				<LucideCloudOff class="mr-1 size-3.5 stroke-[1.5]" />
				<span>Save failed. Keep this tab open.</span>
			</Badge>
			<Button
				v-if="presentationDoc"
				variant="ghost"
				tooltip="Export"
				@click="emit('performDropdownAction', 'export')"
			>
				<template #icon>
					<LucideDownload class="size-4 stroke-[1.5]" />
				</template>
			</Button>
			<SharePopover v-if="presentationDoc" />
		</template>
	</Navbar>
</template>

<script setup>
import { ref, computed, inject } from 'vue'
import { Presentation } from 'lucide-vue-next'

import { Badge, Button } from 'frappe-ui'

import Navbar from '@/apps/slides/components/Navbar.vue'
import PresentationHeader from '@/apps/slides/components/PresentationHeader.vue'
import SharePopover from '@/apps/slides/components/SharePopover.vue'

import { presentationDoc } from '@/apps/slides/stores/presentation'
import { saveFailed } from '@/apps/slides/stores/saving'
import { useRoute } from 'vue-router'

// no provider outside SlidesShell; assume online rather than flag a false outage
const isOnline = inject('isOnline', ref(true))
const inReadonlyMode = inject('inReadonlyMode', ref(false))

const emit = defineEmits(['startSlideShow', 'performDropdownAction'])

const route = useRoute()

const primaryButtonProps = computed(() => ({
	label: 'Present',
	icon: Presentation,
	onClick: () => emit('startSlideShow'),
	hide: route.name === 'slides-editor-new',
}))

const showNavbarDropdown = computed(() => route.name !== 'slides-editor-new')
</script>
