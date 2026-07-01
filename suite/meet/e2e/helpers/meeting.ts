import type { APIRequestContext } from "@playwright/test";

type MeetingType = "open" | "restricted";

interface FrappeMethodResponse<T> {
	message?: T;
	exc?: string;
}

export async function createMeetingViaApi(
	request: APIRequestContext,
	meetingType: MeetingType = "open",
): Promise<string> {
	const response = await request.post("/api/method/suite.meet.api.meeting.create", {
		data: {
			meeting_type: meetingType,
		},
	});

	if (!response.ok()) {
		const responseBody = await response.text();
		throw new Error(
			`Meeting creation failed with status ${response.status()}: ${responseBody}`,
		);
	}

	const data = (await response.json()) as FrappeMethodResponse<string>;
	const meetingId = data.message;

	if (!meetingId) {
		throw new Error("Meeting creation did not return a meeting id");
	}

	return meetingId;
}

export async function clearMeetingCreateRateLimit(
	request: APIRequestContext,
): Promise<void> {
	await request.post(
		"/api/method/suite.meet.api.test_helpers.clear_create_rate_limit",
		{ data: {} },
	);
}

export type { MeetingType };
