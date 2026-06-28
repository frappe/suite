<template>
	<DashboardLayout
		:breadcrumbs="[{ label: __('Members') }]"
		:button-label="__('Add Member')"
		:button-action="() => (showAddMember = true)"
		:remove-spacing="true"
	>
		<Tabs
			v-model="tabIndex"
			:tabs="[
				{ label: __('Users'), icon: Users },
				{ label: __('Invites'), icon: Mails },
			]"
		>
			<template #tab-panel>
				<div class="flex flex-1 flex-col space-y-5 overflow-y-auto p-5">
					<UsersView v-if="tabIndex === 0" ref="usersView" />
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
// previous tabIndex<->route watch pair triggered.
const tabIndex = computed({
	get: () => (route.name === 'mail-invites' ? 1 : 0),
	set: (val) => {
		const name = val ? 'mail-invites' : 'mail-members'
		if (route.name !== name) router.push({ name })
	},
})

// add/invite members

const showAddMember = ref(false)

const usersView = useTemplateRef('usersView')
const invitesView = useTemplateRef('invitesView')

const reload = () => {
	if (tabIndex.value === 0) usersView?.value?.reloadMembers()
	else invitesView?.value?.reloadInvites()
}
</script>
