<template>
	<div
		role="alert"
		class="flex h-dvh flex-col items-center justify-center gap-4 bg-surface-base p-8 text-center"
	>
		<CloudOff class="h-10 w-10 text-ink-gray-5" />
		<div class="flex flex-col gap-1.5">
			<h1 class="text-xl font-semibold text-ink-gray-9">{{ __('Mail server unavailable') }}</h1>
			<p class="text-base text-ink-gray-6">
				{{ __('The mail server is temporarily unavailable. Please try again in a few minutes.') }}
			</p>
		</div>
		<Button variant="solid" @click="reloadPage">{{ __('Retry') }}</Button>
	</div>
</template>

<script setup lang="ts">
import { CloudOff } from 'lucide-vue-next'
import { Button } from 'frappe-ui'

// A reload re-runs the boot fetches from scratch — if the server is back, the app
// comes up normally; if not, the failing fetches land right back on this view.
const reloadPage = () => window.location.reload()
</script>
