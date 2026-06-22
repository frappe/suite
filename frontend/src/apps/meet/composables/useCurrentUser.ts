import { type ComputedRef, computed, type Ref, ref } from "vue";
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
	currentUser: Ref<User>;
	userInitials: ComputedRef<string>;
	userAvatar: ComputedRef<string>;
	isCreator: Ref<boolean>;
	setCurrentUser: (user: User) => void;
	resetCurrentUser: () => void;
}

let instance: CurrentUser | null = null;

export function useCurrentUser(): CurrentUser {
	if (instance) return instance;

	const currentUser = ref<User>({});
	const isCreator = ref(false);

	const userInitials = computed(() => {
		const name =
			currentUser.value?.full_name || currentUser.value?.name || "You";
		return getInitials(name);
	});

	const userAvatar = computed(() => {
		return currentUser.value?.avatar || "";
	});

	const setCurrentUser = (user: User) => {
		currentUser.value = user;
	};

	const resetCurrentUser = () => {
		currentUser.value = {};
		isCreator.value = false;
	};

	instance = {
		currentUser,
		userInitials,
		userAvatar,
		isCreator,
		setCurrentUser,
		resetCurrentUser,
	};

	return instance;
}
