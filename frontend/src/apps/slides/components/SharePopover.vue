<template>
	<!-- Stage 9 opens Drive's share dialog here. A disabled button fires no
	     hover event, so the tooltip sits on a wrapper. -->
	<Tooltip text="Sharing arrives with the new share dialog">
		<span class="inline-flex" tabindex="0">
			<Button variant="ghost" icon="lucide-share-2" aria-label="Share" disabled />
		</span>
	</Tooltip>
</template>

<script setup>
import { Button, Tooltip } from 'frappe-ui'
</script>
