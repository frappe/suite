<template>
	<div class="flex h-screen w-full flex-col items-center justify-center gap-2 bg-surface-base">
		<div class="text-3xl-semibold">Access Denied</div>
		<div class="text-base text-ink-gray-7">You do not have permission to access this page.</div>
		<router-link to="/">
			<Button :variant="'solid'" size="md" label="Go back to Home" class="my-6" />
		</router-link>
	</div>
</template>

<script setup>
import { Button } from 'frappe-ui'
</script>
