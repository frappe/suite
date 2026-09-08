import { defineStore } from "pinia";
import { ref } from "vue";

interface LobbyUser {
	userId: string;
	name: string;
	avatar?: string;
	requested_at?: string;
	isGuest?: boolean;
}

export interface LobbyStore {
	isWaitingForApproval: boolean;
	isJoinRequestRejected: boolean;
	lobbyUsers: LobbyUser[];
	lobbyParticipantCount: number;
	isInLobby: boolean;
	waitingUsers: unknown[];
	loadingUsers: unknown[];
	setLobbyUsers: (users: LobbyUser[]) => void;
	addLobbyUser: (user: LobbyUser) => void;
	removeLobbyUser: (userId: string) => void;
	$reset: () => void;
}

export const useLobbyStore = defineStore("meet-lobby", () => {
	const isWaitingForApproval = ref(false);
	const isJoinRequestRejected = ref(false);
	const lobbyUsers = ref<LobbyUser[]>([]);
	const lobbyParticipantCount = ref(0);
	const isInLobby = ref(false);
	const waitingUsers = ref<unknown[]>([]);
	const loadingUsers = ref<unknown[]>([]);

	function setLobbyUsers(users: LobbyUser[]) {
		lobbyUsers.value = users;
	}

	function addLobbyUser(user: LobbyUser) {
		const current = lobbyUsers.value || [];
		const exists = current.some((u) => u.userId === user.userId);
		if (!exists) {
			lobbyUsers.value = [...current, user];
		}
	}

	function removeLobbyUser(userId: string) {
		lobbyUsers.value = (lobbyUsers.value || []).filter(
			(u) => u.userId !== userId,
		);
	}

	function $reset() {
		isWaitingForApproval.value = false;
		isJoinRequestRejected.value = false;
		lobbyUsers.value = [];
		lobbyParticipantCount.value = 0;
		isInLobby.value = false;
		waitingUsers.value = [];
		loadingUsers.value = [];
	}

	return {
		isWaitingForApproval,
		isJoinRequestRejected,
		lobbyUsers,
		lobbyParticipantCount,
		isInLobby,
		waitingUsers,
		loadingUsers,
		setLobbyUsers,
		addLobbyUser,
		removeLobbyUser,
		$reset,
	};
});
