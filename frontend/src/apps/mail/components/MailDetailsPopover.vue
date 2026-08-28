<template>
	<Popover>
		<template #trigger>
			<!-- mt-px: the row centers this 14px glyph on a stated 16px (leading-4) line
			     box, but 13px lowercase text's optical center sits ~1px below the box's
			     geometric center — the same arithmetic as the remote-images banner icon. -->
			<!-- click.stop: the thread's header row toggles the mail collapsed, and
			     the trigger sits inside it — without this the click opened the
			     popover and immediately collapsed the row out from under it. reka's
			     as-child merges its own click handler, so the popover still toggles. -->
			<ChevronDown
				class="text-ink-gray-5 hover:bg-surface-gray-2 mt-px h-3.5 w-3.5 cursor-pointer rounded-1"
				@click.stop
			/>
		</template>
		<template #default>
			<MailDetails :mail />
		</template>
	</Popover>
</template>

<script lang="ts" setup>
import { ChevronDown } from 'lucide-vue-next'
import { Popover } from 'frappe-ui'

import MailDetails from '@/apps/mail/components/MailDetails.vue'

import type { Mail } from '@/apps/mail/types'

defineProps<{ mail: Mail }>()
</script>
