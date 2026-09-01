import type { APIRequestContext } from "@playwright/test";
import type { Credentials } from "../../shared/auth";

export const meetHost: Credentials = {
	email: "meet-e2e-host@example.com",
	password: "MeetE2EHost!2026",
};
export const meetHostName = "Meet E2E Host";

export async function provisionMeetHost(
	request: APIRequestContext,
): Promise<void> {
	const response = await request.post(
		"/api/v2/method/suite.meet.api.test_helpers.provision_host",
	);
	if (!response.ok()) {
		throw new Error(
			`Meet host provisioning failed with status ${response.status()}: ${await response.text()}`,
		);
	}
	const { data: credentials } = (await response.json()) as {
		data?: Credentials;
	};
	if (
		!credentials ||
		credentials.email !== meetHost.email ||
		credentials.password !== meetHost.password
	) {
		throw new Error("Meet host provisioning returned unexpected credentials");
	}
}
