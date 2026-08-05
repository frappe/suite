import type { APIRequestContext } from "@playwright/test";
import type { Credentials } from "../../shared/auth";
import { frappeData } from "../../shared/frappe";

export const meetHost: Credentials = {
	email: "meet-e2e-host@example.com",
	password: "MeetE2EHost!2026",
};

export async function provisionMeetHost(
	request: APIRequestContext,
): Promise<void> {
	const response = await request.post(
		"/api/method/suite.meet.api.test_helpers.provision_host",
	);
	const credentials = await frappeData<Credentials>(response);
	if (
		credentials.email !== meetHost.email ||
		credentials.password !== meetHost.password
	) {
		throw new Error("Meet host provisioning returned unexpected credentials");
	}
}
