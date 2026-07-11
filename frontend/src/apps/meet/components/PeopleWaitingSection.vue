<template>
	<div v-if="lobbyUsers.length > 0" class="">
		<div class="px-3 py-2 text-xs-medium text-ink-gray-5 tracking-wide bg-surface-gray-1 flex items-center justify-between">
			<span>Waiting to join</span>
			<Button
				variant="ghost"
				size="sm"
				@click="$emit('approve-all')"
				class="text-xs-medium "
			>
				Admit all
			</Button>
		</div>
		<div
			v-for="lobbyUser in lobbyUsers"
			:key="lobbyUser.userId"
			class="flex min-h-11 items-center justify-between gap-3 px-3 py-1.5 transition-colors hover:bg-surface-gray-2"
			:data-testid="`waiting-user-${lobbyUser.userId}`"
		>
			<div class="flex min-w-0 items-center gap-3">
				<MeetAvatar
					size="lg"
					:image="lobbyUser.avatar"
					:label="lobbyUser.name || lobbyUser.userId || 'Guest'"
				/>
				<div class="flex items-center gap-2">
					<div class="text-sm-medium text-ink-gray-8 truncate max-w-40">
						{{ lobbyUser.name || lobbyUser.userId || 'Guest' }}
					</div>
					<Badge v-if="lobbyUser.isGuest" size="sm">
						Guest
					</Badge>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<Button
					size="sm"
					@click="$emit('approve', lobbyUser.userId)"
					:data-testid="`approve-waiting-user-${lobbyUser.userId}`"
				>
					<lucide-check class="w-4 h-4" />
				</Button>
				<Button
					size="sm"
					@click="$emit('reject', lobbyUser.userId)"
					:data-testid="`reject-waiting-user-${lobbyUser.userId}`"
				>
					<lucide-x class="w-4 h-4" />
				</Button>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { Badge, Button } from "frappe-ui";
import MeetAvatar from "./MeetAvatar.vue";

interface LobbyUser {
	userId: string;
	name?: string;
	avatar?: string;
	isGuest?: boolean;
	joinedAt?: number;
}

interface Props {
	lobbyUsers: LobbyUser[];
}

const props = withDefaults(defineProps<Props>(), {
	lobbyUsers: () => [],
});

defineEmits<{
	approve: [participantId: string];
	reject: [participantId: string];
	"approve-all": [];
}>();
</script>
