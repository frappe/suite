import { toast, useCall } from "frappe-ui";
import { computed } from "vue";
import { useRouter } from "vue-router";

import { useConnectionState } from "./useConnectionState";
import { submit } from "../utils/request";

type MeetingType = "open" | "restricted";

export const useStartMeeting = () => {
	const router = useRouter();
	const connectionState = useConnectionState();
	const createMeeting = useCall<string, { meeting_type: MeetingType }>({
		url: "/api/v2/method/suite.meet.api.meeting.create",
		method: "POST",
		immediate: false,
		onSuccess: (meetingCode) => {
			router.push({
				name: "meet-meeting",
				params: { meetingId: meetingCode },
			});
			connectionState.justCreated = true;
		},
		onError: (error: unknown) => {
			console.error("Error creating meeting:", error);
			toast.error("Failed to create meeting. Please try again.");
		},
	});

	const startMeeting = (meetingType: MeetingType) => {
		const toastId = toast.loading("Creating meeting...");
		return submit(createMeeting, { meeting_type: meetingType })
			.then((meetingCode) => {
				toast.dismiss(toastId);
				toast.success("Meeting created successfully!", {
					duration: 8000,
					action: {
						label: "Copy link",
						onClick: () => {
							const path = router.resolve({
								name: "meet-meeting",
								params: { meetingId: meetingCode },
							}).href;
							navigator.clipboard.writeText(new URL(path, window.location.origin).href);
						},
					},
				});
			})
			.catch(() => toast.dismiss(toastId));
	};

	return {
		isStartingMeeting: computed(() => createMeeting.loading),
		startMeeting,
	};
};
