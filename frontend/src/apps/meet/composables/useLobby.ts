import { toast } from "frappe-ui";
import { getErrorMessage } from "../utils/error";
import { submit, type Call } from "../utils/request";
import type { LobbyStore } from "./useLobbyStore";

interface LobbyAPI {
	approveUser: (userId: string) => Promise<void>;
	approveAllUsers: () => Promise<void>;
	rejectUser: (userId: string) => Promise<void>;
}

interface LobbyMeetingDoc {
	approveJoinRequest: Call<unknown, { user_id: string }>;
	approveAllJoinRequests: Call<unknown>;
	rejectJoinRequest: Call<unknown, { user_id: string }>;
}

export function useLobby(deps: {
	lobbyStore: LobbyStore;
	meetingDoc: LobbyMeetingDoc;
}): LobbyAPI {
	const { lobbyStore, meetingDoc } = deps;

	const approveUser = async (userId: string) => {
		try {
			await submit(meetingDoc.approveJoinRequest, { user_id: userId });

			lobbyStore.removeLobbyUser(userId);
		} catch (error) {
			console.error("Failed to approve user:", error);
			toast.error(getErrorMessage(error));
		}
	};

	const approveAllUsers = async () => {
		try {
			await submit(meetingDoc.approveAllJoinRequests);

			lobbyStore.setLobbyUsers([]);
		} catch (error) {
			console.error("Failed to approve all users:", error);
			toast.error(getErrorMessage(error));
		}
	};

	const rejectUser = async (userId: string) => {
		try {
			await submit(meetingDoc.rejectJoinRequest, { user_id: userId });

			lobbyStore.removeLobbyUser(userId);
		} catch (error) {
			console.error("Failed to reject user:", error);
			toast.error(getErrorMessage(error));
		}
	};

	return {
		approveUser,
		approveAllUsers,
		rejectUser,
	};
}
