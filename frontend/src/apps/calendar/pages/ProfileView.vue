<template>
	<!-- The settings that used to be reachable only through the desktop dialog are
	     this page's contents. -->
	<MobileProfilePage
		:groups
		:find-tab="findTab"
		:accounts
		:account-id="store.accountId"
		:logout
		@switch-account="switchAccount"
	/>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useSessionStore } from '@/boot/session'
import { userStore } from '@/apps/calendar/stores/user'
import { useSettingsTabs } from '@/apps/calendar/composables/useSettingsTabs'
import MobileProfilePage from '@/components/MobileProfilePage.vue'

const route = useRoute()
const router = useRouter()
const store = userStore()
const { logout } = useSessionStore()

// Profile leaves the list — the identity card above it opens that tab instead.
const { groups, findTab } = useSettingsTabs(['profile'])

const accounts = computed(() => store.userResource?.data?.accounts ?? [])

const switchAccount = (accountId: string) => {
	if (accountId === store.accountId) return
	router.push({ name: route.name!, params: { ...route.params, accountId }, query: route.query })
}
</script>
