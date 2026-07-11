import type { APIRequestContext } from "@playwright/test";

type MeetingType = "open" | "restricted";

interface FrappeMethodResponse<T> {
	message?: T;
	exc?: string;
}

const CREATE_ATTEMPTS = 5;

function isRetryableCreateFailure(status: number, body: string): boolean {
	if (status === 429) {
		return true;
	}
	if (status !== 500 && status !== 503) {
		return false;
	}
	return (
		body.includes("QueryDeadlockError") ||
		body.includes("Deadlock found") ||
		body.includes("Lock wait timeout") ||
		body.includes("try restarting transaction")
	);
}

export async function createMeetingViaApi(
	request: APIRequestContext,
	meetingType: MeetingType = "open",
): Promise<string> {
	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= CREATE_ATTEMPTS; attempt += 1) {
		const response = await request.post(
			"/api/method/suite.meet.api.meeting.create",
			{
				data: {
					meeting_type: meetingType,
				},
			},
		);

		if (response.ok()) {
			const data = (await response.json()) as FrappeMethodResponse<string>;
			const meetingId = data.message;
			if (!meetingId) {
				throw new Error("Meeting creation did not return a meeting id");
			}
			return meetingId;
		}

		const responseBody = await response.text();
		lastError = new Error(
			`Meeting creation failed with status ${response.status()}: ${responseBody}`,
		);

		if (
			attempt < CREATE_ATTEMPTS &&
			isRetryableCreateFailure(response.status(), responseBody)
		) {
			// Back off under concurrent creates (MariaDB deadlocks on meeting insert/join).
			await new Promise((resolve) =>
				setTimeout(resolve, 150 * attempt + Math.floor(Math.random() * 100)),
			);
			await clearMeetingCreateRateLimit(request).catch(() => {});
			continue;
		}

		throw lastError;
	}

	throw lastError ?? new Error("Meeting creation failed");
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
