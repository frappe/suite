<template>
	<!-- The desktop sidebar's Apps menu, as the last tab of an app's phone bar: it opens a
	     sheet of the other apps rather than going anywhere itself. It wears the mark and
	     the name of the app you are in — the tab says which of the suite this is, and the
	     sheet it opens is where the others are. It never reads as selected: it is not a
	     place in the app the way the other tabs are, and the sheet it raises is its own
	     feedback. `open` is a model so a bar can react to the sheet, and is optional. -->
	<button :class="tabClass(false)" @click="open = true">
		<img :src="app.logo" class="size-6 shrink-0 rounded-2" alt="" />
		<span :class="labelClass(false)">{{ __(app.name) }}</span>
	</button>
	<MobileAppsSheet v-model:open="open" :current-app="appId" />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { SUITE_APPS } from '@/apps/registry'
import MobileAppsSheet from '@/components/mobile/MobileAppsSheet.vue'
import { labelClass, tabClass } from '@/components/mobile/mobileClasses'

const props = defineProps<{
	/** The registry id of the app whose bar this tab ends. */
	appId: string
}>()

const open = defineModel<boolean>('open', { default: false })

const app = computed(() => SUITE_APPS.find((app) => app.id === props.appId)!)
</script>
