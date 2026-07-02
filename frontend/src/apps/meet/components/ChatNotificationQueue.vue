<template>
	<div>
		<TransitionGroup
			name="notification"
			tag="div"
			class="fixed bottom-4 z-50 flex flex-col-reverse space-y-reverse space-y-2"
			:class="props.chatOpen ? 'right-80 sm:right-96' : 'right-4'"
		>
			<ChatNotification
				v-for="notification in activeNotifications"
				:key="notification.id"
				:notification="notification"
				:auto-dismiss-delay="autoDismissDelay"
				@close="removeNotification(notification.id)"
				@click="handleNotificationClick"
			/>
		</TransitionGroup>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import ChatNotification from "./ChatNotification.vue";

interface NotificationItem {
	id: string;
	message: string;
	fromUser: string;
	fromName: string;
	timestamp: string;
	type?: "chat" | "poll";
	originalData: Record<string, unknown>;
}

const props = defineProps<{
	autoDismissDelay?: number;
	maxVisible?: number;
	chatOpen?: boolean;
}>();

const emit = defineEmits<{
	"notification-click": [notification: NotificationItem];
}>();

const notifications = ref<NotificationItem[]>([]);
const notificationCounter = ref(0);

const activeNotifications = computed(() => {
	return notifications.value.slice(-props.maxVisible);
});

const addNotification = (messageData) => {
	// Create notification object with unique ID
	const notification = {
		id: `notification-${++notificationCounter.value}-${Date.now()}`,
		message: messageData.message || "",
		fromUser: messageData.fromUser || "unknown",
		fromName: messageData.fromName || messageData.fromUser || "Unknown",
		timestamp: messageData.timestamp || new Date().toISOString(),
		type: messageData.type,
		originalData: messageData,
	};

	notifications.value.push(notification);

	// remove the oldest notifications and keep only maxVisible
	if (notifications.value.length > props.maxVisible) {
		const excessCount = notifications.value.length - props.maxVisible;
		notifications.value.splice(0, excessCount);
	}

	// just a cap to ensure we don't mess up
	if (notifications.value.length > 10) {
		notifications.value = notifications.value.slice(-8);
	}
};

const removeNotification = (notificationId) => {
	const index = notifications.value.findIndex((n) => n.id === notificationId);
	if (index !== -1) {
		notifications.value.splice(index, 1);
	}
};

const handleNotificationClick = (notification) => {
	emit("notification-click", notification);
};

const clearAll = () => {
	notifications.value = [];
};

defineExpose({
	addNotification,
	removeNotification,
	clearAll,
});
</script>

<style scoped>
.notification-enter-active,
.notification-leave-active {
	transition: all 0.3s ease;
}

.notification-enter-from {
	opacity: 0;
	transform: translateY(20px) scale(0.95);
}

.notification-leave-to {
	opacity: 0;
	transform: translateY(20px) scale(0.95);
}

.notification-move {
	transition: transform 0.3s ease;
}
</style>
