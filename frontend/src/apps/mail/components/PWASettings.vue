<template>
	<div class="bg-surface-base fixed inset-0 z-20 flex flex-col pt-[env(safe-area-inset-top)]">
		<!-- Root bar — same compact-header recipe as ThreadHeader: -ml-2 cancels
		     the ghost button's padding so the chevron glyph lands on the body's
		     px-3 axis. -->
		<div class="bg-surface-base flex h-14 shrink-0 items-center border-b px-3">
			<Button variant="ghost" class="-ml-2 mr-2 !h-8 !w-8 shrink-0" @click="emit('close')">
				<template #icon>
					<ChevronLeft class="icon !h-[18px] !w-[18px]" />
				</template>
			</Button>

			<h2 class="min-w-0 flex-1 truncate text-xl !font-semibold tracking-[-0.01em]">
				{{ __('Settings') }}
			</h2>
		</div>

		<!-- Root: grouped section list mirroring the desktop dialog's groups. The
		     Profile tab reaches the same rows through ProfileView (see useSettingsTabs);
		     this page stays for the entry points that aren't the tab bar — the sidebar,
		     and the Block List / Screener links inside a thread. -->
		<div
			class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3"
		>
			<MobileSettingsCard v-for="group in groups" :key="group.label" :label="group.label">
				<MobileSettingsRow
					v-for="tab in group.items"
					:key="tab.value"
					:icon="tab.icon"
					:label="tab.label"
					@click="activeTab = tab"
				/>
			</MobileSettingsCard>
		</div>

		<MobileSettingsSubPage :tab="activeTab" safe-area-top @close="activeTab = null" />
	</div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ChevronLeft } from 'lucide-vue-next'
import { Button } from 'frappe-ui'

import { useSettingsTabs, type SettingsTab } from '@/apps/mail/composables/useSettingsTabs'
import MobileSettingsCard from '@/apps/mail/components/mobile/MobileSettingsCard.vue'
import MobileSettingsRow from '@/apps/mail/components/mobile/MobileSettingsRow.vue'
import MobileSettingsSubPage from '@/apps/mail/components/mobile/MobileSettingsSubPage.vue'

const emit = defineEmits(['close'])

const { groups } = useSettingsTabs()

const activeTab = ref<SettingsTab | null>(null)
</script>
