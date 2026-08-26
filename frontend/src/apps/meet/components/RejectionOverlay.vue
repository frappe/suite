<template>
	<div class="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
		<div class="bg-surface-base rounded-7 shadow-2xl p-8 max-w-md mx-4 text-center space-y-4">
			<div class="w-12 h-12 mx-auto rounded-full flex items-center justify-center mb-4 bg-gradient-to-br from-red-100 to-red-200">
				<lucide-x-circle class="w-6 h-6 text-red-600" />
			</div>

			<h2 class="text-2xl-semibold text-ink-gray-9">
				Entry denied
			</h2>

			<p class="text-ink-gray-6 text-base">
				The meeting host has denied your request to join this meeting.
			</p>

			<div class="flex flex-col gap-3">
				<Button
					variant="outline"
					@click="$emit('leave')"
					class="w-full"
				>
					<template #prefix>
						<lucide-home class="w-4 h-4" />
					</template>
					Go home
				</Button>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { Button } from "frappe-ui";

defineEmits<{
	leave: [];
}>();
</script>
