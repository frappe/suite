<template>
	<!-- The phone's app switcher: the desktop sidebar's Apps menu as a sheet,
	     reached from the Apps tab in mail's and the calendar's bars. Same rows
	     and metrics as their folder and view sheets — which app you are in is
	     one more answer to "which list am I looking at". -->
	<BottomSheet v-model:open="open" :title="__('Apps')">
		<!-- BottomSheet provides the scroll container; this div only pads the content,
		     including the home-indicator safe area. -->
		<div class="px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
			<button
				v-for="app in apps"
				:key="app.name"
				:class="sheetRowClass(app.name === currentApp)"
				@click="select(app)"
			>
				<!-- The marks sit at 28px, above the desktop menu's 24 and well past the
				     18 the other sheets' glyphs get: a brand mark is a filled tile with
				     a glyph inside it, and it is that inner glyph you are reading. The
				     row grows by 4px over the text line to hold it. -->
				<img :src="app.logo" class="size-7 shrink-0 rounded-2" alt="" />
				<span class="flex-1 truncate text-left">{{ app.title }}</span>
			</button>
		</div>
	</BottomSheet>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { BottomSheet } from 'frappe-ui'

import { getPhoneAppSwitcherItems } from '@/apps/registry'
import { sheetRowClass } from '@/components/mobile/mobileClasses'
import { openApp } from '@/composables/useAppSwitcher'

import type { SuiteAppSwitcherItem } from '@/apps/registry'

const props = defineProps<{
	/** The app whose bar mounts the sheet; its row leads and is the selected one. */
	currentApp: string
}>()

const open = defineModel<boolean>('open', { default: false })

const router = useRouter()

// The apps with a phone layout, the one you are in leading, selected, as the current
// folder or view does in the other sheets. The rest come in as each gets a layout.
const apps = computed(() => getPhoneAppSwitcherItems(props.currentApp))

// The sheet closes on a pick, as the folder and view sheets do; the app you are
// already in does nothing but close it.
const select = (app: SuiteAppSwitcherItem) => {
	open.value = false
	if (app.name === props.currentApp) return
	openApp(router, app)
}

</script>
