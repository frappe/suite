<template>
	<div class="flex h-full flex-col">
		<header class="flex items-center border-b px-3 py-2.5 sm:px-5">
			<Button v-if="isMobile" icon="lucide-menu" variant="ghost" @click="openSidebar" />
			<Breadcrumbs :items="breadcrumbs" class="mx-2" />
			<Badge v-if="badgeLabel && !loading" :label="badgeLabel" :theme="badgeTheme" />
			<div class="ml-auto flex space-x-2">
				<slot v-if="!loading" name="actions">
					<Button
						v-if="buttonLabel"
						:label="buttonLabel"
						icon-left="lucide-plus"
						@click="buttonAction"
					/>
				</slot>
			</div>
		</header>
		<div
			class="flex flex-1 flex-col overflow-y-auto"
			:class="{ 'space-y-5 px-3 py-5 sm:px-5': !removeSpacing }"
		>
			<!-- While the page resource loads, keep the chrome (header, breadcrumbs)
			     and show a placeholder body instead of a blank pane. -->
			<slot v-if="loading" name="loading">
				<DashboardListSkeleton />
			</slot>
			<slot v-else />
		</div>
	</div>
</template>

<script setup lang="ts">
import { Badge, Breadcrumbs, Button } from 'frappe-ui'

import { useScreenSize, useSidebar } from '@/apps/mail/utils/composables'
import DashboardListSkeleton from '@/apps/mail/components/DashboardListSkeleton.vue'

const { removeSpacing = false, loading = false } = defineProps<{
	breadcrumbs: { label: string; route?: string }[]
	buttonLabel?: string
	buttonAction?: () => void
	badgeLabel?: string
	badgeTheme?: 'green' | 'red' | 'gray' | 'amber'  | 'blue' | 'violet'
	removeSpacing?: boolean
	loading?: boolean
}>()

const { isMobile } = useScreenSize()
const { openSidebar } = useSidebar()
</script>
