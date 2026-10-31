import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "../../fixtures/test";
import { discardNode, row, uniqueName, uploadViaUi, waitForChild } from "../../helpers/drive";

const uploadFixture = resolve(__dirname, "fixtures/drive-upload.txt");
const fixtureContent = readFileSync(uploadFixture, "utf8").trim();

test("uploads, previews and downloads a text file", async ({ owner, run }) => {
	const { page } = owner;
	const fileName = uniqueName(run.run_id, "preview", ".txt");
	await page.goto("/drive");
	await uploadViaUi(page, {
		name: fileName,
		mimeType: "text/plain",
		buffer: readFileSync(uploadFixture),
	});
	const file = await waitForChild(page.request, fileName);

	await row(page, file.name).click();
	await expect(page).toHaveURL(new RegExp(`/d/${file.name}`));
	await expect(page.getByRole("textbox", { name: "File name" })).toHaveValue(fileName);
	await expect(page.getByText(fixtureContent)).toBeVisible();

	// Download is a plain link to the content endpoint, opened in a new tab; fetch what it points at.
	const href = await page.getByRole("link", { name: "Download", exact: true }).getAttribute("href");
	expect(href).toContain(`/nodes/${file.name}/content`);
	const downloaded = await page.request.get(href as string);
	expect(downloaded.ok()).toBe(true);
	expect(downloaded.headers()["content-disposition"]).toContain(fileName);
	expect((await downloaded.text()).trim()).toBe(fixtureContent);

	await discardNode(page.request, file.name);
});
