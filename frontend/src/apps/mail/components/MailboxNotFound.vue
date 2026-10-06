<template>
	<!-- In place of a mailbox the account has not got: a folder since renamed or deleted, a role
	     its server has no mailbox for, or a mistyped address. -->
	<div class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center max-sm:flex-1">
		<p class="text-ink-gray-5">{{ __('There are no messages in this mailbox.') }}</p>
		<Button
			v-if="store.mailboxIds.inbox"
			:label="__('Go to Inbox')"
			@click="router.push(mailboxRoute(store.mailboxIds.inbox))"
		/>
	</div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Button } from 'frappe-ui'

import { mailboxRoute } from '@/apps/mail/utils/locations'
import { userStore } from '@/apps/mail/stores/user'

const router = useRouter()
const store = userStore()
</script>
