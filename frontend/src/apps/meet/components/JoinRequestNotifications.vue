<template>
	<Teleport to="body">
		<div v-if="joinRequests.length > 0" class="pointer-events-none fixed bottom-4 right-4 z-50 space-y-2">
			<TransitionGroup name="notification" tag="div" class="relative space-y-2">
				<div
					v-for="request in joinRequests"
					:key="request.user_id"
					:data-testid="`join-request-${request.user_id}`"
					class="pointer-events-auto min-w-80 max-w-96 rounded-lg border border-outline-gray-2 bg-surface-gray-1 p-4 shadow-lg"
				>
					<div class="flex items-start justify-between mb-4">
						<div class="flex items-center space-x-3 flex-1 min-w-0">
							<Avatar
								size="2xl"
								:image="request.user_image"
								:label="request.user_name || request.user_id"
							/>

							<div class="flex-1 min-w-0">
								<p class="text-sm text-ink-gray-7">
									<span class="font-semibold text-ink-gray-9">
										{{ request.user_name || request.user_id }}
									</span>
									wants to join the meeting
								</p>
							</div>
						</div>

						<Button
							variant="ghost"
							theme="gray"
							size="sm"
							tooltip="Dismiss request"
							@click="forceHide(request.user_id)"
							class="-mr-1 -mt-1 ml-4"
						>
							<template #icon>
								<lucide-x class="w-4 h-4" />
							</template>
						</Button>
					</div>

					<div class="flex space-x-2">
						<Button
							size="sm"
							@click="$emit('approve-user', request.user_id)"
							class="flex-1"
						>
							<template #prefix>
								<lucide-check class="w-3 h-3 mr-1" />
							</template>
							Admit
						</Button>
						<Button
							size="sm"
							@click="$emit('reject-user', request.user_id)"
							class="flex-1"
						>
							<template #prefix>
								<lucide-x class="w-3 h-3 mr-1" />
							</template>
							Deny
						</Button>
					</div>
				</div>
			</TransitionGroup>
		</div>
	</Teleport>
</template>

<script setup lang="ts">
import { Avatar, Button } from "frappe-ui";
import { computed, ref, watch } from "vue";

interface WaitingUser {
	user_id: string;
	user_name?: string;
	user_image?: string;
}

const props = defineProps<{
	waitingUsers?: WaitingUser[] | { value: WaitingUser[] };
	maxVisible?: number;
}>();

const emit = defineEmits<{
	"approve-user": [userId: string];
	"reject-user": [userId: string];
	"view-all-requests": [];
}>();

const dismissedRequests = ref([]);

const resolvedWaitingUsers = computed<WaitingUser[]>(() => {
	const users = props.waitingUsers;
	if (!users) return [];
	if (Array.isArray(users)) return users;
	return users.value || [];
});

const joinRequests = computed(() => {
	return resolvedWaitingUsers.value
		.filter((user) => !dismissedRequests.value.includes(user.user_id))
		.slice(-props.maxVisible)
		.reverse();
});

const forceHide = (userId) => {
	if (!dismissedRequests.value.includes(userId)) {
		dismissedRequests.value.push(userId);
	}
};

defineExpose({ forceHide });

const previousWaitingUsers = ref([]);
watch(
	() => resolvedWaitingUsers.value,
	(newUsersArray, oldUsersArray) => {
		if (oldUsersArray && newUsersArray.length < oldUsersArray.length) {
			// Some users were removed, clear dismissed list
			const currentUserIds = new Set(newUsersArray.map((u) => u.user_id));
			dismissedRequests.value = dismissedRequests.value.filter((id) =>
				currentUserIds.has(id),
			);
		}
		previousWaitingUsers.value = [...newUsersArray];
	},
	{ immediate: true },
);
</script>

<style scoped>
.notification-enter-active,
.notification-leave-active {
	transition: all 0.4s ease;
}

.notification-leave-active {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	z-index: 10;
	width: 100%;
}

.notification-enter-from,
.notification-leave-to {
	opacity: 0;
	transform: translateX(100%) scale(0.95);
}

.notification-move {
	transition: transform 0.4s ease;
}
</style>
