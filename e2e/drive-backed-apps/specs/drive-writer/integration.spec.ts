import { expect, test } from "../../fixtures/test";
import {
	chooseNew,
	createFolder,
	discardNode,
	moveNode,
	openRowMenu,
	restoreNode,
	row,
	sidebarLink,
	uniqueName,
	waitForChild,
} from "../../helpers/drive";
import {
	createWriterDocument,
	documentTitle,
	openWriterDocument,
	typeAndSave,
	uniqueWriterTitle,
	writerEditor,
} from "../../helpers/writer";
import { frappeData } from "../../../shared/frappe";

test("New › Document creates a Writer document in the open folder and opens it", async ({
	owner,
	run,
}) => {
	const { page } = owner;
	const folder = await createFolder(page.request, uniqueName(run.run_id, "new-doc"));
	const title = uniqueWriterTitle(run.run_id, "new");

	await page.goto(`/drive/f/${folder.name}`);
	await chooseNew(page, "Document");
	const dialog = page.getByRole("dialog", { name: "New document" });
	await dialog.getByRole("textbox", { name: "Name" }).fill(title);
	await dialog.getByRole("button", { name: "Create", exact: true }).click();

	await expect(page).toHaveURL(/\/d\/[^/]+(?:\/|$)/);
	await expect(writerEditor(page)).toBeVisible();
	await expect(documentTitle(page)).toHaveValue(title);

	const created = await waitForChild(page.request, title, folder.name);
	expect(created.kind).toBe("document");
	expect(created.content_doctype).toBe("Writer Document");

	await discardNode(page.request, folder.name);
});

test("a Writer document is renamed, moved, trashed, restored and reopened from Drive", async ({
	owner,
	run,
}) => {
	const { page } = owner;
	const title = uniqueWriterTitle(run.run_id, "lifecycle");
	const renamedTitle = `${title} renamed`;
	const content = `Writer lifecycle content ${run.run_id}`;
	const embedContent = `Writer embed content ${run.run_id}`;
	const file = await createWriterDocument(page.request, title);
	const folder = await createFolder(page.request, uniqueName(run.run_id, "writer-folder"));

	await openWriterDocument(page, file.name);
	await typeAndSave(page, content);
	const embedResponse = await page.request.post("/api/method/suite.writer.api.embed.add", {
		multipart: {
			file_id: file.name,
			file: {
				name: "writer-embed.txt",
				mimeType: "text/plain",
				buffer: Buffer.from(embedContent),
			},
		},
	});
	const embed = await frappeData<{ file_url: string }>(embedResponse);
	const embedStatus = async () => (await page.request.get(embed.file_url)).ok();

	await page.goto("/drive");
	await expect(row(page, file.name)).toContainText(title);
	let menu = await openRowMenu(page, title);
	await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Rename" });
	await dialog.getByRole("textbox", { name: "Name" }).fill(renamedTitle);
	await dialog.getByRole("button", { name: "Rename", exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(row(page, file.name)).toContainText(renamedTitle);
	expect(await embedStatus()).toBe(true);

	await moveNode(page.request, file.name, folder.name);
	await page.goto(`/drive/f/${folder.name}`);
	await expect(row(page, file.name)).toContainText(renamedTitle);
	expect(await embedStatus()).toBe(true);

	menu = await openRowMenu(page, renamedTitle);
	await menu.getByRole("menuitem", { name: "Move to trash", exact: true }).click();
	await expect(page.getByText(`Moved “${renamedTitle}” to Trash`)).toBeVisible();
	await sidebarLink(page, "Trash").click();
	await expect(row(page, file.name)).toContainText(renamedTitle);
	// Trash makes the document read-only, not unreadable: its owner still reaches the embed.
	expect(await embedStatus()).toBe(true);
	await restoreNode(page.request, file.name);
	expect(await (await page.request.get(embed.file_url)).text()).toBe(embedContent);

	await page.goto(`/drive/f/${folder.name}`);
	await row(page, file.name).click();
	await expect(page).toHaveURL(new RegExp(`/d/${file.name}`));
	await expect(writerEditor(page)).toContainText(content);
	await expect(documentTitle(page)).toHaveValue(renamedTitle);

	await discardNode(page.request, folder.name);
});
