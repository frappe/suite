<template>
	<div class="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
		<div class="bg-surface-base rounded-7 shadow-2xl p-8 max-w-md mx-4 text-center space-y-4">
			<div class="w-12 h-12 mx-auto rounded-full flex items-center justify-center mb-4 bg-gradient-to-br from-amber-100 to-yellow-100">
				<lucide-clock class="w-6 h-6 text-amber-600 animate-pulse" />
			</div>

			<h2 class="text-2xl-semibold text-ink-gray-9">
				Waiting to be admitted
			</h2>

			<p class="text-ink-gray-6 text-base">
				The meeting host will let you in soon.
			</p>

			<div class="flex flex-col gap-3">
				<Button
					variant="outline"
					@click="$emit('leave')"
					class="w-full"
				>
					<template #prefix>
						<lucide-x class="w-4 h-4" />
					</template>
					Leave
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
