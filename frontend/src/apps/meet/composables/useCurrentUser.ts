import { type ComputedRef, computed, ref } from "vue";
import { session } from "@/boot/session";
import { getInitials } from "../utils/text";

export interface User {
	user_id?: string;
	userId?: string;
	name?: string;
	full_name?: string;
	avatar?: string | null;
	is_guest?: boolean;
	roles?: string[];
}

export interface CurrentUser {
	currentUser: ComputedRef<User>;
	userInitials: ComputedRef<string>;
	userAvatar: ComputedRef<string>;
	setCurrentUser: (user: User) => void;
	resetCurrentUser: () => void;
}

let instance: CurrentUser | null = null;

export function useCurrentUser(): CurrentUser {
	if (instance) return instance;

	const guestOverride = ref<User | null>(null);

	const currentUser = computed<User>(() => {
		const { sessionUser, ...rest } = session.user;
		return guestOverride.value || { ...rest, user_id: sessionUser };
	});

	const userInitials = computed(() => {
		const name =
			currentUser.value?.full_name || currentUser.value?.name || "You";
		return getInitials(name);
	});

	const userAvatar = computed(() => {
		return currentUser.value?.avatar || "";
	});

	const setCurrentUser = (user: User) => {
		guestOverride.value = user;
	};

	const resetCurrentUser = () => {
		guestOverride.value = null;
	};

	instance = {
		currentUser,
		userInitials,
		userAvatar,
		setCurrentUser,
		resetCurrentUser,
	};

	return instance;
}
