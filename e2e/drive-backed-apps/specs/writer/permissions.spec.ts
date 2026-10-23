import { expect, test } from "../../fixtures/test";
import { discardNode } from "../../helpers/drive";
import {
	createWriterDocument,
	documentMenuButton,
	documentTitle,
	openWriterDocument,
	shareWriterDocument,
	uniqueWriterTitle,
	writerEditor,
} from "../../helpers/writer";

test("a reader cannot edit or rename, and an editor can", async ({ owner, collaborator, run }) => {
	const file = await createWriterDocument(owner.page.request, uniqueWriterTitle(run.run_id, "acl"));

	await shareWriterDocument(owner.page.request, file.name, {
		user: collaborator.user.user,
		read: true,
	});
	await openWriterDocument(collaborator.page, file.name);
	await expect(writerEditor(collaborator.page)).toHaveAttribute("contenteditable", "false");
	await expect(collaborator.page.getByText("View only", { exact: true })).toBeVisible();
	await expect(documentTitle(collaborator.page)).toHaveAttribute("readonly", "");
	// Readers still get the document menu: downloads stay, imports go.
	await documentMenuButton(collaborator.page).click();
	await expect(collaborator.page.getByRole("menuitem", { name: "Download as DOCX" })).toBeVisible();
	await expect(collaborator.page.getByRole("menuitem", { name: "Import DOCX" })).toHaveCount(0);
	await collaborator.page.keyboard.press("Escape");

	await shareWriterDocument(owner.page.request, file.name, {
		user: collaborator.user.user,
		read: true,
		write: true,
		comment: true,
	});
	await collaborator.page.reload();
	await expect(writerEditor(collaborator.page)).toHaveAttribute("contenteditable", "true");
	await expect(documentTitle(collaborator.page)).not.toHaveAttribute("readonly", "");
	await documentMenuButton(collaborator.page).click();
	await expect(collaborator.page.getByRole("menuitem", { name: "Import DOCX" })).toBeVisible();

	await discardNode(owner.page.request, file.name);
});

test("a public document is readable but not editable by a guest", async ({
	owner,
	guestPage,
	run,
}) => {
	const file = await createWriterDocument(owner.page.request, uniqueWriterTitle(run.run_id, "public"));
	await shareWriterDocument(owner.page.request, file.name, { read: true });

	await openWriterDocument(guestPage, file.name);
	await expect(writerEditor(guestPage)).toHaveAttribute("contenteditable", "false");
	await expect(guestPage.getByRole("button", { name: "Sign in" }).first()).toBeVisible();
	await documentMenuButton(guestPage).click();
	await expect(guestPage.getByRole("menuitem", { name: "Import DOCX" })).toHaveCount(0);

	await discardNode(owner.page.request, file.name);
});
