import { defineStore } from "pinia";

interface LobbyUser {
	userId: string;
	name: string;
	avatar?: string;
	requested_at?: string;
	isGuest?: boolean;
}

export const useLobbyStore = defineStore("meet-lobby", {
	state: () => ({
		isWaitingForApproval: false,
		isJoinRequestRejected: false,
		lobbyUsers: [] as LobbyUser[],
		isInLobby: false,
	}),
	actions: {
		setLobbyUsers(users: LobbyUser[]) {
			this.lobbyUsers = users;
		},
		addLobbyUser(user: LobbyUser) {
			const current = this.lobbyUsers || [];
			if (!current.some((candidate) => candidate.userId === user.userId)) {
				this.lobbyUsers = [...current, user];
			}
		},
		removeLobbyUser(userId: string) {
			this.lobbyUsers = (this.lobbyUsers || []).filter(
				(user) => user.userId !== userId,
			);
		},
	},
});

export type LobbyStore = ReturnType<typeof useLobbyStore>;
