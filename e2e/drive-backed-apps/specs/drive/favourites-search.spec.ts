import { expect, test } from "../../fixtures/test";
import {
	createFolder,
	discardNode,
	DRIVE,
	openRowMenu,
	row,
	sidebarLink,
	uniqueName,
	view,
} from "../../helpers/drive";

test("starring a folder puts it in Starred, and unstarring takes it out again", async ({
	owner,
	run,
}) => {
	const { page } = owner;
	const name = uniqueName(run.run_id, "fav");
	const folder = await createFolder(page.request, name);
	const starred = async () => (await view(page.request, "favourites")).map((item) => item.name);

	// Starred from the row menu.
	await page.goto("/drive");
	const menu = await openRowMenu(page, name);
	await menu.getByRole("menuitem", { name: "Star", exact: true }).click();
	await expect.poll(starred).toContain(folder.name);
	await sidebarLink(page, "Starred").click();
	await expect(row(page, folder.name)).toBeVisible();

	// Unstarred through the API, which the page reflects.
	const unstar = await page.request.delete(`${DRIVE}/nodes/${folder.name}/favourite`);
	expect(unstar.ok()).toBe(true);
	await expect.poll(starred).not.toContain(folder.name);
	await page.reload();
	await expect(row(page, folder.name)).toHaveCount(0);

	await discardNode(page.request, folder.name);
});

test("search finds a newly created folder by name", async ({ owner, run }) => {
	// A distinctive, index-friendly token (no hyphens, > 3 chars) so fulltext matches.
	const token = `zsearch${run.run_id.replace(/-/g, "")}${Date.now().toString(36)}`;
	const folder = await createFolder(owner.page.request, token);

	await expect
		.poll(() =>
			view(owner.page.request, "search", { term: token })
				.then((rows) => rows.map((item) => item.name))
				.catch((): string[] => []),
		)
		.toContain(folder.name);

	// The page's search box reaches the same result.
	await owner.page.goto("/drive");
	await owner.page.getByRole("searchbox", { name: "Search all files" }).fill(token);
	await expect(row(owner.page, folder.name)).toBeVisible();

	await discardNode(owner.page.request, folder.name);
});
