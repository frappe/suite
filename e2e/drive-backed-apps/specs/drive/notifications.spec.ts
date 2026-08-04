import { expect, test } from "../../fixtures/test";
import { createWriterDocument, shareWriterDocument, uniqueWriterTitle } from "../../helpers/writer";
import { frappeData } from "../../../shared/frappe";

interface DriveNotification {
	notif_doctype_name: string;
	type: string;
	message: string;
	read: number;
}

test("sharing a document notifies the recipient", async ({
	owner,
	collaborator,
	run,
}) => {
	const title = uniqueWriterTitle(run.run_id, "notify");
	const file = await createWriterDocument(owner.page.request, title);

	await shareWriterDocument(owner.page.request, file.name, {
		user: collaborator.user.user,
		read: true,
	});

	// The recipient gets a "Share" notification pointing at the shared file.
	await expect
		.poll(async () => {
			const response = await collaborator.page.request.get(
				"/api/method/suite.drive.api.notifications.get_notifications",
			);
			if (!response.ok()) return [];
			const rows = await frappeData<DriveNotification[]>(response).catch(() => []);
			return rows
				.filter((row) => row.notif_doctype_name === file.name && row.type === "Share")
				.map((row) => row.message);
		})
		.toEqual([expect.stringContaining(title)]);

	await collaborator.page.goto(`/writer/w/${file.name}`);

	// Opening the shared document directly also consumes its notification.
	await expect
		.poll(async () => {
			const response = await collaborator.page.request.get(
				"/api/method/suite.drive.api.notifications.get_notifications",
			);
			if (!response.ok()) return undefined;
			const rows = await frappeData<DriveNotification[]>(response).catch(() => []);
			return rows.find(
				(row) => row.notif_doctype_name === file.name && row.type === "Share",
			)?.read;
		})
		.toBe(1);
});
