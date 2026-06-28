<template>
	<div class="flex h-screen w-full flex-col items-center justify-center gap-2 bg-gray-100">
		<div class="text-4xl-semibold">Access Denied</div>
		<div class="text-base text-gray-700">You do not have permission to access this page.</div>
		<router-link to="/">
			<Button :variant="'solid'" size="md" label="Go back to Home" class="my-6" />
		</router-link>
	</div>
</template>

<script setup>
import { Button } from 'frappe-ui'
</script>
