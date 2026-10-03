import { expect, test } from "../../fixtures/test";
import {
	canReadNode,
	createFolder,
	discardNode,
	expectChildAbsent,
	purgeNode,
	restoreNode,
	trashNode,
	uniqueName,
	waitForChild,
} from "../../helpers/drive";

test("permanently deleting a trashed node removes it irrecoverably", async ({ owner, run }) => {
	const request = owner.page.request;
	const folder = await createFolder(request, uniqueName(run.run_id, "perm-del"));

	await trashNode(request, folder.name);
	expect(await purgeNode(request, folder.name)).toBe(1);

	// Gone for good: even its owner can no longer resolve it.
	expect(await canReadNode(request, folder.name)).toBe(false);
});

test("trashing a folder hides it from My files; restoring brings it and its child back", async ({
	owner,
	run,
}) => {
	const request = owner.page.request;
	const parentName = uniqueName(run.run_id, "cascade-parent");
	const parent = await createFolder(request, parentName);
	const childName = uniqueName(run.run_id, "cascade-child");
	await createFolder(request, childName, parent.name);
	await waitForChild(request, childName, parent.name);

	await trashNode(request, parent.name);
	await expectChildAbsent(request, parentName);

	await restoreNode(request, parent.name);
	await waitForChild(request, parentName);
	await waitForChild(request, childName, parent.name);

	await discardNode(request, parent.name);
});
