<template>
	<Transition
		enter-active-class="transition-all duration-300 ease-out"
		enter-from-class="opacity-0 transform translate-y-4"
		enter-to-class="opacity-100 transform translate-y-0"
		leave-active-class="transition-all duration-300 ease-in"
		leave-from-class="opacity-100 transform translate-y-0"
		leave-to-class="opacity-0 transform translate-y-4"
	>
		<div
			v-if="visible"
			class="bg-gray-800 text-white rounded-lg shadow-lg max-w-sm w-full cursor-pointer hover:bg-gray-750 transition-colors"
			@click="handleClick"
			role="button"
			tabindex="0"
			@keydown.enter="handleClick"
		>
			<div class="p-4">
				<div class="flex items-start gap-3">
					<div class="flex-shrink-0 mt-0.5">
						<lucide-chart-column v-if="notification.type === 'poll'" class="w-5 h-5 text-blue-400" />
						<lucide-message-square-dot v-else class="w-5 h-5 text-blue-400" />
					</div>

					<div class="flex-1 min-w-0">
						<p class="text-sm-medium text-white mb-1 flex items-center gap-2">
							<span class="truncate">{{ notification.fromName || notification.fromUser }}</span>
							<span v-if="notification.type === 'poll'" class="rounded bg-blue-500/20 px-1.5 py-0.5 text-xs text-blue-200">Poll</span>
						</p>
						<p class="text-sm text-gray-300 break-words line-clamp-2">
							{{ notification.message }}
						</p>
					</div>
				</div>
			</div>
		</div>
	</Transition>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

interface Notification {
	message: string;
	fromUser: string;
	fromName?: string;
	timestamp?: string;
	type?: "chat" | "poll";
}

const props = defineProps<{
	notification: Notification;
	autoDismissDelay?: number;
}>();

const emit = defineEmits<{
	close: [];
	click: [notification: Notification];
}>();

const visible = ref(true);
let dismissTimer = null;

const handleClick = () => {
	emit("click", props.notification);
	emit("close");
};

const startAutoDismiss = () => {
	if (props.autoDismissDelay <= 0) return;

	dismissTimer = setTimeout(() => {
		emit("close");
	}, props.autoDismissDelay);
};

const clearTimers = () => {
	if (dismissTimer) {
		clearTimeout(dismissTimer);
		dismissTimer = null;
	}
};

onMounted(() => {
	startAutoDismiss();
});

onUnmounted(() => {
	clearTimers();
});

defineExpose({
	close: () => {
		clearTimers();
		emit("close");
	},
});
</script>

<style scoped>
.line-clamp-2 {
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
</style>
