import { createDocumentResource } from "frappe-ui";
import { type ComputedRef, computed, type Ref, ref } from "vue";
import { session } from "@/boot/session";

interface MeetingDocument {
	allow_guest?: boolean;
	meeting_type?: string;
	e2ee_enabled?: boolean;
	owner?: string;
	title?: string;
	name?: string;
	host_only_chat?: boolean;
	co_hosts?: { user: string }[];
	banned_users?: { user: string }[];
}

interface DocumentResource {
	doc?: MeetingDocument;
	setValue: {
		submit(params: Record<string, unknown>): Promise<unknown>;
	};
	reload(): Promise<void>;
	updateSettings: {
		submit(params: Record<string, unknown>): Promise<unknown>;
		loading: boolean;
	};
	enableE2ee: {
		submit(params?: Record<string, unknown>): Promise<unknown>;
		loading: boolean;
	};
	get: {
		loading: boolean;
		error: unknown;
		submit(): Promise<void>;
	};
}

interface UseMeetingDocReturn {
	getMeetingDoc: (meetingId: string) => DocumentResource;
	getCurrentMeetingDoc: () => MeetingDocument | null;
	clearMeetingDoc: () => void;
	meetingTitle: ComputedRef<string>;
	meetingOwner: ComputedRef<string>;
	isCurrentUserHost: ComputedRef<boolean>;
	meetingType: ComputedRef<string>;
	allowGuest: ComputedRef<boolean>;
	e2eeEnabled: ComputedRef<boolean>;
	meetingCoHosts: ComputedRef<string[]>;
	isCurrentUserCohost: ComputedRef<boolean>;
}

const meetingDoc: Ref<DocumentResource | null> = ref(null);
const currentMeetingId: Ref<string | null> = ref(null);

export function useMeetingDoc(): UseMeetingDocReturn {
	const getMeetingDoc = (meetingId: string): DocumentResource => {
		if (meetingDoc.value && currentMeetingId.value === meetingId) {
			return meetingDoc.value;
		}

		if (meetingDoc.value && currentMeetingId.value !== meetingId) {
			clearMeetingDoc();
		}

		const docResource = createDocumentResource({
			doctype: "Sae Meeting",
			name: meetingId,
			auto: session.isLoggedIn,
			whitelistedMethods: {
				updateSettings: "update_settings",
				enableE2ee: "enable_e2ee",
			},
		});

		meetingDoc.value = docResource;
		currentMeetingId.value = meetingId;

		return docResource;
	};

	const getCurrentMeetingDoc = (): MeetingDocument | null => {
		return meetingDoc.value?.doc ?? null;
	};

	const clearMeetingDoc = (): void => {
		meetingDoc.value = null;
		currentMeetingId.value = null;
	};

	const meetingTitle = computed((): string => {
		const doc = getCurrentMeetingDoc();
		return doc?.title || doc?.name || currentMeetingId.value || "";
	});

	const meetingOwner = computed((): string => {
		return meetingDoc.value?.doc?.owner || "";
	});

	const isCurrentUserHost = computed((): boolean => {
		const currentUserId = session.user?.sessionUser;
		const ownerId = meetingOwner.value;
		return Boolean(currentUserId && ownerId && currentUserId === ownerId);
	});

	const meetingCoHosts = computed((): string[] => {
		const doc = meetingDoc.value?.doc;
		if (!doc?.co_hosts) return [];
		return doc.co_hosts.map((row: { user: string }) => row.user);
	});

	const isCurrentUserCohost = computed((): boolean => {
		const currentUserId = session.user?.sessionUser;
		const coHosts = meetingCoHosts.value;
		return Boolean(currentUserId && coHosts?.includes(currentUserId));
	});

	const meetingType = computed((): string => {
		return meetingDoc.value?.doc?.meeting_type || "open";
	});

	const allowGuest = computed((): boolean => {
		return Boolean(meetingDoc.value?.doc?.allow_guest);
	});

	const e2eeEnabled = computed((): boolean => {
		return Boolean(meetingDoc.value?.doc?.e2ee_enabled);
	});

	return {
		getMeetingDoc,
		getCurrentMeetingDoc,
		clearMeetingDoc,
		meetingTitle,
		meetingOwner,
		isCurrentUserHost,
		meetingCoHosts,
		isCurrentUserCohost,
		meetingType,
		allowGuest,
		e2eeEnabled,
	};
}
