<template>
	<DashboardLayout
		:breadcrumbs="[{ label: __('Members') }]"
		:button-label="__('Add Member')"
		:button-action="() => (showAddMember = true)"
		:remove-spacing="true"
	>
		<!-- iconLeft, not icon: `icon` makes an icon-only trigger and drops the label. -->
		<Tabs
			v-model="tab"
			class="[&>[data-slot=tab-list]]:px-3 [&>[data-slot=tab-list]]:py-1.5 sm:[&>[data-slot=tab-list]]:px-5"
			:tabs="[
				{ value: 'users', label: __('Users'), iconLeft: Users },
				{ value: 'invites', label: __('Invites'), iconLeft: Mails },
			]"
		>
			<template #tab-panel="{ tab: panel }">
				<!-- Match DashboardLayout's body spacing so the tabbed page doesn't sit
				     at a different offset than its sibling pages. -->
				<div class="flex flex-1 flex-col space-y-5 overflow-y-auto px-3 py-5 sm:px-5">
					<UsersView v-if="panel.value === 'users'" ref="usersView" />
					<InvitesView v-else ref="invitesView" />
				</div>
			</template>
		</Tabs>
	</DashboardLayout>
	<AddMemberModal v-model="showAddMember" @reload="reload" />
</template>
<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Mails, Users } from 'lucide-vue-next'
import { Tabs, usePageMeta } from 'frappe-ui'

import InvitesView from '@/apps/mail/pages/dashboard/InvitesView.vue'
import UsersView from '@/apps/mail/pages/dashboard/UsersView.vue'
import DashboardLayout from '@/apps/mail/components/DashboardLayout.vue'
import AddMemberModal from '@/apps/mail/components/Modals/AddMemberModal.vue'

usePageMeta(() => ({ title: __('Members') }))

const route = useRoute()
const router = useRouter()

// Derive the active tab from the route (correct from the first render, so frappe-ui's Tabs has a
// valid model immediately and its reka-ui indicator doesn't observe an undefined element). The
// setter only navigates on an actual tab change, avoiding the redundant same-route push that the
// previous tab<->route watch pair triggered.
const tab = computed({
	get: () => (route.name === 'mail-invites' ? 'invites' : 'users'),
	set: (val) => {
		const name = val === 'invites' ? 'mail-invites' : 'mail-members'
		if (route.name !== name) router.push({ name })
	},
})

// add/invite members

const showAddMember = ref(false)

const usersView = useTemplateRef('usersView')
const invitesView = useTemplateRef('invitesView')

const reload = () => {
	if (tab.value === 'users') usersView?.value?.reloadMembers()
	else invitesView?.value?.reloadInvites()
}
</script>
