<template>
	<Badge
		v-for="filter in filters"
		:key="filter.key"
		:label="getLabel(filter)"
		theme="gray"
		variant="subtle"
		class="shrink-0"
	>
		<template #suffix>
			<Button
				variant="ghost"
				icon="lucide-x"
				size="xs"
				:aria-label="`Remove ${getLabel(filter)} filter`"
				class="-mr-0.5 !size-3.5 !p-0 hover:!bg-surface-gray-3"
				@mousedown.prevent
				@click.stop="emit('remove', filter.key)"
			/>
		</template>
	</Badge>
</template>

<script setup lang="ts">
import { Badge, Button } from 'frappe-ui'
import type { MailSearchFilterBadge } from './types'

defineProps<{ filters: MailSearchFilterBadge[] }>()
const emit = defineEmits<{ remove: [key: string] }>()

const OPERATORS: Record<string, string> = {
	inMailbox: 'in',
	from: 'from',
	to: 'to',
	cc: 'cc',
	bcc: 'bcc',
	subject: 'subject',
	after: 'after',
	before: 'before',
}

function getLabel(filter: MailSearchFilterBadge) {
	if (filter.key === 'hasAttachment') return filter.displayValue
	if (filter.key === 'isRead') return `is:${filter.value === 'true' ? 'read' : 'unread'}`
	return `${OPERATORS[filter.key] ?? filter.key}:${filter.displayValue}`
}
</script>
