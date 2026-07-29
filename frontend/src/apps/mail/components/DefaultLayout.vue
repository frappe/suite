<template>
	<div
		v-if="userResource?.data?.name"
		class="relative flex h-dvh flex-col pt-[env(safe-area-inset-top)]"
	>
		<div class="min-h-0 flex-1">
			<div class="isolate flex h-full text-base">
				<AppSidebar v-if="isMobile" />
				<div
					v-else
					class="relative block min-h-0 flex-shrink-0 overflow-hidden hover:overflow-auto"
				>
					<AppSidebar />
				</div>
				<div id="scrollContainer" class="w-full overflow-auto max-sm:flex max-sm:flex-col max-sm:overflow-hidden">
					<slot />
				</div>
			</div>
		</div>
		<MobileTabBar v-if="isMobile" />
	</div>
</template>
<script setup lang="ts">
import { useScreenSize } from '@/apps/mail/utils/composables'
import { userStore } from '@/apps/mail/stores/user'
import AppSidebar from '@/apps/mail/components/AppSidebar.vue'
import MobileTabBar from '@/apps/mail/components/mobile/MobileTabBar.vue'

const { userResource } = userStore()

const { isMobile } = useScreenSize()
</script>
