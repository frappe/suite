import { expect, test } from "../../fixtures/test";
import { discardNode, notifications, ROLE } from "../../helpers/drive";
import {
	createWriterDocument,
	openWriterDocument,
	shareWriterDocument,
	uniqueWriterTitle,
} from "../../helpers/writer";

test("sharing a document notifies the recipient", async ({ owner, collaborator, run }) => {
	const title = uniqueWriterTitle(run.run_id, "notify");
	const file = await createWriterDocument(owner.page.request, title);

	await shareWriterDocument(owner.page.request, file.name, {
		user: collaborator.user.user,
		read: true,
	});

	// The recipient gets an unread pointer at the share, naming the role it gave.
	const shareNotifications = async () =>
		(await notifications(collaborator.page.request).catch(() => [])).filter(
			(row) => row.activity.node === file.name && row.activity.action === "share_add",
		);
	await expect.poll(shareNotifications).toHaveLength(1);
	const [notification] = await shareNotifications();
	expect(notification.read).toBe(0);
	expect(notification.activity.actor).toBe(owner.user.user);
	expect((notification.activity.detail as { new_role?: number }).new_role).toBe(ROLE.READ);
	// Timestamps are RFC 3339 UTC.
	expect(notification.creation).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);

	// The pointer leads somewhere the recipient can open.
	await openWriterDocument(collaborator.page, file.name);

	await discardNode(owner.page.request, file.name);
});
