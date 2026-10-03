import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "../../fixtures/test";
import {
	canReadNode,
	createFolder,
	discardNode,
	DRIVE,
	grantAccess,
	listGrants,
	revokeAccess,
	ROLE,
	roleOn,
	uniqueName,
} from "../../helpers/drive";
import { frappeData } from "../../../shared/frappe";

async function makeGroup(
	request: APIRequestContext,
	runId: string,
	name: string,
	members: string[],
): Promise<{ name: string; member_count: number }> {
	const response = await request.post("/api/method/suite.drive.e2e_api.create_user_group", {
		form: { run_id: runId, name, members: members.join(",") },
	});
	return frappeData(response);
}

test("a direct share grants read and unsharing takes it away", async ({
	owner,
	collaborator,
	run,
}) => {
	const folder = await createFolder(owner.page.request, uniqueName(run.run_id, "share"));

	expect(await canReadNode(collaborator.page.request, folder.name)).toBe(false);

	const grant = await grantAccess(owner.page.request, folder.name, collaborator.user.user, ROLE.READ);
	expect(grant).toMatchObject({ node: folder.name, principal: collaborator.user.user, role: ROLE.READ });
	expect(grant.person?.id).toBe(collaborator.user.user);
	expect(await roleOn(collaborator.page.request, folder.name)).toBe(ROLE.READ);

	expect(await revokeAccess(owner.page.request, folder.name, collaborator.user.user)).toBe(1);
	expect(await canReadNode(collaborator.page.request, folder.name)).toBe(false);

	await discardNode(owner.page.request, folder.name);
});

test("a share inherits to children until an explicit deny", async ({
	owner,
	collaborator,
	run,
}) => {
	const parent = await createFolder(owner.page.request, uniqueName(run.run_id, "inherit"));
	const child = await createFolder(owner.page.request, uniqueName(run.run_id, "inheritchild"), parent.name);

	await grantAccess(owner.page.request, parent.name, collaborator.user.user, ROLE.READ);
	// No grant on the child: it reads through the parent's.
	expect(await canReadNode(collaborator.page.request, child.name)).toBe(true);

	// Role 0 is an explicit deny, and it stops the inherited grant at the child.
	await grantAccess(owner.page.request, child.name, collaborator.user.user, ROLE.NONE);
	expect(await canReadNode(collaborator.page.request, child.name)).toBe(false);
	expect(await canReadNode(collaborator.page.request, parent.name)).toBe(true);

	await discardNode(owner.page.request, parent.name);
});

test("sharing with a user group reaches its members, and a group deny outranks a group grant", async ({
	owner,
	collaborator,
	run,
	testApi,
}) => {
	const folder = await createFolder(owner.page.request, uniqueName(run.run_id, "grp"));
	const readers = await makeGroup(testApi, run.run_id, "readers", [collaborator.user.user]);
	expect(readers.member_count).toBe(1);
	const principal = `$GROUP:${readers.name}`;

	expect(await canReadNode(collaborator.page.request, folder.name)).toBe(false);
	await grantAccess(owner.page.request, folder.name, principal, ROLE.READ);
	expect(await canReadNode(collaborator.page.request, folder.name)).toBe(true);

	// The grant is listed against the group, not against its member.
	const principals = (await listGrants(owner.page.request, folder.name)).map((grant) => grant.principal);
	expect(principals).toContain(principal);
	expect(principals).not.toContain(collaborator.user.user);

	// Same specificity tier, so the deny wins.
	const blocked = await makeGroup(testApi, run.run_id, "blocked", [collaborator.user.user]);
	await grantAccess(owner.page.request, folder.name, `$GROUP:${blocked.name}`, ROLE.NONE);
	expect(await canReadNode(collaborator.page.request, folder.name)).toBe(false);

	await discardNode(owner.page.request, folder.name);
});

test("only a manager writes grants, and public access stops at Read", async ({
	owner,
	collaborator,
	run,
}) => {
	const folder = await createFolder(owner.page.request, uniqueName(run.run_id, "ceiling"));
	await grantAccess(owner.page.request, folder.name, collaborator.user.user, ROLE.EDIT);

	// Edit lets the collaborator change the folder, not who else may.
	const asEditor = await collaborator.page.request.put(
		`${DRIVE}/nodes/${folder.name}/grants/${encodeURIComponent(collaborator.user.user)}`,
		{ data: { role: ROLE.MANAGE } },
	);
	expect(asEditor.status()).toBe(403);

	// Even the owner cannot publish more than Read.
	const tooPublic = await owner.page.request.put(
		`${DRIVE}/nodes/${folder.name}/grants/${encodeURIComponent("$PUBLIC")}`,
		{ data: { role: ROLE.EDIT } },
	);
	expect(tooPublic.status()).toBe(403);
	expect(await tooPublic.text()).toContain("cannot exceed Read");

	await discardNode(owner.page.request, folder.name);
});
